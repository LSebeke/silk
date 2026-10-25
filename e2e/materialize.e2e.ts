/** Materialize + write-through against real dsa5 (spec §4, §6, §7). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped dsa5/Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const element = (page: Page, id: string) =>
  page.evaluate(
    (i) => game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data as Record<string, any>,
    id,
  );

async function ready(page: Page, mode: 'immediate' | 'onDemand') {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate((m) => game.settings?.set('silk', 'materializeMode', m), mode);
}

interface DocInfo {
  documentName: string;
  type: string | null;
  name: string;
  img: string | null;
  folder: string | null;
  ownership: Record<string, number>;
  flags: Record<string, string>;
  pages: { id: string; name: string; type: string; ownership: number; category: string | null }[];
  categories: string[];
  companion?: DocInfo;
}

/** The element's Foundry doc (and Companion Journal), read in the page. */
const docInfo = (page: Page, id: string): Promise<DocInfo | null> =>
  page.evaluate((elementId) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data['uuid'];
    const info = (doc: any): any => {
      const pages = doc.pages ? [...doc.pages].sort((a: any, b: any) => a.sort - b.sort) : [];
      return {
        documentName: doc.documentName,
        type: doc.documentName === 'JournalEntry' ? null : doc.type,
        name: doc.name,
        img: doc.img ?? null,
        folder: doc.folder?.name ?? null,
        ownership: { ...doc.ownership },
        flags: { ...doc.flags.silk },
        pages: pages.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          ownership: p.ownership.default,
          category: p.category,
        })),
        categories: doc.categories ? [...doc.categories].map((c: any) => c.name) : [],
      };
    };
    if (typeof uuid !== 'string') return null;
    const doc = fromUuidSync(uuid) as any;
    if (!doc) return null;
    const out = info(doc);
    const companion = doc.flags.silk?.companion && game.journal?.get(doc.flags.silk.companion);
    if (companion) out.companion = info(companion);
    return out;
  }, id);

const create = async (page: Page, cls: string, name: string) =>
  (await api<{ id: string }>(page, 'element.create', { class: cls, name })).id;

test('immediate Materialize creates each class’s doc per §4 with NONE pages', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm, 'immediate');

  const person = await docInfo(gm, await create(gm, 'person', 'Alrik'));
  expect(person).toMatchObject({
    documentName: 'Actor',
    type: 'npc',
    name: 'Alrik',
    folder: 'Persons',
    ownership: { default: 0 },
  });
  expect(person?.companion).toMatchObject({ name: 'Alrik', folder: 'Silk Companions' });
  expect(person?.companion?.pages.map((p) => p.name)).toEqual([
    'Appearance',
    'Personality',
    'Secrets',
    'Connections',
  ]);
  expect(person?.companion?.categories).toEqual(['Player Notes']);
  expect(person?.companion?.flags['companionOf']).toBe(person?.flags['id']);
  expect(person?.flags['companion']).toBeTruthy();

  const creature = await docInfo(gm, await create(gm, 'creature', 'Wolf'));
  expect([creature?.documentName, creature?.type, creature?.folder]).toEqual([
    'Actor',
    'creature',
    'Creatures',
  ]);
  const item = await docInfo(gm, await create(gm, 'item', 'Sword'));
  expect([item?.documentName, item?.type, item?.folder]).toEqual(['Item', 'equipment', 'Items']);
  expect(item?.companion?.pages.map((p) => p.name)).toEqual([
    'Description',
    'Secrets',
    'Connections',
  ]);

  for (const [cls, folder, blocks] of [
    ['location', 'Locations', ['Description', 'Secrets']],
    ['faction', 'Factions', ['Overview', 'Secrets']],
    ['event', 'Events', ['Setup', 'Outcome']],
  ] as const) {
    const doc = await docInfo(gm, await create(gm, cls, `A ${cls}`));
    expect(doc?.folder).toBe(folder);
    expect(doc?.pages.map((p) => [p.name, p.type])).toEqual([
      ['Cover', 'image'],
      ...blocks.map((b) => [b, 'text']),
      ['Connections', 'text'],
    ]);
    expect(doc?.categories).toEqual(['Player Notes']);
    for (const page of doc?.pages ?? []) expect(page.ownership).toBe(0);
  }

  const questId = await create(gm, 'quest', 'Find the Ring');
  const quest = await docInfo(gm, questId);
  expect(quest?.pages.map((p) => p.type)).toEqual(['image', 'dsaquestlog', 'text', 'text', 'text']);
  const questData = await gm.evaluate((id) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(id)?.data['uuid'] as string;
    const doc = fromUuidSync(uuid) as any;
    return doc.pages.get(doc.flags.silk.quest).system.quests[doc.flags.silk.questKey];
  }, questId);
  expect(questData).toMatchObject({
    title: 'Find the Ring',
    visible: false,
    audience: 0,
    status: 0,
  });

  const note = await docInfo(gm, await create(gm, 'note', 'Rumour'));
  expect(note?.pages.map((p) => p.name)).toEqual(['Description']);
  expect(note?.categories).toEqual([]);
});

