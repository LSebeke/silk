import { describe, expect, it } from 'vitest';
import { readSheet, sheetId } from './lifecycle';
import { must, page, setup } from './test-setup';

/** Foundry deleted the doc (not Silk): what the delete hook hands over. */
function foundryDelete(t: ReturnType<typeof setup>, uuid: string) {
  const doc = must(t.docs.docs.get(uuid), uuid);
  t.docs.docs.delete(uuid);
  return t.lifecycle.docDeleted(doc);
}

describe('Foundry-side deletion (spec §6)', () => {
  it('deleting the doc Unmaterializes, with the snapshot from the delete hook', async () => {
    const t = setup({ mode: 'immediate' });
    const sword = await t.create('item', 'Sword');
    const item = t.doc(sword);
    item.system = { ...item.system, quantity: { value: 3 } };
    const companion = t.companion(sword).uuid;

    await foundryDelete(t, item.uuid);

    expect(t.element(sword)).toBeDefined();
    expect(t.element(sword).uuid).toBeUndefined();
    expect(t.docs.docs.has(companion)).toBe(false);
    const sheet = must(readSheet(t.workingCopy.get(sheetId(sword))));
    expect(sheet.doc.system).toMatchObject({ quantity: { value: 3 } });
    expect(sheet.companion?.pages?.length).toBeGreaterThan(0);
  });

  it('deleting the Companion Journal restores it from the last Commit, with a warning', async () => {
    const t = setup({ mode: 'immediate' });
    const alrik = await t.create('person', 'Alrik');
    const appearance = must(t.element(alrik).infoBlocks[0]);
    await t.registry.run('infoBlock.edit', { id: appearance._id, text: '<p>Tall</p>' });
    await t.lifecycle.capture();
    t.commit('c0ffee00aa');
    await t.registry.run('infoBlock.edit', { id: appearance._id, text: '<p>Uncommitted</p>' });

    await foundryDelete(t, t.companion(alrik).uuid);

    const restored = t.companion(alrik);
    expect(restored._id).toBe(t.doc(alrik).flags.silk.companion);
    expect(restored.flags.silk.companionOf).toBe(alrik);
    expect(page(restored, appearance._id).text?.content).toBe('<p>Tall</p>');
    expect(t.element(alrik).infoBlocks[0]?.text).toBe('<p>Tall</p>');
    expect(t.warnings).toEqual([expect.stringContaining('CompanionRestored')]);
  });

  it('without a Commit, the Companion Journal is rebuilt from the element', async () => {
    const t = setup({ mode: 'immediate' });
    const wolf = await t.create('creature', 'Wolf');
    await foundryDelete(t, t.companion(wolf).uuid);
    expect(t.companion(wolf).pages.map((p) => p.name)).toEqual([
      'Appearance',
      'Description',
      'Connections',
    ]);
  });

  it('other deleted docs go to contributors (Event Scene → clear the link, T13)', async () => {
    const t = setup();
    const seen: string[] = [];
    t.lifecycle.contribute({ docDeleted: async (doc) => (seen.push(doc.uuid), true) });
    await t.lifecycle.docDeleted({
      _id: 'scene00000000001',
      uuid: 'Scene.scene00000000001',
      documentName: 'Scene',
      name: 'Ambush',
      folder: null,
      flags: {},
    });
    expect(seen).toEqual(['Scene.scene00000000001']);
  });
});
