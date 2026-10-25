/** owns ↔ inventory against real dsa5 (spec §5 owns, §6 implicit Materialize, §7 owns). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped dsa5/Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

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

const create = async (page: Page, cls: string, name: string, from?: string) =>
  (
    await api<{ id: string }>(page, 'element.create', {
      class: cls,
      name,
      ...(from ? { from } : {}),
    })
  ).id;

/** Where the element's doc lives: its uuid, parent actor uuid, and Silk flags. */
const where = (page: Page, id: string) =>
  page.evaluate((elementId) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data['uuid'];
    const doc = typeof uuid === 'string' ? (fromUuidSync(uuid) as any) : null;
    return {
      uuid: typeof uuid === 'string' ? uuid : null,
      exists: !!doc,
      parent: doc?.parent?.uuid ?? null,
      flags: doc ? { ...doc.flags.silk } : null,
    };
  }, id);

/** Owner element ids of `item` per the owns Connections. */
const owners = (page: Page, item: string) =>
  page.evaluate((itemId) => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records() as Map<
      string,
      any
    >;
    return [...records.values()]
      .filter((r) => r.kind === 'connection' && r.data.type === 'owns' && r.data.to === itemId)
      .map((r) => r.data.from as string);
  }, item);

const uuidOf = async (page: Page, id: string) => (await where(page, id)).uuid as string;

/** Items in an actor's inventory carrying a Silk id. */
const silkItems = (page: Page, actorUuid: string) =>
  page.evaluate(
    (uuid) =>
      [...(fromUuidSync(uuid) as any).items]
        .filter((i: any) => i.flags.silk?.id)
        .map((i: any) => i.flags.silk.id as string),
    actorUuid,
  );

/** dsa5's own drop handler on the target sheet (Alt = move, removes the source). */
const dropItem = (page: Page, itemUuid: string, targetUuid: string, move: boolean) =>
  page.evaluate(
    async ([item, target, alt]) => {
      const actor = fromUuidSync(target) as any;
      const sheet = actor.sheet;
      await sheet.render(true);
      await new Promise((r) => setTimeout(r, 200));
      const element = sheet.element instanceof HTMLElement ? sheet.element : sheet.element[0];
      await sheet._onDropItem({ altKey: alt, ctrlKey: false, target: element }, fromUuidSync(item));
      await sheet.close();
    },
    [itemUuid, targetUuid, move] as const,
  );

test('owned Items Materialize in the owner’s inventory; unowned as world Items', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm, 'immediate');
  const alrik = await create(gm, 'person', 'Inventory Alrik');
  const sword = await create(gm, 'item', 'Alrik Sword', alrik);
  const ring = await create(gm, 'item', 'Loose Ring');
  const alrikUuid = await uuidOf(gm, alrik);
  await expect.poll(() => where(gm, sword)).toMatchObject({ exists: true, parent: alrikUuid });
  expect(await where(gm, ring)).toMatchObject({ exists: true, parent: null });
  expect(await silkItems(gm, alrikUuid)).toEqual([sword]);

  // A canvas owns between Materialized elements moves the world Item into the inventory.
  await api(gm, 'connection.create', { from: alrik, to: ring, type: 'owns' });
  await expect.poll(() => where(gm, ring)).toMatchObject({ exists: true, parent: alrikUuid });
  expect(await gm.evaluate(() => game.items?.getName('Loose Ring') ?? null)).toBeNull();
});

test('on demand: a new owns with a Materialized actor Materializes the Ghost Item', async ({
  gm,
}) => {
  test.setTimeout(120_000);
  await ready(gm, 'onDemand');
  const wolf = await create(gm, 'creature', 'Demand Wolf');
  await api(gm, 'materialize.elements', { ids: [wolf] });
  const bone = await create(gm, 'item', 'Demand Bone');
  expect((await where(gm, bone)).uuid).toBeNull();
  // Record toasts: the notification queue is shared with dsa5's and Foundry's own.
  await gm.evaluate(() => {
    const n = ui.notifications as any;
    const info = n.info.bind(n);
    (window as any).silkToasts = [];
    n.info = (message: string, options?: object) => {
      (window as any).silkToasts.push(message);
      return info(message, options);
    };
  });
  await api(gm, 'connection.create', { from: wolf, to: bone, type: 'owns' });
  await expect
    .poll(() => where(gm, bone))
    .toMatchObject({
      exists: true,
      parent: await uuidOf(gm, wolf),
    });
  expect(await gm.evaluate(() => (window as any).silkToasts)).toEqual([
    expect.stringContaining('Demand Bone'),
  ]);
});

test('dsa5 drag between actors: copies get no Silk id; a move takes id and owns along', async ({
  gm,
}) => {
  test.setTimeout(150_000);
  await ready(gm, 'immediate');
  const alrik = await create(gm, 'person', 'Drag Alrik');
  const wolf = await create(gm, 'creature', 'Drag Wolf');
  const sword = await create(gm, 'item', 'Drag Sword', alrik);
  const [alrikUuid, wolfUuid] = [await uuidOf(gm, alrik), await uuidOf(gm, wolf)];
  const original = await where(gm, sword);
  expect(original.parent).toBe(alrikUuid);

  // Copy (no Alt): the copy is stripped, the original stays the Item.
  await dropItem(gm, original.uuid as string, wolfUuid, false);
  // dsa5 gives new actors default skills and money: count only the dropped Item.
  const swords = (actor: string) =>
    gm.evaluate(
      (u) =>
        [...(fromUuidSync(u) as any).items]
          .filter((i: any) => i.name === 'Drag Sword')
          .map((i: any) => i.id as string),
      actor,
    );
  await expect.poll(async () => (await swords(wolfUuid)).length).toBe(1);
  await expect.poll(() => silkItems(gm, wolfUuid)).toEqual([]);
  expect(await where(gm, sword)).toMatchObject({ uuid: original.uuid, exists: true });
  expect(await owners(gm, sword)).toEqual([alrik]);
  await gm.evaluate(([u, ids]) => (fromUuidSync(u) as any).deleteEmbeddedDocuments('Item', ids), [
    wolfUuid,
    await swords(wolfUuid),
  ] as const);

  // Move (Alt): dsa5 creates on the target and deletes the source.
  await dropItem(gm, original.uuid as string, wolfUuid, true);
  await expect.poll(() => where(gm, sword)).toMatchObject({ exists: true, parent: wolfUuid });
  expect((await where(gm, sword)).flags).toMatchObject({
    id: sword,
    companion: original.flags?.['companion'],
  });
  await expect.poll(() => owners(gm, sword)).toEqual([wolf]);
  expect(await silkItems(gm, alrikUuid)).toEqual([]);
  expect(await swords(wolfUuid)).toHaveLength(1);
  expect(await swords(alrikUuid)).toEqual([]);

  // Deleted from the inventory: the copy left its actor, owns is deleted.
  await gm.evaluate(async (u) => (fromUuidSync(u) as any).delete(), (await where(gm, sword)).uuid);
  await expect.poll(() => owners(gm, sword)).toEqual([]);
});