test('the Creation Pipeline Materializes after the name step, with the typed name', async ({
  gm,
}) => {
  await ready(gm, 'immediate');
  await api(gm, 'canvas.open');
  const pane = gm.locator('[data-silk-canvas] .svelte-flow__pane');
  await expect(pane).toBeVisible();
  await pane.click({ button: 'right', position: { x: 400, y: 300 } });
  await gm.locator('[data-silk-class-search]').fill('Pers');
  await gm.locator('[data-silk-class-search]').press('Enter');
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.type('Pipeline Pete');
  await gm.keyboard.press('Enter');

  const card = gm.locator('[data-silk-node]', { hasText: 'Pipeline Pete' });
  await expect(card).not.toHaveAttribute('data-silk-ghost', '');
  const names = await gm.evaluate(() => game.actors?.map((a) => a.name));
  expect(names).toContain('Pipeline Pete');
  expect(names).not.toContain('Person');
  await gm.evaluate(() => foundry.applications.instances.get('silk-canvas')?.close());
});

test('on demand: Ghosts until materialize.elements / materialize.visible / openSheet', async ({
  gm,
}) => {
  await ready(gm, 'onDemand');
  const a = await create(gm, 'location', 'Ghost Town');
  expect(await docInfo(gm, a)).toBeNull();
  await api(gm, 'materialize.elements', { ids: [a] });
  expect((await docInfo(gm, a))?.name).toBe('Ghost Town');

  // Materialize visible asks first, with the count.
  const b = await create(gm, 'note', 'Ghost Note');
  const run = api<{ ids: string[] }>(gm, 'materialize.visible');
  const dialog = gm.locator('dialog.application', { hasText: 'Player Characters are skipped' });
  await expect(dialog).toBeVisible();
  await dialog.locator('button[data-action="yes"]').click();
  expect((await run).ids).toContain(b);
  expect(await docInfo(gm, b)).not.toBeNull();

  // Opening the sheet of a Ghost Materializes it (with a toast) and renders the sheet.
  const c = await create(gm, 'person', 'Shy Sheet');
  await api(gm, 'element.openSheet', { id: c });
  await expect(gm.locator('#notifications', { hasText: 'Shy Sheet' })).toBeVisible();
  const opened = await gm.evaluate(
    () =>
      [...foundry.applications.instances.values()].some(
        (app: any) => app.document?.name === 'Shy Sheet',
      ) || Object.values(ui.windows).some((app: any) => app.document?.name === 'Shy Sheet'),
  );
  expect(opened).toBe(true);
});

