import { describe, expect, it } from 'vitest';
import type { CanonRecord, Snapshot } from '../canon';
import { createDocRewriter } from './rewrite';
import { must, page, pageNames, setup } from './test-setup';

/** The working copy now, with `change` applied to some records (`null` deletes). */
function resultOf(
  records: Snapshot,
  change: Record<string, ((r: CanonRecord) => CanonRecord) | null>,
): Snapshot {
  const out = new Map(records);
  for (const [id, fn] of Object.entries(change)) {
    const record = out.get(id);
    if (fn === null) out.delete(id);
    else if (record) out.set(id, fn(record));
  }
  return out;
}

const withData =
  (patch: Record<string, unknown>) =>
  (r: CanonRecord): CanonRecord => ({ ...r, data: { ...r.data, ...patch } as CanonRecord['data'] });

function rig() {
  const t = setup({ mode: 'immediate' });
  const rewriter = createDocRewriter({
    workingCopy: () => t.workingCopy,
    docs: t.docs,
    materializer: t.materializer,
    lifecycle: t.lifecycle,
  });
  return { ...t, rewriter };
}

describe('rewriting the World to a merge result (spec §11.3)', () => {
  it('writes Player Notes like Info Blocks (§9: merged into the Canon)', async () => {
    const t = rig();
    const wolf = await t.create('creature', 'Wolf');
    const note = { _id: 'note00000000001', name: 'Player Note', text: '<p>a</p>', campaign: 'c1' };
    await t.rewriter.apply(
      resultOf(t.workingCopy.records(), { [wolf]: withData({ playerNotes: [note] }) }),
    );
    const companion = t.companion(wolf);
    expect(page(companion, note._id).category).toBe(companion.flags.silk.playerNotes);
    expect(t.element(wolf).playerNotes).toEqual([note]);

    await t.rewriter.apply(
      resultOf(t.workingCopy.records(), {
        [wolf]: withData({ playerNotes: [{ ...note, text: '<p>b</p>' }] }),
      }),
    );
    expect(page(t.companion(wolf), note._id).text?.content).toBe('<p>b</p>');

    await t.rewriter.apply(
      resultOf(t.workingCopy.records(), { [wolf]: withData({ playerNotes: undefined }) }),
    );
    expect(t.companion(wolf).pages.some((p) => p._id === note._id)).toBe(false);
    expect(t.element(wolf).playerNotes).toBeUndefined();
  });

  it('writes name, image and Info Blocks of a Materialized element to its docs', async () => {
    const t = rig();
    const wolf = await t.create('creature', 'Wolf');
    const [appearance, description] = must(t.element(wolf).infoBlocks);
    const result = resultOf(t.workingCopy.records(), {
      [wolf]: withData({
        name: 'Dire Wolf',
        img: 'wolf.webp',
        infoBlocks: [
          { ...must(appearance), text: '<p>Huge</p>' },
          { _id: 'newblock0000000', name: 'Tactics', text: '<p>Packs</p>' },
        ],
      }),
    });

    await t.rewriter.apply(result);

    expect(t.doc(wolf).name).toBe('Dire Wolf');
    expect(t.doc(wolf).img).toBe('wolf.webp');
    expect(t.companion(wolf).name).toBe('Dire Wolf');
    expect(pageNames(t.companion(wolf))).toEqual(['Appearance', 'Tactics', 'Connections']);
    expect(page(t.companion(wolf), must(appearance)._id).text?.content).toBe('<p>Huge</p>');
    expect(t.companion(wolf).pages.some((p) => p._id === must(description)._id)).toBe(false);
    expect(t.element(wolf)).toMatchObject({ name: 'Dire Wolf', img: 'wolf.webp' });
    expect(t.element(wolf).infoBlocks.map((b) => b.name)).toEqual(['Appearance', 'Tactics']);
  });

  it('sets Status and class fields; keeps Silk-owned fields as the result has them', async () => {
    const t = rig();
    const alrik = await t.create('person', 'Alrik');
    const result = resultOf(t.workingCopy.records(), {
      [alrik]: withData({
        status: 'dead',
        fields: { merchantType: 'merchant' },
        tags: ['villain'],
        position: { x: 50, y: 60 },
      }),
    });

    await t.rewriter.apply(result);

    expect(t.element(alrik)).toMatchObject({
      status: 'dead',
      fields: { merchantType: 'merchant' },
      tags: ['villain'],
      position: { x: 50, y: 60 },
    });
    expect(
      (t.doc(alrik).system as { merchant?: { merchantType?: string } }).merchant?.merchantType,
    ).toBe('merchant');
  });

  it('syncs an actor’s embedded Items by id: creates, updates, deletes (spec §11.4)', async () => {
    const t = rig();
    const alrik = await t.create('person', 'Alrik');
    const actor = t.doc(alrik).uuid;
    const item = (id: string, name: string, quantity: number) => ({
      _id: id,
      name,
      type: 'equipment',
      folder: null,
      flags: { silk: {} },
      system: { quantity: { value: quantity } },
    });
    await t.docs.create('Item', item('sword', 'Sword', 1), actor);
    await t.docs.create('Item', item('torch', 'Torch', 3), actor);
    await t.lifecycle.capture();
    const sheetId = `${alrik}-sheet`;
    const sheet = must(t.workingCopy.get(sheetId));
    const doc = (items: object[]) =>
      ({
        ...sheet,
        data: { ...sheet.data, doc: { ...(sheet.data.doc as object), items } },
      }) as CanonRecord;
    await t.workingCopy.set([doc([item('sword', 'Sword', 1), item('torch', 'Torch', 3)])]);
    const result = new Map(t.workingCopy.records());
    result.set(sheetId, doc([item('sword', 'Sword', 2), item('rope', 'Rope', 1)]));

    await t.rewriter.apply(result);

    expect(t.docs.docs.get(`${actor}.Item.sword`)?.system).toEqual({ quantity: { value: 2 } });
    expect(t.docs.docs.get(`${actor}.Item.rope`)?.name).toBe('Rope');
    expect(t.docs.docs.has(`${actor}.Item.torch`)).toBe(false);
  });

  it('deletes the docs of elements the result no longer has', async () => {
    const t = rig();
    const alrik = await t.create('person', 'Alrik');
    const uuid = t.doc(alrik).uuid;
    const companion = t.companion(alrik).uuid;

    await t.rewriter.apply(resultOf(t.workingCopy.records(), { [alrik]: null }));

    expect(t.docs.docs.has(uuid)).toBe(false);
    expect(t.docs.docs.has(companion)).toBe(false);
    expect(t.workingCopy.get(alrik)).toBeUndefined();
  });

  it('a result element Materialized only in another World becomes a Ghost here', async () => {
    const t = rig();
    const alrik = await t.create('person', 'Alrik');
    const result = resultOf(t.workingCopy.records(), {});
    const added: CanonRecord = {
      kind: 'element',
      id: 'el-elsewhere',
      data: { class: 'person', name: 'Elsewhere', position: { x: 0, y: 0 }, uuid: 'Actor.zzz' },
    };
    (result as Map<string, CanonRecord>).set(added.id, added);

    await t.rewriter.apply(result);

    expect(t.element('el-elsewhere').uuid).toBeUndefined();
    expect(t.element(alrik).uuid).toBeDefined();
  });

  it('Ghost changes just land in the working copy', async () => {
    const t = rig();
    t.setMode('onDemand');
    const ghost = await t.create('note', 'Idea');

    await t.rewriter.apply(
      resultOf(t.workingCopy.records(), { [ghost]: withData({ name: 'Better idea' }) }),
    );

    expect(t.element(ghost).name).toBe('Better idea');
    expect(t.docs.docs.size).toBe(0);
  });
});
