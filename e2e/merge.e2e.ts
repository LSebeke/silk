import type { Page } from '@playwright/test';
import type { Session } from '../src/adapter/session';
import type { CanonRecord } from '../src/core/canon';
import type { CommandRegistry } from '../src/core/commands/registry';
import { expect, test } from './fixtures';

/** Runs `fn` in the page with Garn's api and session. */
function garn<A, R>(
  page: Page,
  fn: (s: { api: CommandRegistry; session: Session }, arg: A) => R | Promise<R>,
  arg?: A,
): Promise<R> {
  return page.evaluate(
    ([src, a]) => {
      const mod = game.modules?.get('garn') as unknown as {
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
      (game.modules?.get('garn') as unknown as { session(): unknown }).session();
      return true;
    } catch {
      return false;
    }
  });
  await gm.evaluate(() => game.settings?.set('garn', 'materializeMode', 'onDemand'));

  // Bound, on clean main (an earlier test in this worker may have left an Adventure running).
  const ids = await garn(gm, async ({ api, session }) => {
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
  await garn(
    gm,
    ({ api }, id) => api.run('element.rename', { id, name: 'Gareth (Adventure)' }),
    ids.gareth,
  );
  // Canon side: another World's Canon edit, committed straight to main.
  await garn(
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
  await garn(gm, ({ api }) => api.run('canon.openWindow'));
  await gm.locator('[data-garn-adventure-end]').click();

  const win = gm.locator('[data-garn-merge]');
  // Under load (other agents' Foundry runs) the first render takes a while.
  await expect(win).toBeVisible({ timeout: 90_000 });
  await expect(win.locator('[data-garn-merge-title]')).toContainText('Blutige Klinge');
  await expect(win.locator('[data-garn-merge-count="conflict"]')).toContainText('1');
  await expect(win.locator(`[data-garn-merge-node="${ids.gareth}"]`)).toHaveAttribute(
    'data-garn-merge-badge',
    'conflict',
  );
  const confirm = win.locator('[data-garn-merge-confirm]');
  await expect(confirm).toBeDisabled();

  // ⏎ = Next conflict: opens Gareth's drawer.
  await win.focus();
  await gm.keyboard.press('Enter');
  const drawer = win.locator(`[data-garn-merge-drawer="${ids.gareth}"]`);
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  const row = drawer.locator('[data-garn-merge-field="/name"]');
  await expect(row.locator('[data-garn-merge-cell="ours"]')).toContainText('Gareth (Canon)');
  await row.locator('[data-garn-merge-cell="theirs"]').click();
  await expect(row.locator('[data-garn-merge-result]')).toContainText('Gareth (Adventure)', {
    timeout: 30_000,
  });

  // The draft is in the World.
  const picks = await garn(gm, ({ session }) => session.workingCopy.meta('mergeDraft'));
  expect(picks).toMatchObject({
    picks: [{ recordId: ids.gareth, field: '/name', side: 'theirs' }],
  });

  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
  const dialog = gm.locator('#garn-merge-confirm');
  await expect(dialog).toContainText('no undo');
  await dialog.locator('button[data-action="yes"]').click();
  await expect(win).toHaveCount(0, { timeout: 30_000 });

  const after = await garn(
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
  await expect(gm.locator('[data-garn-checkout]')).toContainText('main');
});

test('Merge UI: sheet sections, embedded Items, Event Scene tokens + walls, layout, attribution', async ({
  gm,
}) => {
  test.setTimeout(300_000);
  await gm.waitForFunction(() => {
    try {
      (game.modules?.get('garn') as unknown as { session(): unknown }).session();
      return true;
    } catch {
      return false;
    }
  });
  await gm.evaluate(() => game.settings?.set('garn', 'materializeMode', 'onDemand'));

  // Main: Materialized Ulf (with a torch) present at a Materialized Event with its Scene.
  const ids = await garn(gm, async ({ api, session }) => {
    if (!session.workingCopy.binding) await api.run('canon.create', { name: 'E2E' });
    if ('adventure' in (session.workingCopy.binding?.checkout ?? {})) {
      await api.run('adventure.end');
      const view = await session.workingCopy.meta('mergeDraft');
      if (view) await api.run('merge.confirm', { confirmed: true });
    }
    const create = async (cls: string, name: string) =>
      (await api.run<{ id: string }>('element.create', { class: cls, name })).id;
    const ulf = await create('person', 'Merge Ulf');
    const brawl = await create('event', 'Merge Brawl');
    await api.run('materialize.elements', { ids: [ulf, brawl] });
    await api.run('connection.create', { from: ulf, to: brawl, type: 'presentAt' });
    const uuid = session.workingCopy.get(ulf)?.data.uuid as string;
    const actor = fromUuidSync(uuid) as unknown as {
      createEmbeddedDocuments(n: string, d: object[], o: object): Promise<unknown>;
    };
    await actor.createEmbeddedDocuments(
      'Item',
      [{ _id: 'garntorch0000001', name: 'Torch', type: 'equipment' }],
      { keepId: true },
    );
    for (let i = 0; i < 100; i++) {
      const scene = game.scenes?.find(
        (s) => (s.flags as { garn?: { sceneOf?: string } }).garn?.sceneOf === brawl,
      );
      if (scene && scene.tokens.size) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await api.run('history.commit', { label: 'T20 start' });
    const campaign = await session.campaigns.create({ name: 'Freitagsrunde' });
    await api.run('adventure.start', { name: 'Schatten', campaignId: campaign.id });
    const scene = game.scenes?.find(
      (s) => (s.flags as { garn?: { sceneOf?: string } }).garn?.sceneOf === brawl,
    );
    return {
      ulf,
      brawl,
      uuid,
      scene: scene?.id as string,
      token: scene?.tokens.contents[0]?.id as string,
    };
  });

  // Adventure side: Ulf's token and Node move.
  await garn(
    gm,
    async ({ session }, { ulf, scene, token }) => {
      await game.scenes?.get(scene)?.tokens.get(token)?.update({ x: 1000, y: 1000 });
      const r = session.workingCopy.get(ulf) as CanonRecord;
      await session.workingCopy.set([{ ...r, data: { ...r.data, position: { x: 900, y: 900 } } }]);
    },
    ids,
  );
  // Canon side (another World): a sword in Ulf's sheet, his token and Node elsewhere, a wall.
  await garn(
    gm,
    async ({ session }, { ulf, brawl, token }) => {
      const canon = await session.history.canon();
      const head = await canon?.getMain();
      if (!canon || !head) throw new Error('no main');
      const snapshot = new Map(await canon.readSnapshot(head));
      const sheet = structuredClone(snapshot.get(`${ulf}-sheet`) as CanonRecord);
      const doc = sheet.data.doc as { items: object[] };
      doc.items.push({ _id: 'garnsword0000001', name: 'Sword', type: 'equipment', system: {} });
      snapshot.set(sheet.id, sheet);
      const record = structuredClone(snapshot.get(`${brawl}-scene`) as CanonRecord);
      const data = record.data.scene as {
        tokens: { _id: string; x: number; y: number }[];
        walls?: object[];
      };
      const t = data.tokens.find((x) => x._id === token);
      if (t) Object.assign(t, { x: 200, y: 400 });
      data.walls = [...(data.walls ?? []), { _id: 'garnwall00000001', c: [100, 100, 600, 100] }];
      snapshot.set(record.id, record);
      const el = snapshot.get(ulf) as CanonRecord;
      snapshot.set(ulf, { ...el, data: { ...el.data, position: { x: -400, y: 0 } } });
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
  await garn(gm, ({ api }) => api.run('canon.openWindow'));
  await gm.locator('[data-garn-adventure-end]').click();
  const win = gm.locator('[data-garn-merge]');
  await expect(win).toBeVisible({ timeout: 90_000 });
  // Layout: a move count, and an outline where the Canon has Ulf's Node.
  await expect(win.locator('[data-garn-merge-moves]')).toBeVisible();
  await expect(win.locator('[data-garn-merge-outline="ours"]')).toHaveCount(1);
  await expect(win.locator(`[data-garn-merge-node="${ids.brawl}"]`)).toHaveAttribute(
    'data-garn-merge-badge',
    'conflict',
  );

  // The wall and the sword are Canon-only: show them.
  await win.locator('[data-garn-merge-canon-only]').check({ timeout: 30_000 });

  // Event Scene: minimap, one token row (conflict), a walls count row.
  // ⏎ (the world is shared with the test above: Brawl's Node may sit under Gareth's).
  await win.focus();
  await gm.keyboard.press('Enter');
  const drawer = win.locator(`[data-garn-merge-drawer="${ids.brawl}"]`);
  await expect(drawer.locator('[data-garn-merge-minimap]')).toBeVisible({ timeout: 30_000 });
  const tokenRow = drawer.locator(`[data-garn-merge-field="/scene/tokens/${ids.token}"]`);
  await expect(tokenRow).toHaveAttribute('data-garn-merge-kind', 'token');
  await expect(tokenRow.locator('[data-garn-merge-cell="ours"]')).toContainText('(200, 400)');
  await expect(tokenRow.locator('[data-garn-merge-by]')).toContainText('Canon edit');
  const walls = drawer.locator('[data-garn-merge-field="/scene/walls"]');
  await expect(walls).toHaveAttribute('data-garn-merge-kind', 'count');
  await expect(walls.locator('[data-garn-merge-result]')).toContainText('1');
  await tokenRow.locator('[data-garn-merge-cell="ours"]').click();
  await expect(tokenRow.locator('[data-garn-merge-result]')).toContainText('(200, 400)', {
    timeout: 30_000,
  });

  // Sheet: the sword under Inventory, matched by id.
  await win.locator(`[data-garn-merge-node="${ids.ulf}"]`).click();
  const ulfDrawer = win.locator(`[data-garn-merge-drawer="${ids.ulf}"]`);
  const inventory = ulfDrawer.locator(
    '[data-garn-merge-section="GARN.Merge.Section.dsa5.inventory"]',
  );
  await expect(inventory).toContainText('Sword', { timeout: 30_000 });
  await expect(inventory).toContainText('Inventory');

  const confirm = win.locator('[data-garn-merge-confirm]');
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
  await gm.locator('#garn-merge-confirm button[data-action="yes"]').click();
  await expect(win).toHaveCount(0, { timeout: 60_000 });

  // The World follows the result: the sword, the token at the Canon's spot, the wall.
  const after = await garn(
    gm,
    (_s, { uuid, scene, token }) => {
      const actor = fromUuidSync(uuid) as unknown as { items: { get(id: string): unknown } };
      const s = game.scenes?.get(scene);
      const t = s?.tokens.get(token);
      return {
        sword: !!actor.items.get('garnsword0000001'),
        torch: !!actor.items.get('garntorch0000001'),
        token: t ? { x: t.x, y: t.y } : null,
        wall: !!s?.walls.get('garnwall00000001'),
      };
    },
    ids,
  );
  expect(after).toEqual({ sword: true, torch: true, token: { x: 200, y: 400 }, wall: true });
});
