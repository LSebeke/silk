import { describe, expect, it } from 'vitest';
import { sourceData } from './owns';
import { setup } from './test-setup';

describe('owns: where an Item Materializes (spec §5 owns)', () => {
  it('owned by a Materialized actor → embedded in its inventory; unowned → world Item', async () => {
    const t = setup();
    const alrik = await t.create('person', 'Alrik');
    const sword = await t.create('item', 'Sword');
    const ring = await t.create('item', 'Ring');
    await t.materialize(alrik);
    await t.connect(alrik, sword);
    t.setMode('immediate');
    await t.materialize(ring);
    expect(t.doc(sword).parent).toBe(t.doc(alrik).uuid);
    expect(t.doc(sword).folder).toBeNull();
    expect(t.element(sword).uuid).toBe(`${t.doc(alrik).uuid}.Item.${t.doc(sword)._id}`);
    expect(t.doc(ring).parent).toBeUndefined();
    expect(t.doc(ring).folder).toBeTruthy();
  });
});

describe('owns: Silk-driven changes move the doc', () => {
  it('Materializing the owner pulls its world Item into the inventory', async () => {
    const t = setup({ mode: 'immediate' });
    t.setMode('onDemand');
    const alrik = await t.create('person', 'Alrik');
    const sword = await t.create('item', 'Sword');
    await t.materialize(sword);
    t.setMode('immediate');
    await t.connect(alrik, sword);
    expect(t.element(alrik).uuid).toBeUndefined();
    expect(t.doc(sword).parent).toBeUndefined();
    await t.materialize(alrik);
    expect(t.doc(sword).parent).toBe(t.doc(alrik).uuid);
    expect([...t.docs.docs.keys()].filter((k) => k.includes('Item'))).toEqual([
      t.element(sword).uuid,
    ]);
  });

  it('a new owner moves the Item between inventories; deleting owns makes it a world Item', async () => {
    const t = setup();
    const alrik = await t.create('person', 'Alrik');
    const wolf = await t.create('creature', 'Wolf');
    const sword = await t.create('item', 'Sword');
    await t.materialize(alrik, wolf, sword);
    const first = await t.connect(alrik, sword);
    const swordDoc = t.doc(sword);
    const second = await t.connect(wolf, sword);
    expect(t.doc(sword).parent).toBe(t.doc(wolf).uuid);
    expect(t.docs.get(swordDoc.uuid)).toBeUndefined();
    expect(t.doc(sword).flags.silk).toEqual(swordDoc.flags.silk);
    expect(t.workingCopy.get(first)).toBeUndefined();
    await t.registry.run('connection.delete', { ids: [second] });
    expect(t.doc(sword).parent).toBeUndefined();
    expect(t.doc(sword).folder).toBeTruthy();
  });
});

describe('owns: implicit Materialize (spec §6 on demand)', () => {
  it('a new owns from a Ghost actor to a Materialized Item Materializes the actor, with a toast', async () => {
    const t = setup();
    const alrik = await t.create('person', 'Alrik');
    const sword = await t.create('item', 'Sword');
    await t.materialize(sword);
    await t.connect(alrik, sword);
    expect(t.element(alrik).uuid).toBeTruthy();
    expect(t.doc(sword).parent).toBe(t.doc(alrik).uuid);
    expect(t.toasts).toEqual(['Implicit']);
  });

  it('only on demand, and only with a Materialized end', async () => {
    const t = setup();
    const alrik = await t.create('person', 'Alrik');
    const sword = await t.create('item', 'Sword');
    await t.connect(alrik, sword);
    expect(t.element(alrik).uuid ?? t.element(sword).uuid).toBeUndefined();
    const wolf = await t.create('creature', 'Wolf');
    await t.materialize(wolf);
    t.setMode('immediate');
    await t.connect(wolf, sword);
    expect(t.element(sword).uuid).toBeUndefined();
    expect(t.toasts).toEqual([]);
  });

  it('create-from inside the Creation Pipeline waits for the name step', async () => {
    const t = setup();
    const alrik = await t.create('person', 'Alrik');
    await t.materialize(alrik);
    t.setDeferring(true);
    const sword = await t.create('item', 'Item', alrik);
    expect(t.owners(sword)).toEqual([alrik]);
    expect(t.element(sword).uuid).toBeUndefined();
    await t.registry.run('element.rename', { id: sword, name: 'Sword' });
    t.setDeferring(false);
    await t.owns.afterPipeline(sword);
    expect(t.doc(sword).name).toBe('Sword');
    expect(t.doc(sword).parent).toBe(t.doc(alrik).uuid);
  });

  it('immediate mode: create-from a Materialized actor embeds the new Item', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    const sword = await t.create('item', 'Sword', alrik);
    expect(t.doc(sword).parent).toBe(t.doc(alrik).uuid);
    expect(t.toasts).toEqual([]);
  });
});

