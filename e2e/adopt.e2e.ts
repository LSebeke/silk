/** Adopt against real dsa5 (spec §6 Adopt, §11.3 End Play Session). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped dsa5/Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function ready(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(() => game.settings?.set('silk', 'materializeMode', 'immediate'));
}

async function closePopups(page: Page) {
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    document.getElementById('dsa5-patch-viewer')?.remove();
    for (const tip of document.querySelectorAll('.didYouKnow')) tip.remove();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout')) el.remove();
    ui.notifications?.clear();
  });
}

const element = (page: Page, id: string) =>
  page.evaluate(
    (elementId) => game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data ?? null,
    id,
  ) as Promise<Record<string, any> | null>;

const elementNamed = (page: Page, name: string) =>
  page.evaluate((n) => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records() as Map<
      string,
      any
    >;
    const found = [...records.values()].find((r) => r.kind === 'element' && r.data.name === n);
    return found ? { id: found.id as string, ...found.data } : null;
  }, name) as Promise<(Record<string, any> & { id: string }) | null>;

const connections = (page: Page, type: string) =>
  page.evaluate((t) => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records() as Map<
      string,
      any
    >;
    return [...records.values()]
      .filter((r) => r.kind === 'connection' && r.data.type === t)
      .map((r) => [r.data.from, r.data.to] as [string, string]);
  }, type);

test('inventory item: also adopts its actor, adds owns, writes only link flags', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const { actorUuid, itemUuid } = await gm.evaluate(async () => {
    const folder = await Folder.implementation.create({ name: 'My NPCs', type: 'Actor' });
    const actor = (await Actor.implementation.create({
      name: 'Adopt Alrik',
      type: 'npc',
      folder: folder?.id,
    } as never)) as any;
    const [item] = (await actor.createEmbeddedDocuments('Item', [
      { name: 'Adopt Sword', type: 'equipment' },
    ])) as any[];
    return { actorUuid: actor.uuid as string, itemUuid: item.uuid as string };
  });
  const result = await api<{ id: string; actorId: string }>(gm, 'adopt.doc', {
    uuid: itemUuid,
    alsoAdoptActor: true,
  });
  expect(await element(gm, result.actorId)).toMatchObject({
    class: 'person',
    name: 'Adopt Alrik',
    uuid: actorUuid,
    adopted: true,
  });
  expect(await element(gm, result.id)).toMatchObject({ class: 'item', uuid: itemUuid });
  expect(await connections(gm, 'owns')).toContainEqual([result.actorId, result.id]);
  const docs = await gm.evaluate(
    ([a, i]) => {
      const actor = fromUuidSync(a) as any;
      const companion = game.journal?.get(actor.flags.silk.companion) as any;
      return {
        folder: actor.folder?.name ?? null,
        actorFlags: Object.keys(actor.flags.silk).sort(),
        itemId: (fromUuidSync(i) as any).flags.silk.id,
        companion: companion?.pages.size ?? -1,
      };
    },
    [actorUuid, itemUuid] as const,
  );
  expect(docs).toEqual({
    folder: 'My NPCs',
    actorFlags: ['companion', 'id'],
    itemId: result.id,
    companion: 1, // the Connections page only: no default Info Blocks
  });
});

test('a journal dropped onto the canvas ends in the Creation Pipeline; pages become Info Blocks', async ({
  gm,
}) => {
  test.setTimeout(120_000);
  await ready(gm);
  await closePopups(gm);
  const uuid = await gm.evaluate(async () => {
    const journal = (await JournalEntry.implementation.create({
      name: 'Dropped Gareth',
      pages: [{ name: 'Streets', type: 'text', text: { content: '<p>cobbled</p>' } }],
    } as never)) as any;
    return journal.uuid as string;
  });
  await api(gm, 'canvas.open');
  const pane = gm.locator('[data-silk-canvas]');
  await expect(pane).toBeVisible();
  await pane.evaluate((el, docUuid) => {
    const box = el.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', JSON.stringify({ type: 'JournalEntry', uuid: docUuid }));
    el.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 200,
        clientY: box.top + 150,
        dataTransfer,
      }),
    );
  }, uuid);
  // Ambiguous journal: class box with Note pre-selected.
  const options = gm.locator('[data-silk-class-option]');
  await expect(options.first()).toHaveAttribute('data-silk-class-option', 'note');
  await gm.locator('[data-silk-class-option="location"]').click();
  const nameInput = gm.locator('[data-silk-name-input]');
  await expect(nameInput).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect(nameInput).toHaveCount(0);
  await expect
    .poll(() => elementNamed(gm, 'Dropped Gareth'))
    .toMatchObject({
      class: 'location',
      uuid,
      adopted: true,
      infoBlocks: [{ name: 'Streets', text: '<p>cobbled</p>' }],
    });
  await expect(gm.locator('[data-silk-node]', { hasText: 'Dropped Gareth' })).toBeVisible();

  // Adopting it again selects the Node instead.
  const again = await api<{ existing?: boolean }>(gm, 'adopt.doc', { uuid });
  expect(again.existing).toBe(true);
});

test('sidebar context menu "Adopt into Silk" adopts an actor through the pipeline', async ({
  gm,
}) => {
  test.setTimeout(120_000);
  await ready(gm);
  const id = await gm.evaluate(async () => {
    const actor = (await Actor.implementation.create({
      name: 'Menu Wolf',
      type: 'creature',
    } as never)) as any;
    return actor.id as string;
  });
  await closePopups(gm);
  await gm.evaluate(() => ui.sidebar?.changeTab('actors', 'primary'));
  const entry = gm.locator(`#actors [data-entry-id="${id}"]`);
  await expect(entry).toBeVisible();
  // The sidebar list can sit outside the headless viewport: open the menu by event.
  await entry.dispatchEvent('contextmenu');
  const item = gm.locator('#context-menu li', { hasText: 'Adopt into Silk' });
  await expect(item).toHaveCount(1);
  await item.dispatchEvent('click');
  const nameInput = gm.locator('[data-silk-name-input]');
  await expect(nameInput).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect
    .poll(() => elementNamed(gm, 'Menu Wolf'))
    .toMatchObject({
      class: 'creature',
      uuid: `Actor.${id}`,
    });
});

test('a duplicated Silk doc has its copied Silk id stripped', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'location',
    name: 'Copied Town',
  });
  await expect.poll(async () => (await element(gm, id))?.['uuid']).toBeTruthy();
  const copyId = await gm.evaluate(
    async (uuid) => {
      const original = fromUuidSync(uuid) as any;
      const copy = await original.clone({ name: 'Copied Town (copy)' }, { save: true });
      return copy.id as string;
    },
    (await element(gm, id))?.['uuid'] as string,
  );
  await expect
    .poll(() => gm.evaluate((cid) => (game.journal?.get(cid) as any)?.flags.silk ?? null, copyId))
    .toBeNull();
});

test('a folder tree becomes nested Visual Groups', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const folderId = await gm.evaluate(async () => {
    const root = await Folder.implementation.create({ name: 'Orc camp', type: 'Actor' });
    const sub = (await Folder.implementation.create({
      name: 'Orc guards',
      type: 'Actor',
      folder: root?.id,
    } as never)) as { id: string } | undefined;
    await Actor.implementation.create({
      name: 'Orc chief',
      type: 'npc',
      folder: root?.id,
    } as never);
    await Actor.implementation.create({ name: 'Orc guard', type: 'npc', folder: sub?.id } as never);
    return root?.id as string;
  });
  const { ids } = await api<{ ids: string[] }>(gm, 'adopt.folder', { folderId, confirmed: true });
  expect(ids).toHaveLength(2);
  const layout = await gm.evaluate((elementIds) => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records() as Map<
      string,
      any
    >;
    const label = (id: string | undefined) => (id ? records.get(id)?.data.label : null);
    return elementIds.map((eid) => {
      const group = records.get(eid)?.data.group as string | undefined;
      return [
        records.get(eid)?.data.name,
        label(group),
        label(records.get(group ?? '')?.data.parent),
      ];
    });
  }, ids);
  expect(layout).toEqual([
    ['Orc chief', 'Orc camp', null],
    ['Orc guard', 'Orc guards', 'Orc camp'],
  ]);
});

test('End Play Session commits and lists ad-hoc docs; Ignore hides them for good', async ({
  gm,
}) => {
  test.setTimeout(180_000);
  await ready(gm);
  await gm.evaluate(async () => {
    const api = game.modules?.get('silk')?.api;
    if (!game.modules?.get('silk')?.session?.().workingCopy.binding)
      await api?.run('canon.create', { name: 'Adopt Canon' });
    await api?.run('history.commit', { label: 'before session' });
  });
  await gm.waitForTimeout(50);
  const extra = await gm.evaluate(async () => {
    const actor = (await Actor.implementation.create({
      name: 'Ad-hoc Bandit',
      type: 'npc',
    } as never)) as any;
    return actor.uuid as string;
  });
  await closePopups(gm);
  const first = await api<{ commit: string; adHoc: { uuid: string; name: string }[] }>(
    gm,
    'history.endPlaySession',
  );
  expect(first.commit).toBeTruthy();
  expect(first.adHoc.map((d) => d.uuid)).toContain(extra);
  const row = gm.locator(`[data-silk-adhoc="${extra}"]`);
  await expect(row).toBeVisible();
  await row.locator('[data-silk-adhoc-ignore]').click();
  await expect(row).toHaveCount(0);
  await expect
    .poll(() => gm.evaluate((u) => (fromUuidSync(u) as any).flags.silk?.ignored ?? false, extra))
    .toBe(true);
  const second = await api<{ adHoc: { uuid: string }[] }>(gm, 'history.endPlaySession');
  expect(second.adHoc.map((d) => d.uuid)).not.toContain(extra);
});
