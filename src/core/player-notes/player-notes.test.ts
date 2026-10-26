import { describe, expect, it } from 'vitest';
import { page } from '../materialize/test-setup';
import { setup } from './test-setup';

const OWNER = 3;

async function revealed(t: ReturnType<typeof setup>, cls: string, name: string) {
  const id = await t.create(cls, name);
  await t.run('reveal.element', { id });
  return id;
}

describe('playerNote.create (spec §9 Player Notes)', () => {
  it('creates a page in the Player Notes category, tagged and auto-Revealed in its Campaign', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const { id: note } = await t.registry.run<{ id: string }>('playerNote.create', {
      elementId: id,
      text: '<p>Smells of fish</p>',
    });
    const doc = t.doc(id);
    const p = page(doc, note);
    expect(p.category).toBe(doc.flags.silk.playerNotes);
    expect(p.text?.content).toBe('<p>Smells of fish</p>');
    expect(p.flags?.silk?.campaign).toBe('camp1');
    expect(t.level(p)).toBe(OWNER);
    expect(t.map().playerNotes).toEqual([note]);
    expect(t.element(id).playerNotes).toEqual([
      { _id: note, name: expect.any(String), text: '<p>Smells of fish</p>', campaign: 'camp1' },
    ]);
    // Not an Info Block.
    expect(t.element(id).infoBlocks.map((b) => b._id)).not.toContain(note);
  });
});

const NONE = 0;
const OBSERVER = 2;

async function note(t: ReturnType<typeof setup>, elementId: string, text = '<p>n</p>') {
  return (await t.registry.run<{ id: string }>('playerNote.create', { elementId, text })).id;
}

describe('playerNote.create: who and where', () => {
  it('an Actor element: page in the Companion Journal, which becomes OBSERVER', async () => {
    const t = setup();
    const id = await revealed(t, 'person', 'Alrik');
    expect(t.level(t.companion(id))).toBe(NONE);
    const n = await note(t, id);
    const companion = t.companion(id);
    expect(page(companion, n).category).toBe(companion.flags.silk.playerNotes);
    expect(t.level(page(companion, n))).toBe(OWNER);
    expect(t.level(companion)).toBe(OBSERVER);
  });

  it('a player relays to the active GM; with no GM online it is unavailable', async () => {
    const t = setup();
    const id = await revealed(t, 'faction', 'Gilde');
    t.setGM(false);
    const n = await note(t, id, '<p>from a player</p>');
    expect(t.relayed).toEqual([
      { name: 'playerNote.create', args: { elementId: id, text: '<p>from a player</p>' } },
    ]);
    expect(t.element(id).playerNotes?.map((x) => x._id)).toEqual([n]);
    t.setGmOnline(false);
    expect(t.registry.isAvailable('playerNote.create')).toBe(false);
    expect(t.registry.isAvailable('playerNote.convert')).toBe(false);
  });

  it('only on Revealed elements', async () => {
    const t = setup();
    const id = await t.create('location', 'Gareth');
    await t.run('materialize.elements', { ids: [id] });
    await expect(note(t, id)).rejects.toThrow(/Revealed/);
  });

  it('a Note element (no journal layout) gets a Player Notes category on its first note', async () => {
    const t = setup();
    const id = await revealed(t, 'note', 'Rumour');
    const n = await note(t, id);
    const doc = t.doc(id);
    expect(doc.categories.map((c) => c._id)).toContain(doc.flags.silk.playerNotes);
    expect(page(doc, n).category).toBe(doc.flags.silk.playerNotes);
    expect(t.element(id).infoBlocks.map((b) => b._id)).not.toContain(n);
  });
});

