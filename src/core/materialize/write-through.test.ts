import { describe, expect, it } from 'vitest';
import { must, page, pageNames, setup } from './test-setup';

describe('write-through and Foundry edits flowing back (spec §7)', () => {
  it('rename writes the doc, its Companion Journal and the quest title', async () => {
    const t = setup({ mode: 'immediate' });
    const person = await t.create('person', 'P');
    const quest = await t.create('quest', 'Q');
    await t.registry.run('element.rename', { id: person, name: 'Alrik' });
    await t.registry.run('element.rename', { id: quest, name: 'The Ring' });
    expect(t.doc(person).name).toBe('Alrik');
    expect(t.companion(person).name).toBe('Alrik');
    const q = t.doc(quest);
    expect(q.name).toBe('The Ring');
    const system = page(q, q.flags.silk.quest).system as {
      quests: Record<string, { title: string }>;
    };
    expect(system.quests[q.flags.silk.questKey]?.title).toBe('The Ring');
  });

  it('setImage: Actor/Item img, journal Cover page, Ghost and Note in the record', async () => {
    const t = setup();
    const person = await t.create('person', 'P');
    const place = await t.create('location', 'L');
    const note = await t.create('note', 'N');
    await t.registry.run('element.setImage', { id: person, img: 'a.webp' });
    expect(t.element(person).img).toBe('a.webp');
    await t.registry.run('materialize.elements', { ids: [person, place, note] });
    expect(t.doc(person).img).toBe('a.webp');
    await t.registry.run('element.setImage', { id: person, img: 'b.webp' });
    await t.registry.run('element.setImage', { id: place, img: 'map.webp' });
    await t.registry.run('element.setImage', { id: note, img: 'n.webp' });
    expect(t.doc(person).img).toBe('b.webp');
    expect(page(t.doc(place), t.doc(place).flags.silk.cover).src).toBe('map.webp');
    expect([t.element(person).img, t.element(place).img, t.element(note).img]).toEqual([
      'b.webp',
      'map.webp',
      'n.webp',
    ]);
  });

  it('Info Blocks of a Materialized element are pages: create, edit, delete', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('creature', 'Wolf');
    const { id: block } = await t.registry.run<{ id: string }>('infoBlock.create', {
      elementId: id,
      name: 'Tactics',
      text: '<p>Packs</p>',
    });
    expect(pageNames(t.companion(id))).toEqual([
      'Appearance',
      'Description',
      'Tactics',
      'Connections',
    ]);
    expect(page(t.companion(id), block).ownership).toEqual({ default: 0 });

    await t.registry.run('infoBlock.edit', { id: block, name: 'Hunting', text: '<p>Night</p>' });
    const edited = page(t.companion(id), block);
    expect([edited.name, edited.text?.content]).toEqual(['Hunting', '<p>Night</p>']);
    expect(t.element(id).infoBlocks.at(-1)).toEqual({
      _id: block,
      name: 'Hunting',
      text: '<p>Night</p>',
    });

    await t.registry.run('infoBlock.delete', { id: t.element(id).infoBlocks[0]?._id });
    expect(pageNames(t.companion(id))).toEqual(['Description', 'Hunting', 'Connections']);
    expect(t.element(id).infoBlocks.map((b) => b.name)).toEqual(['Description', 'Hunting']);
  });

  it('Info Blocks of a Ghost live in the record', async () => {
    const t = setup();
    const id = await t.create('faction', 'Guild');
    const { id: block } = await t.registry.run<{ id: string }>('infoBlock.create', {
      elementId: id,
    });
    expect(t.element(id).infoBlocks.map((b) => b.name)).toEqual(['Overview', 'Secrets', 'New']);
    await t.registry.run('infoBlock.delete', { id: block });
    expect(t.element(id).infoBlocks.map((b) => b.name)).toEqual(['Overview', 'Secrets']);
    expect(t.docs.docs.size).toBe(0);
  });

  it('class field merchantType writes system.merchant.merchantType', async () => {
    const t = setup();
    const id = await t.create('person', 'Trader');
    await t.registry.run('element.setFields', { id, fields: { merchantType: 'merchant' } });
    await t.registry.run('materialize.elements', { ids: [id] });
    expect(t.doc(id).system).toEqual({ merchant: { merchantType: 'merchant' } });
    await t.registry.run('element.setFields', { id, fields: { merchantType: 'loot' } });
    expect(t.doc(id).system).toEqual({ merchant: { merchantType: 'loot' } });
    expect(t.element(id).fields).toEqual({ merchantType: 'loot' });
  });

  it('Foundry edits (name, img, pages, system) flow back into the record on sync', async () => {
    const t = setup({ mode: 'immediate' });
    const person = await t.create('person', 'P');
    const place = await t.create('location', 'L');
    const actor = t.doc(person);
    actor.name = 'Renamed';
    actor.img = 'x.webp';
    actor.system = { merchant: { merchantType: 'epic' } };
    const companion = t.companion(person);
    companion.pages.push(
      {
        _id: 'gmpage',
        name: 'GM page',
        type: 'text',
        sort: 900_000,
        ownership: { default: -1 },
        text: { content: 'hi' },
      },
      {
        _id: 'pnote',
        name: 'Note',
        type: 'text',
        sort: 1,
        ownership: { default: 3 },
        category: companion.flags.silk.playerNotes,
        text: { content: 'player' },
      },
    );
    const journal = t.doc(place);
    const cover = page(journal, journal.flags.silk.cover);
    cover.src = 'map.webp';
    await t.materializer.sync(person);
    await t.materializer.sync(place);

    const el = t.element(person);
    expect([el.name, el.img, el.fields]).toEqual(['Renamed', 'x.webp', { merchantType: 'epic' }]);
    expect(el.infoBlocks.map((b) => b.name)).toEqual([
      'Appearance',
      'Personality',
      'Secrets',
      'GM page',
    ]);
    expect(t.element(place).img).toBe('map.webp');
    cover.src = null;
    await t.materializer.sync(place);
    expect(t.element(place).img).toBeUndefined();
  });

  it('sync of a missing doc changes nothing (deletion is Unmaterialize, T9)', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('note', 'N');
    t.docs.docs.clear();
    const before = t.workingCopy.get(id);
    await t.materializer.sync(id);
    expect(t.workingCopy.get(id)).toBe(before);
  });

  it('tags are Silk-owned, sorted and unique', async () => {
    const t = setup();
    const a = await t.create('note', 'A');
    const b = await t.create('note', 'B');
    await t.registry.run('element.tag', { ids: [a, b], tag: 'act 1' });
    await t.registry.run('element.tag', { ids: [a], tag: 'Act 0' });
    await t.registry.run('element.tag', { ids: [a], tag: 'act 1' });
    expect(t.element(a).tags).toEqual(['Act 0', 'act 1']);
    await t.registry.run('element.untag', { ids: [a, b], tag: 'act 1' });
    expect([t.element(a).tags, t.element(b).tags]).toEqual([['Act 0'], undefined]);
  });
});

