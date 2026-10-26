/**
 * Canon edit mode load sync and Abandon (spec §11.3). "Another World" is simulated by a
 * Commit written to main through the Canon store directly.
 */
import type { Page } from '@playwright/test';
import type { Session } from '../src/adapter/session';
import type { CanonRecord } from '../src/core/canon';
import type { CommandRegistry } from '../src/core/commands/registry';
import { expect, test, waitForSilk } from './fixtures';

type Silk = { api: CommandRegistry; session: Session };

/** Runs `fn` in the page with Silk's api and session. */
function silk<A, R>(page: Page, fn: (s: Silk, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
  return page.evaluate(
    ([src, a]) => {
      const mod = game.modules?.get('silk') as unknown as {
        api: CommandRegistry;
        session(): Session;
      };
      const f = new Function(`return (${src})`)() as typeof fn;
      return f({ api: mod.api, session: mod.session() }, a as A);
    },
    [fn.toString(), arg] as const,
  );
}

async function closePopups(page: Page) {
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout')) el.remove();
    ui.notifications?.clear();
  });
}

const head = (page: Page) => silk(page, ({ session }) => session.workingCopy.binding?.head);
const main = (page: Page) =>
  silk(page, async ({ session }) => (await session.history.canon())?.getMain());

async function reload(page: Page) {
  await page.reload();
  await waitForSilk(page);
}

/** Bound, on clean main at main's head, with Gareth (Ghost) and Ulf (Materialized) committed. */
async function cleanMain(page: Page) {
  await page.waitForFunction(() => {
    try {
      (game.modules?.get('silk') as unknown as { session(): unknown }).session();
      return true;
    } catch {
      return false;
    }
  });
  await page.evaluate(() => game.settings?.set('silk', 'materializeMode', 'onDemand'));
  await silk(page, async ({ api, session }) => {
    if (!session.workingCopy.binding) await api.run('canon.create', { name: 'E2E' });
    await api.run('merge.cancel');
    const checkout = session.workingCopy.binding?.checkout;
    if (checkout && 'adventure' in checkout) {
      const ref = await (await session.history.canon())?.getAdventure(checkout.adventure);
      await api.run('adventure.abandon', { confirm: ref?.name });
    }
    await api.run('history.discard');
  });
  if ((await main(page)) && (await head(page)) !== (await main(page))) {
    await reload(page);
    await expect.poll(() => head(page), { timeout: 60_000 }).toBe(await main(page));
  }
  return silk(page, async ({ api }) => {
    const gareth = (
      await api.run<{ id: string }>('element.create', { class: 'person', name: 'Gareth' })
    ).id;
    const ulf = (await api.run<{ id: string }>('element.create', { class: 'person', name: 'Ulf' }))
      .id;
    await api.run('materialize.elements', { ids: [ulf] });
    await api.run('history.commit', { label: 'T21 start' });
    return { gareth, ulf };
  });
}

/** Another World's Canon edit: renames on main's head, committed straight to main. */
function otherWorldCommit(page: Page, names: Record<string, string>) {
  return silk(
    page,
    async ({ session }, names) => {
      const canon = await session.history.canon();
      const head = await canon?.getMain();
      if (!canon || !head) throw new Error('no main');
      const snapshot = new Map(await canon.readSnapshot(head));
      for (const [id, name] of Object.entries(names)) {
        const r = snapshot.get(id) as CanonRecord;
        snapshot.set(id, { ...r, data: { ...r.data, name } });
      }
      return canon.commit({
        snapshot,
        parents: [head],
        label: 'Canon edit elsewhere',
        author: 'Other GM',
        ref: { main: true },
      });
    },
    names,
  );
}

test('clean load after main moved: fast-forward rewrites the Materialized docs', async ({ gm }) => {
  test.setTimeout(240_000);
  const ids = await cleanMain(gm);
  const moved = await otherWorldCommit(gm, { [ids.ulf]: 'Ulf the Bold' });

  await reload(gm);

  await expect.poll(() => head(gm), { timeout: 60_000 }).toBe(moved);
  const state = await silk(
    gm,
    ({ session }, ulf) => {
      const uuid = session.workingCopy.get(ulf)?.data.uuid as string;
      return {
        name: session.workingCopy.get(ulf)?.data.name,
        doc: (fromUuidSync(uuid) as { name?: string } | null)?.name,
        draft: session.workingCopy.meta('mergeDraft') ?? null,
      };
    },
    ids.ulf,
  );
  expect(state).toEqual({ name: 'Ulf the Bold', doc: 'Ulf the Bold', draft: null });
});

