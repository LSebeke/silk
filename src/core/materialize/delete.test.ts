import { describe, expect, it } from 'vitest';
import { elementRecord, type ElementData } from '../elements';
import { sheetId } from './lifecycle';
import { setup } from './test-setup';

/** T14 sets `adopted`; until then mark the record by hand. */
async function adopt(t: ReturnType<typeof setup>, id: string) {
  const data = t.workingCopy.get(id)?.data as unknown as ElementData;
  await t.workingCopy.set([elementRecord(id, { ...data, adopted: true })]);
}

describe('element.delete (spec §6)', () => {
  it('a Silk-created element: confirm, then its Connections, docs and records go', async () => {
    const t = setup({ mode: 'immediate', connections: true });
    t.settings.confirmDelete = true;
    const alrik = await t.create('person', 'Alrik');
    const inn = await t.create('location', 'Inn');
    const { id: link } = await t.registry.run<{ id: string }>('connection.create', {
      from: alrik,
      to: inn,
    });
    const actor = t.doc(alrik).uuid;
    const companion = t.companion(alrik).uuid;
    await t.registry.run('materialize.unmaterialize', { ids: [inn] });
    const deleted: { id: string; connections: string[] }[] = [];
    t.lifecycle.contribute({
      deleted: async ({ element, connections }) =>
        void deleted.push({ id: element.id, connections }),
    });

    const { ids } = await t.registry.run<{ ids: string[] }>('element.delete', {
      ids: [alrik, inn],
    });

    expect(ids).toEqual([alrik, inn]);
    expect(t.prompts.delete).toEqual([
      { names: ['Alrik', 'Inn'], adopted: 0, keepFoundryDoc: true },
    ]);
    expect([...t.workingCopy.records().keys()]).toEqual([]);
    expect(t.workingCopy.get(sheetId(inn))).toBeUndefined();
    expect(t.docs.docs.has(actor)).toBe(false);
    expect(t.docs.docs.has(companion)).toBe(false);
    expect(t.docs.docs.size).toBe(0);
    expect(deleted).toEqual([
      { id: alrik, connections: [link] },
      { id: inn, connections: [] },
    ]);
  });

  it('cancel deletes nothing', async () => {
    const t = setup({ mode: 'immediate' });
    t.settings.confirmDelete = true;
    t.answers.delete = null;
    const alrik = await t.create('person', 'Alrik');
    expect(await t.registry.run('element.delete', { ids: [alrik] })).toEqual({ ids: [] });
    expect(t.element(alrik).uuid).toBeDefined();
  });

  it('an Adopted element keeps its Foundry doc by default, without Silk flags', async () => {
    const t = setup({ mode: 'immediate' });
    t.settings.confirmDelete = true;
    const gareth = await t.create('person', 'Gareth');
    await adopt(t, gareth);
    const actor = t.doc(gareth).uuid;
    const companion = t.companion(gareth).uuid;

    await t.registry.run('element.delete', { ids: [gareth] });

    expect(t.prompts.delete[0]?.adopted).toBe(1);
    expect(t.docs.docs.get(actor)?.flags.silk).toEqual({});
    expect(t.docs.docs.has(companion)).toBe(false);
    expect(t.workingCopy.get(gareth)).toBeUndefined();
  });

  it('Delete everything removes an Adopted element’s doc too', async () => {
    const t = setup({ mode: 'immediate' });
    t.settings.confirmDelete = true;
    t.answers.delete = { keepFoundryDoc: false };
    const gareth = await t.create('person', 'Gareth');
    await adopt(t, gareth);
    const actor = t.doc(gareth).uuid;
    await t.registry.run('element.delete', { ids: [gareth] });
    expect(t.docs.docs.has(actor)).toBe(false);
  });

  it('with the confirmation off: no prompt, `keepFoundryDoc` decides (default keep)', async () => {
    const t = setup({ mode: 'immediate' });
    const a = await t.create('person', 'A');
    const b = await t.create('person', 'B');
    await adopt(t, a);
    await adopt(t, b);
    const [docA, docB] = [t.doc(a).uuid, t.doc(b).uuid];
    await t.registry.run('element.delete', { ids: [a] });
    await t.registry.run('element.delete', { ids: [b], keepFoundryDoc: false });
    expect(t.prompts.delete).toEqual([]);
    expect(t.docs.docs.has(docA)).toBe(true);
    expect(t.docs.docs.has(docB)).toBe(false);
  });

  it('without ids it deletes the canvas selection', async () => {
    const t = setup();
    const a = await t.create('note', 'A');
    const b = await t.create('note', 'B');
    t.select([b]);
    await t.registry.run('element.delete', {});
    expect(t.workingCopy.get(a)).toBeDefined();
    expect(t.workingCopy.get(b)).toBeUndefined();
  });
});
