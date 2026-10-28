import { describe, expect, it } from 'vitest';
import { must, page, pageNames, setup } from './test-setup';

describe('Materialize: journal layout (spec §4)', () => {
  it('a Location becomes a JournalEntry: Cover, Info Blocks, Connections, Player Notes category', async () => {
    const t = setup();
    const id = await t.create('location', 'Gareth');
    await t.registry.run('materialize.elements', { ids: [id] });

    const doc = t.doc(id);
    expect([doc.documentName, doc.name, doc.flags.silk.id]).toEqual(['JournalEntry', 'Gareth', id]);
    expect(pageNames(doc)).toEqual(['Cover', 'Description', 'Secrets', 'Connections']);
    expect(page(doc, doc.flags.silk.cover).type).toBe('image');
    expect(page(doc, doc.flags.silk.connections).type).toBe('text');
    expect(doc.categories).toEqual([
      { _id: doc.flags.silk.playerNotes, name: 'PlayerNotes', sort: 0 },
    ]);
  });
});

describe('Materialize: class → doc mapping (spec §4)', () => {
  it('a Person becomes an npc Actor with a Companion Journal linked both ways', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await t.registry.run('materialize.elements', { ids: [id] });

    const actor = t.doc(id);
    expect([actor.documentName, actor.type, actor.name]).toEqual(['Actor', 'npc', 'Alrik']);
    const companion = t.companion(id);
    expect(companion.name).toBe('Alrik');
    expect(companion.flags.silk.companionOf).toBe(id);
    expect(t.materializer.elementIdOf(companion)).toBe(id);
    expect(t.materializer.elementIdOf(actor)).toBe(id);
    expect(pageNames(companion)).toEqual(['Appearance', 'Personality', 'Secrets', 'Connections']);
    expect(companion.categories.map((c) => c.name)).toEqual(['PlayerNotes']);
  });

  it('files docs into per-class folders and "Silk Companions" (§8)', async () => {
    const t = setup();
    const a = await t.create('person', 'A');
    const b = await t.create('person', 'B');
    const c = await t.create('location', 'C');
    await t.registry.run('materialize.elements', { ids: [a, b, c] });
    expect(t.docs.folders.map((f) => [f.type, f.key, f.name])).toEqual([
      ['Actor', 'person', 'person'],
      ['JournalEntry', 'companions', 'companions'],
      ['JournalEntry', 'location', 'location'],
    ]);
    expect(t.doc(a).folder).toBe(t.doc(b).folder);
    expect(t.companion(a).folder).toBe('folder2');
    expect(t.doc(c).folder).toBe('folder3');
  });

  it('Creature → creature Actor, Item → equipment Item, both with Companion Journals', async () => {
    const t = setup();
    const wolf = await t.create('creature', 'Wolf');
    const sword = await t.create('item', 'Sword');
    await t.registry.run('materialize.elements', { ids: [wolf, sword] });
    expect([t.doc(wolf).documentName, t.doc(wolf).type]).toEqual(['Actor', 'creature']);
    expect([t.doc(sword).documentName, t.doc(sword).type]).toEqual(['Item', 'equipment']);
    expect(t.companion(sword).flags.silk.companionOf).toBe(sword);
  });

  it('a Quest journal holds one dsaquestlog quest: hidden, Party audience, titled', async () => {
    const t = setup();
    const id = await t.create('quest', 'Find the Ring');
    await t.registry.run('materialize.elements', { ids: [id] });
    const doc = t.doc(id);
    const quest = page(doc, doc.flags.silk.quest);
    expect(quest.type).toBe('dsaquestlog');
    expect(quest.system).toEqual({
      quests: {
        [doc.flags.silk.questKey]: {
          title: 'Find the Ring',
          status: 0,
          audience: 0,
          visible: false,
        },
      },
    });
    expect(t.element(id).infoBlocks.map((b) => b.name)).toEqual(['Hook', 'Resolution']);
  });

  it('a Note is a plain journal: Info Blocks only, no layout', async () => {
    const t = setup();
    const id = await t.create('note', 'Rumour');
    await t.registry.run('materialize.elements', { ids: [id] });
    const doc = t.doc(id);
    expect(pageNames(doc)).toEqual(['Description']);
    expect(doc.categories).toEqual([]);
    expect(doc.flags.silk).toEqual({ id });
  });

  it('Silk-created docs and pages get explicit player ownership NONE (§8 Defaults)', async () => {
    const t = setup();
    const ids = [await t.create('person', 'P'), await t.create('event', 'E')];
    await t.registry.run('materialize.elements', { ids });
    expect(t.docs.docs.size).toBe(3);
    for (const doc of t.docs.docs.values()) {
      expect(doc.ownership).toEqual({ default: 0 });
      for (const p of doc.pages ?? []) expect(p.ownership).toEqual({ default: 0 });
    }
  });

  it('flags.silk holds ids only (§2)', async () => {
    const t = setup();
    const ids = [
      await t.create('person', 'P'),
      await t.create('quest', 'Q'),
      await t.create('location', 'L'),
    ];
    await t.registry.run('materialize.elements', { ids });
    for (const doc of t.docs.docs.values())
      for (const value of Object.values(doc.flags.silk)) expect(value).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('Ghost Info Blocks become pages with the same ids; the record mirrors them', async () => {
    const t = setup();
    const id = await t.create('location', 'Gareth');
    const [first, second] = t.element(id).infoBlocks.map((b) => b._id);
    await t.registry.run('infoBlock.edit', { id: first, text: '<p>Big city</p>' });
    await t.registry.run('materialize.elements', { ids: [id] });
    expect(page(t.doc(id), must(first)).text?.content).toBe('<p>Big city</p>');
    expect(t.element(id).infoBlocks).toEqual([
      { _id: first, name: 'Description', text: '<p>Big city</p>' },
      { _id: second, name: 'Secrets', text: '' },
    ]);
  });

  it('skips Player Characters and already Materialized elements', async () => {
    const t = setup();
    const id = await t.create('note', 'N');
    const hero = { class: 'playerCharacter', name: 'Hero', position: { x: 0, y: 0 } };
    await t.workingCopy.set([{ kind: 'element', id: 'pc', data: hero }]);
    expect(await t.registry.run('materialize.elements', { ids: [id, 'pc'] })).toEqual({
      ids: [id],
    });
    expect(await t.registry.run('materialize.elements', { ids: [id] })).toEqual({ ids: [] });
    expect(t.docs.docs.size).toBe(1);
  });
});