test('dirty load after main moved: merge "Canon (incoming)" / "This World", confirm on main', async ({
  gm,
}) => {
  test.setTimeout(240_000);
  const ids = await cleanMain(gm);
  await silk(
    gm,
    ({ api }, id) => api.run('element.rename', { id, name: 'Gareth (here)' }),
    ids.gareth,
  );
  const moved = await otherWorldCommit(gm, { [ids.ulf]: 'Ulf the Bold' });

  await reload(gm);

  const win = gm.locator('[data-silk-merge]');
  // Under load the first render of the merge window takes a while.
  await expect(win).toBeVisible({ timeout: 90_000 });
  await expect(win.locator('[data-silk-merge-title]')).toHaveAttribute(
    'data-silk-merge-kind',
    'canonEdit',
  );
  await expect(win.locator('th.canon')).toHaveText('Canon (incoming)');
  await expect(win.locator('th.adv')).toHaveText('This World');
  expect(await head(gm)).not.toBe(moved);
  // Commits stay blocked until the merge is done.
  const refused = await silk(gm, ({ api }) =>
    api.run('history.commit', {}).then(
      () => 'committed',
      (e: Error) => e.name,
    ),
  );
  expect(refused).toBe('MainMovedError');

  await closePopups(gm);
  await silk(gm, ({ api }) => api.run('merge.confirm', { confirmed: true }));
  await expect(win).toHaveCount(0, { timeout: 30_000 });

  const after = await silk(
    gm,
    async ({ session }, { gareth, ulf }) => {
      const canon = await session.history.canon();
      const main = (await canon?.getMain()) ?? '';
      const commit = await canon?.readCommit(main);
      const uuid = session.workingCopy.get(ulf)?.data.uuid as string;
      return {
        main,
        head: session.workingCopy.binding?.head,
        label: commit?.label,
        firstParent: commit?.parents[0],
        gareth: session.workingCopy.get(gareth)?.data.name,
        ulfDoc: (fromUuidSync(uuid) as { name?: string } | null)?.name,
        dirty: await session.history.isDirty(),
      };
    },
    ids,
  );
  expect(after).toMatchObject({
    label: 'Merge this World',
    firstParent: moved,
    gareth: 'Gareth (here)',
    ulfDoc: 'Ulf the Bold',
    dirty: false,
  });
  expect(after.head).toBe(after.main);
});

test('Abandon: typed confirmation in the Canon window resets to main, deleting Adventure-only docs', async ({
  gm,
}) => {
  test.setTimeout(240_000);
  const ids = await cleanMain(gm);
  const doomed = await silk(gm, async ({ api, session }) => {
    const campaign = await session.campaigns.create({ name: 'Dienstagsgruppe' });
    await api.run('adventure.start', { name: 'Sackgasse', campaignId: campaign.id });
    const id = (
      await api.run<{ id: string }>('element.create', { class: 'person', name: 'Doomed' })
    ).id;
    await api.run('materialize.elements', { ids: [id] });
    await api.run('history.commit', { label: 'Session 1' });
    return { id, uuid: session.workingCopy.get(id)?.data.uuid as string };
  });
  await silk(
    gm,
    ({ api }, id) => api.run('element.rename', { id, name: 'Ulf (Adventure)' }),
    ids.ulf,
  );

  await closePopups(gm);
  await silk(gm, ({ api }) => api.run('canon.openWindow'));
  await gm.locator('[data-silk-adventure-abandon]').click();
  const dialog = gm.locator('[data-silk-abandon-dialog]');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const confirm = dialog.locator('[data-silk-abandon-confirm]');
  await dialog.locator('[data-silk-abandon-input]').fill('sackgasse');
  await expect(confirm).toBeDisabled();
  await dialog.locator('[data-silk-abandon-input]').fill('Sackgasse');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(gm.locator('[data-silk-checkout]')).toContainText('main', { timeout: 60_000 });
  const after = await silk(
    gm,
    async ({ session }, { doomed, ulf }) => {
      const uuid = session.workingCopy.get(ulf)?.data.uuid as string;
      return {
        head: session.workingCopy.binding?.head,
        main: await (await session.history.canon())?.getMain(),
        doomed: session.workingCopy.get(doomed.id) ?? null,
        doomedDoc: !!fromUuidSync(doomed.uuid),
        ulfDoc: (fromUuidSync(uuid) as { name?: string } | null)?.name,
      };
    },
    { doomed, ulf: ids.ulf },
  );
  expect(after).toMatchObject({ doomed: null, doomedDoc: false, ulfDoc: 'Ulf' });
  expect(after.head).toBe(after.main);
});