describe('Player Notes and Reveal (spec §8, §9)', () => {
  it('un-reveal hides the notes, re-Reveal brings them back', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const n = await note(t, id);
    await t.run('reveal.element', { id, revealed: false });
    expect(t.level(page(t.doc(id), n))).toBe(NONE);
    expect(t.map().playerNotes).toEqual([n]);
    await t.run('reveal.element', { id });
    expect(t.level(page(t.doc(id), n))).toBe(OWNER);
  });

  it('another Campaign sees the note as NONE until its GM Reveals it', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const n = await note(t, id);
    t.checkout('camp2');
    await t.reveal.applyMap({ ...t.map(), playerNotes: [] });
    expect(t.level(page(t.doc(id), n))).toBe(NONE);
    await t.run('reveal.playerNote', { id: n });
    expect(t.level(page(t.doc(id), n))).toBe(OWNER);
    expect(t.maps.get('camp2')?.playerNotes).toEqual([n]);
    expect(page(t.doc(id), n).flags?.silk?.campaign).toBe('camp1');
  });
});

describe('playerNote.edit / delete', () => {
  it('any player edits and deletes any note (through the GM)', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const n = await note(t, id, '<p>old</p>');
    t.setGM(false);
    await t.run('playerNote.edit', { id: n, text: '<p>new</p>' });
    expect(page(t.doc(id), n).text?.content).toBe('<p>new</p>');
    expect(t.element(id).playerNotes?.[0]?.text).toBe('<p>new</p>');
    await t.run('playerNote.delete', { id: n });
    expect(t.doc(id).pages.some((p) => p._id === n)).toBe(false);
    expect(t.element(id).playerNotes).toBeUndefined();
    expect(t.map().playerNotes).toEqual([]);
    expect(t.relayed.map((r) => r.name)).toEqual(['playerNote.edit', 'playerNote.delete']);
  });
});

describe('playerNote.convert (Convert to GM Info Block)', () => {
  it('Revealed: leaves the category, OBSERVER, stays Revealed as a block, tag dropped', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const n = await note(t, id, '<p>keep</p>');
    await t.run('playerNote.convert', { id: n });
    const p = page(t.doc(id), n);
    expect(p.category ?? null).toBeNull();
    expect(p.flags?.silk?.campaign).toBeUndefined();
    expect(t.level(p)).toBe(OBSERVER);
    expect(t.element(id).playerNotes).toBeUndefined();
    expect(t.element(id).infoBlocks.at(-1)).toEqual({ _id: n, name: p.name, text: '<p>keep</p>' });
    expect(t.map().playerNotes).toEqual([]);
    expect(t.map().infoBlocks).toContain(n);
  });

  it('not Revealed here: NONE; still Revealed (as a block) in its authoring Campaign', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const n = await note(t, id);
    t.checkout('camp2');
    await t.reveal.applyMap({ ...t.map(), playerNotes: [] });
    await t.run('playerNote.convert', { id: n });
    expect(t.level(page(t.doc(id), n))).toBe(NONE);
    expect(t.maps.get('camp1')?.infoBlocks).toContain(n);
  });
});

describe('Player Notes in the Canon (spec §11.2)', () => {
  it('a Ghost whose record holds notes Materializes them into the category', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    const data: Record<string, unknown> = { ...t.element(id) };
    delete data['id'];
    const pn = { _id: 'pn1', name: 'Player Note', text: '<p>x</p>', campaign: 'camp1' };
    await t.workingCopy.set([
      { kind: 'element', id, data: { ...data, playerNotes: [pn] } as never },
    ]);
    await t.run('materialize.elements', { ids: [id] });
    const companion = t.companion(id);
    const p = page(companion, 'pn1');
    expect(p.category).toBe(companion.flags.silk.playerNotes);
    expect(p.flags?.silk?.campaign).toBe('camp1');
    expect(t.element(id).playerNotes).toEqual([pn]);
  });

  it('retag (Join Campaigns): notes of one Campaign move to another', async () => {
    const t = setup();
    const id = await revealed(t, 'location', 'Gareth');
    const n = await note(t, id);
    await t.notes.retag('camp1', 'camp9');
    expect(page(t.doc(id), n).flags?.silk?.campaign).toBe('camp9');
    expect(t.element(id).playerNotes?.[0]?.campaign).toBe('camp9');
  });
});