describe('element.changeClass (spec §4 Class change)', () => {
  it('stays within the doc kind; never into or out of Player Character', async () => {
    const t = setup();
    const id = await t.create('person', 'P');
    await expect(t.registry.run('element.changeClass', { id, class: 'item' })).rejects.toThrow(
      /same kind/,
    );
    await expect(
      t.registry.run('element.changeClass', { id, class: 'playerCharacter' }),
    ).rejects.toThrow(/Adopted/);
    await t.registry.run('element.changeClass', { id, class: 'creature' });
    expect(t.element(id).class).toBe('creature');
  });

  it('Note → Location adds the journal layout and moves the doc to the class folder', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('note', 'Tavern');
    await t.registry.run('element.changeClass', { id, class: 'location' });
    const doc = t.doc(id);
    expect(pageNames(doc)).toEqual(['Cover', 'Description', 'Connections']);
    expect(doc.categories.map((c) => c.name)).toEqual(['PlayerNotes']);
    expect(must(t.docs.folders.find((f) => f.id === doc.folder)).key).toBe('location');
    expect(t.element(id).class).toBe('location');
  });

  it('Note → Quest adds the dsaquestlog page', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('note', 'Job');
    await t.registry.run('element.changeClass', { id, class: 'quest' });
    const doc = t.doc(id);
    expect(page(doc, doc.flags.silk.quest).type).toBe('dsaquestlog');
  });

  it('Person → Creature changes the Actor type and keeps the Info Blocks', async () => {
    const t = setup({ mode: 'immediate' });
    const id = await t.create('person', 'Bear');
    await t.registry.run('element.changeClass', { id, class: 'creature' });
    expect(t.doc(id).type).toBe('creature');
    expect(t.element(id).infoBlocks.map((b) => b.name)).toEqual([
      'Appearance',
      'Personality',
      'Secrets',
    ]);
  });
});