describe('owns: Foundry-driven changes move the Connection (spec §7 owns)', () => {
  async function owned() {
    const t = setup();
    const alrik = await t.create('person', 'Alrik');
    const wolf = await t.create('creature', 'Wolf');
    const sword = await t.create('item', 'Sword');
    await t.materialize(alrik, wolf, sword);
    await t.connect(alrik, sword);
    return { t, alrik, wolf, sword };
  }

  it('copies get no Silk id; the original keeps it and owns stays', async () => {
    const { t, alrik, sword } = await owned();
    const original = t.doc(sword);
    const world = await t.copyItem(original);
    const same = await t.copyItem(original, original.parent);
    for (const uuid of [world, same]) expect(t.docs.get(uuid)?.flags.silk).toEqual({});
    expect(t.element(sword).uuid).toBe(original.uuid);
    expect(t.owners(sword)).toEqual([alrik]);
  });

  it('a move between Story actors (copy, then delete the original) moves the id and owns', async () => {
    const { t, wolf, sword } = await owned();
    const original = t.doc(sword);
    const copy = await t.copyItem(original, t.doc(wolf).uuid);
    t.tick(500);
    expect(await t.deleteItem(original.uuid)).toBe(true); // no Unmaterialize (T9)
    expect(t.element(sword).uuid).toBe(copy);
    expect(t.doc(sword).flags.silk).toEqual(original.flags.silk);
    expect(t.owners(sword)).toEqual([wolf]);
  });

  it('moved to an actor that is no Story Element: owns is deleted, the id still moves', async () => {
    const { t, sword } = await owned();
    const stranger = await t.docs.create('Actor', {
      _id: 'stranger',
      name: 'X',
      folder: null,
      flags: { silk: {} },
    });
    const original = t.doc(sword);
    const copy = await t.copyItem(original, stranger);
    await t.deleteItem(original.uuid);
    expect(t.element(sword).uuid).toBe(copy);
    expect(t.owners(sword)).toEqual([]);
  });

  it('deleted from the inventory without a move: owns is deleted', async () => {
    const { t, sword } = await owned();
    expect(await t.deleteItem(t.doc(sword).uuid)).toBe(false);
    expect(t.owners(sword)).toEqual([]);
  });

  it('a copy made long before the original is deleted is no move', async () => {
    const { t, wolf, sword } = await owned();
    const original = t.doc(sword);
    await t.copyItem(original, t.doc(wolf).uuid);
    t.tick(60_000);
    expect(await t.deleteItem(original.uuid)).toBe(false);
    expect(t.element(sword).uuid).toBe(original.uuid);
    expect(t.owners(sword)).toEqual([]);
  });

  it('a copied actor’s inventory holds copies: their Silk ids are stripped', async () => {
    const { t, alrik, sword } = await owned();
    const actor = sourceData(t.doc(alrik));
    const item = sourceData(t.doc(sword));
    const copy = await t.docs.create('Actor', { ...actor, _id: 'copy', flags: { silk: {} } });
    await t.docs.create('Item', item, copy);
    await t.owns.actorCreated({
      ...actor,
      _id: 'copy',
      uuid: copy,
      documentName: 'Actor',
      items: [{ ...item, _id: item._id }],
    });
    expect(t.docs.get(`${copy}.Item.${item._id}`)?.flags.silk).toEqual({});
    expect(t.doc(sword).flags.silk.id).toBe(sword);
  });
});