test('write-through to Foundry, and Foundry edits flow back', async ({ gm, player }) => {
  test.setTimeout(90_000);
  await ready(gm, 'immediate');
  const id = await create(gm, 'person', 'Trader');

  await api(gm, 'element.rename', { id, name: 'Trader Tom' });
  await api(gm, 'element.setImage', { id, img: 'icons/svg/aura.svg' });
  await api(gm, 'element.setFields', { id, fields: { merchantType: 'merchant' } });
  const blocks = (await element(gm, id))['infoBlocks'] as { _id: string }[];
  await api(gm, 'infoBlock.edit', { id: blocks[0]?._id, text: '<p>Tall</p>' });
  const { id: extra } = await api<{ id: string }>(gm, 'infoBlock.create', {
    elementId: id,
    name: 'Prices',
  });
  await api(gm, 'element.tag', { ids: [id], tag: 'market' });

  const state = await gm.evaluate(
    ([elementId, blockId]) => {
      const data = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data;
      const actor = fromUuidSync(data?.['uuid'] as string) as any;
      const companion = game.journal?.get(actor.flags.silk.companion) as any;
      return {
        name: actor.name,
        img: actor.img,
        merchant: actor.system.merchant.merchantType,
        companion: companion.name,
        text: companion.pages.get(blockId).text.content,
        pages: companion.pages.size,
        extraOwnership: [...companion.pages].map((p: any) => p.ownership.default),
        flags: actor.flags.silk,
      };
    },
    [id, blocks[0]?._id] as const,
  );
  expect(state).toMatchObject({
    name: 'Trader Tom',
    img: 'icons/svg/aura.svg',
    merchant: 'merchant',
    companion: 'Trader Tom',
    text: '<p>Tall</p>',
    pages: 5,
  });
  expect(new Set(state.extraOwnership)).toEqual(new Set([0]));
  expect(Object.keys(state.flags).sort()).toEqual(['companion', 'id']);
  expect((await element(gm, id))['tags']).toEqual(['market']);

  // Foundry → Silk: edits in Foundry's own UI/API flow back into the element.
  await gm.evaluate(
    async ([elementId, blockId]) => {
      const data = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data;
      const actor = fromUuidSync(data?.['uuid'] as string) as any;
      await actor.update({ name: 'Tom the Trader', 'system.merchant.merchantType': 'loot' });
      const companion = game.journal?.get(actor.flags.silk.companion) as any;
      await companion.updateEmbeddedDocuments('JournalEntryPage', [
        { _id: blockId, name: 'Price list', 'text.content': '<p>Cheap</p>' },
      ]);
      await companion.createEmbeddedDocuments('JournalEntryPage', [
        { name: 'GM Notes', type: 'text', sort: 450000, text: { content: 'x' } },
      ]);
    },
    [id, extra] as const,
  );
  await expect
    .poll(async () => {
      const data = await element(gm, id);
      return {
        name: data['name'],
        fields: data['fields'],
        blocks: (data['infoBlocks'] as { name: string; text: string }[]).map((b) => b.name),
      };
    })
    .toEqual({
      name: 'Tom the Trader',
      fields: { merchantType: 'loot' },
      blocks: ['Appearance', 'Personality', 'Secrets', 'Price list', 'GM Notes'],
    });

  // The player sees none of it (explicit NONE).
  const visible = await player.evaluate(
    (name) =>
      game.actors?.getName(name)?.testUserPermission(game.user as never, 'LIMITED') ?? false,
    'Tom the Trader',
  );
  expect(visible).toBe(false);
});

test('changeClass on real dsa5 docs: Person → Creature, Note → Location', async ({ gm }) => {
  await ready(gm, 'immediate');
  const bear = await create(gm, 'person', 'Bear');
  await api(gm, 'element.changeClass', { id: bear, class: 'creature' });
  expect(await docInfo(gm, bear)).toMatchObject({ type: 'creature', folder: 'Creatures' });

  const tavern = await create(gm, 'note', 'Tavern');
  await api(gm, 'element.changeClass', { id: tavern, class: 'location' });
  const doc = await docInfo(gm, tavern);
  expect(doc?.folder).toBe('Locations');
  expect(doc?.pages.map((p) => p.name)).toEqual(['Cover', 'Description', 'Connections']);
  expect(doc?.categories).toEqual(['Player Notes']);
  await expect(api(gm, 'element.changeClass', { id: tavern, class: 'item' })).rejects.toThrow(
    /same kind/,
  );
});
