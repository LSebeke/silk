import type { Page } from '@playwright/test';
import type { Session } from '../src/adapter/session';
import type { CanonRecord } from '../src/core/canon';
import type { CommandRegistry } from '../src/core/commands/registry';
import { expect, test } from './fixtures';

/** Runs `fn` in the page with Silk's api and session. */
function silk<A, R>(
  page: Page,
  fn: (s: { api: CommandRegistry; session: Session }, arg: A) => R | Promise<R>,
  arg?: A,
): Promise<R> {
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

test('End Adventure: resolve a conflict with a Canon edit, confirm, back on main', async ({
  gm,
}) => {
  test.setTimeout(240_000);
  await gm.waitForFunction(() => {
    try {
      (game.modules?.get('silk') as unknown as { session(): unknown }).session();
      return true;
    } catch {
      return false;
    }
  });
  await gm.evaluate(() => game.settings?.set('silk', 'materializeMode', 'onDemand'));

  // Bound, on clean main (an earlier test in this worker may have left an Adventure running).
  const ids = await silk(gm, async ({ api, session }) => {
    if (!session.workingCopy.binding) await api.run('canon.create', { name: 'E2E' });
    if ('adventure' in (session.workingCopy.binding?.checkout ?? {})) {
      await api.run('adventure.end');
      await api.run('merge.confirm', { confirmed: true });
    }
    const gareth = (
      await api.run<{ id: string }>('element.create', { class: 'person', name: 'Gareth' })
    ).id;
    const ulf = (await api.run<{ id: string }>('element.create', { class: 'person', name: 'Ulf' }))
      .id;
    await api.run('materialize.elements', { ids: [ulf] });
    await api.run('history.commit', { label: 'T19 start' });
    const campaign = await session.campaigns.create({ name: 'Dienstagsgruppe' });
    await api.run('adventure.start', { name: 'Blutige Klinge', campaignId: campaign.id });
    return { gareth, ulf };
  });

  // Adventure side.
  await silk(
    gm,
    ({ api }, id) => api.run('element.rename', { id, name: 'Gareth (Adventure)' }),
    ids.gareth,
  );
  // Canon side: another World's Canon edit, committed straight to main.
  await silk(
    gm,
    async ({ session }, { gareth, ulf }) => {
      const canon = await session.history.canon();
      const head = await canon?.getMain();
      if (!canon || !head) throw new Error('no main');
      const snapshot = new Map(await canon.readSnapshot(head));
      const rename = (id: string, name: string) => {
        const r = snapshot.get(id) as CanonRecord;
        snapshot.set(id, { ...r, data: { ...r.data, name } });
      };
      rename(gareth, 'Gareth (Canon)');
      rename(ulf, 'Ulf the Bold');
      await canon.commit({
        snapshot,
        parents: [head],
        label: 'Canon edit',
        author: 'Other GM',
        ref: { main: true },
      });
    },
    ids,
  );

  await closePopups(gm);
  await silk(gm, ({ api }) => api.run('canon.openWindow'));
  await gm.locator('[data-silk-adventure-end]').click();

  const win = gm.locator('[data-silk-merge]');
  // Under load (other agents' Foundry runs) the first render takes a while.
  await expect(win).toBeVisible({ timeout: 90_000 });
  await expect(win.locator('[data-silk-merge-title]')).toContainText('Blutige Klinge');
  await expect(win.locator('[data-silk-merge-count="conflict"]')).toContainText('1');
  await expect(win.locator(`[data-silk-merge-node="${ids.gareth}"]`)).toHaveAttribute(
    'data-silk-merge-badge',
    'conflict',
  );
  const confirm = win.locator('[data-silk-merge-confirm]');
  await expect(confirm).toBeDisabled();

  // ⏎ = Next conflict: opens Gareth's drawer.
  await win.focus();
  await gm.keyboard.press('Enter');
  const drawer = win.locator(`[data-silk-merge-drawer="${ids.gareth}"]`);
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  const row = drawer.locator('[data-silk-merge-field="/name"]');
  await expect(row.locator('[data-silk-merge-cell="ours"]')).toContainText('Gareth (Canon)');
  await row.locator('[data-silk-merge-cell="theirs"]').click();
  await expect(row.locator('[data-silk-merge-result]')).toContainText('Gareth (Adventure)', {
    timeout: 30_000,
  });

  // The draft is in the World.
  const picks = await silk(gm, ({ session }) => session.workingCopy.meta('mergeDraft'));
  expect(picks).toMatchObject({
    picks: [{ recordId: ids.gareth, field: '/name', side: 'theirs' }],
  });

  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
  const dialog = gm.locator('#silk-merge-confirm');
  await expect(dialog).toContainText('no undo');
  await dialog.locator('button[data-action="yes"]').click();
  await expect(win).toHaveCount(0, { timeout: 30_000 });

  const after = await silk(
    gm,
    async ({ session }, { gareth, ulf }) => {
      const canon = await session.history.canon();
      const head = (await canon?.getMain()) ?? '';
      const commit = await canon?.readCommit(head);
      const uuid = session.workingCopy.get(ulf)?.data.uuid as string;
      return {
        binding: session.workingCopy.binding,
        head,
        label: commit?.label,
        parents: commit?.parents.length,
        gareth: session.workingCopy.get(gareth)?.data.name,
        ulfDoc: (fromUuidSync(uuid) as { name?: string } | null)?.name,
        draft: session.workingCopy.meta('mergeDraft') ?? null,
      };
    },
    ids,
  );
  expect(after).toMatchObject({
    binding: { checkout: { main: true } },
    label: 'Merge Blutige Klinge (Dienstagsgruppe)',
    parents: 2,
    gareth: 'Gareth (Adventure)',
    ulfDoc: 'Ulf the Bold',
    draft: null,
  });
  expect(after.binding?.head).toBe(after.head);
  await expect(gm.locator('[data-silk-checkout]')).toContainText('main');
});
