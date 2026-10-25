import { describe, expect, it } from 'vitest';
import { must } from '../materialize/test-setup';
import { setup } from './test-setup';

describe('adopt.doc: an existing Foundry doc becomes a Materialized Story Element (spec §6)', () => {
  it('adopts an npc as a Person in place: Silk id flag, empty Companion Journal', async () => {
    const t = setup();
    const actor = t.foundryDoc('Actor', { name: 'Alrik', type: 'npc', img: 'alrik.webp' });
    const { id, name } = await t.adoptDoc({ uuid: actor.uuid, at: { x: 10, y: 20 } });
    expect(name).toBe('Alrik');
    expect(t.element(id)).toMatchObject({
      class: 'person',
      name: 'Alrik',
      img: 'alrik.webp',
      uuid: actor.uuid,
      adopted: true,
      position: { x: 10, y: 20 },
      infoBlocks: [],
    });
    const live = t.doc(id);
    expect(live.flags.silk.id).toBe(id);
    expect(live.folder).toBe('userFolder');
    const companion = must(t.docs.journal(must(live.flags.silk.companion)));
    expect(companion.flags.silk.companionOf).toBe(id);
    // No default Info Blocks: only the generated Connections page.
    expect(companion.pages?.map((p) => p._id)).toEqual([companion.flags.silk.connections]);
  });

  it('lands at the viewport centre without a drop point', async () => {
    const t = setup();
    t.setCenter({ x: 777, y: 333 });
    const item = t.foundryDoc('Item', { name: 'Sword', type: 'meleeweapon' });
    const { id } = await t.adoptDoc({ uuid: item.uuid });
    expect(t.element(id)).toMatchObject({ class: 'item', position: { x: 777, y: 333 } });
  });

  it('turns journal pages into Info Blocks as they are (Note by default, no default blocks)', async () => {
    const t = setup();
    const pages = [
      t.textPage('History', '<p>old</p>', { sort: 1 }),
      t.textPage('Rumours', '', { sort: 2 }),
    ];
    const journal = t.foundryDoc('JournalEntry', { name: 'Gareth', pages });
    const { id } = await t.adoptDoc({ uuid: journal.uuid });
    expect(t.element(id).class).toBe('note');
    expect(t.element(id).infoBlocks).toEqual([
      { _id: pages[0]?._id, name: 'History', text: '<p>old</p>' },
      { _id: pages[1]?._id, name: 'Rumours', text: '' },
    ]);
  });

  it('a Location keeps its pages as blocks and gets the Connections page', async () => {
    const t = setup();
    const page = t.textPage('Streets', 'cobbled');
    const journal = t.foundryDoc('JournalEntry', { name: 'Gareth', pages: [page] });
    const { id } = await t.adoptDoc({ uuid: journal.uuid, class: 'location' });
    expect(t.element(id)).toMatchObject({ class: 'location', infoBlocks: [{ name: 'Streets' }] });
    const live = t.doc(id);
    expect(live.pages?.some((p) => p._id === live.flags.silk.connections)).toBe(true);
  });

  it('adopts a quest journal as a Quest linked to its existing quest', async () => {
    const t = setup();
    const quest = {
      _id: t.newId(),
      name: 'The Quest',
      type: 'dsaquestlog',
      sort: 0,
      ownership: { default: -1 },
      system: { quests: { q1: { title: 'Find it', status: 1, audience: 0, visible: false } } },
    };
    const journal = t.foundryDoc('JournalEntry', { name: 'Find it', pages: [quest] });
    const { id } = await t.adoptDoc({ uuid: journal.uuid });
    expect(t.element(id)).toMatchObject({ class: 'quest', status: 'done' });
    expect(t.doc(id).flags.silk).toMatchObject({ quest: quest._id, questKey: 'q1' });
    expect(t.docs.questJournals.map((q) => q.uuid)).toEqual([journal.uuid]);
  });

  it('refuses group and vehicle actors', async () => {
    const t = setup();
    const group = t.foundryDoc('Actor', { name: 'Party', type: 'group' });
    await expect(t.adoptDoc({ uuid: group.uuid })).rejects.toThrow(/Refused/);
    expect(t.elements()).toEqual([]);
  });

  it('refuses a class from another doc kind', async () => {
    const t = setup();
    const item = t.foundryDoc('Item', { name: 'Sword', type: 'meleeweapon' });
    await expect(t.adoptDoc({ uuid: item.uuid, class: 'person' })).rejects.toThrow();
  });

  it('dropping onto a Node connects it with the create-from default type', async () => {
    const t = setup();
    const owner = t.foundryDoc('Actor', { name: 'Alrik', type: 'npc' });
    const { id: alrik } = await t.adoptDoc({ uuid: owner.uuid });
    const item = t.foundryDoc('Item', { name: 'Ring', type: 'equipment' });
    const { id: ring, connectionId } = await t.adoptDoc({ uuid: item.uuid, connectTo: alrik });
    expect(connectionId).toBeDefined();
    expect(t.connections('owns')).toEqual([[alrik, ring]]);
  });

  it('a doc players can already see counts as Revealed; its ownership is unchanged', async () => {
    const t = setup();
    const open = t.textPage('Open', 'x', { ownership: { default: -1 } });
    const secret = t.textPage('Secret', 'y', { ownership: { default: 0 } });
    const journal = t.foundryDoc('JournalEntry', {
      name: 'Town',
      ownership: { default: 0, player1: 2 } as { default: number },
      pages: [open, secret],
    });
    const { id } = await t.adoptDoc({ uuid: journal.uuid, class: 'location' });
    expect(t.revealed).toEqual([{ elements: [id], infoBlocks: [open._id] }]);
    expect(t.doc(id).ownership).toEqual({ default: 0, player1: 2 });

    const hidden = t.foundryDoc('Actor', { name: 'Spy', type: 'npc' });
    await t.adoptDoc({ uuid: hidden.uuid });
    expect(t.revealed).toHaveLength(1);
  });
});

describe('duplicates (spec §6 Duplicates)', () => {
  it('a doc with a Silk id is not adopted again: its Node is selected and flashes', async () => {
    const t = setup();
    const actor = t.foundryDoc('Actor', { name: 'Alrik', type: 'npc' });
    const { id } = await t.adoptDoc({ uuid: actor.uuid });
    const again = await t.adoptDoc({ uuid: actor.uuid });
    expect(again).toMatchObject({ id, existing: true });
    expect(t.selected.at(-1)).toEqual([id]);
    expect(t.flashed).toEqual([id]);
    expect(t.elements()).toHaveLength(1);
  });

  it('a Silk-created doc counts as a Story Element too', async () => {
    const t = setup();
    const id = await t.create('person', 'Made by Silk');
    const result = await t.adoptDoc({ uuid: t.doc(id).uuid });
    expect(result).toMatchObject({ id, existing: true });
  });

  it('a duplicated doc has its copied Silk id stripped (on create, and on Adopt)', async () => {
    const t = setup();
    const id = await t.create('location', 'Gareth');
    const original = t.doc(id);
    const copy = t.foundryDoc('JournalEntry', {
      name: 'Gareth (copy)',
      pages: structuredClone(original.pages),
      flags: structuredClone(original.flags),
    });
    await t.adopt.docCreated(copy);
    expect(t.docs.get(copy.uuid)?.flags.silk).toEqual({});
    expect(t.doc(id).flags.silk.id).toBe(id);

    const other = t.foundryDoc('JournalEntry', {
      name: 'Late copy',
      flags: structuredClone(original.flags),
    });
    const { id: adopted } = await t.adoptDoc({ uuid: other.uuid });
    expect(adopted).not.toBe(id);
    expect(t.docs.get(other.uuid)?.flags.silk.id).toBe(adopted);
  });

  it('compendium entries are imported and the copy adopted', async () => {
    const t = setup();
    t.compendium.set('Compendium.dsa5.npcs.Actor.abc', {
      _id: 'abc',
      uuid: 'Compendium.dsa5.npcs.Actor.abc',
      documentName: 'Actor',
      name: 'Bandit',
      type: 'npc',
      folder: null,
      flags: { silk: {} },
    });
    const { id } = await t.adoptDoc({ uuid: 'Compendium.dsa5.npcs.Actor.abc' });
    expect(t.element(id)).toMatchObject({ class: 'person', name: 'Bandit' });
    expect(t.element(id).uuid).toMatch(/^Actor\./);
  });

  it('compendiumSource matching a Ghost: "use this doc for X" Materializes that Ghost', async () => {
    const t = setup();
    // A Canon element whose doc came from the compendium, Unmaterialized in this World.
    t.compendium.set('Compendium.dsa5.npcs.Actor.abc', {
      _id: 'abc',
      uuid: 'Compendium.dsa5.npcs.Actor.abc',
      documentName: 'Actor',
      name: 'Bandit',
      type: 'npc',
      folder: null,
      flags: { silk: {} },
    });
    const first = await t.adoptDoc({ uuid: 'Compendium.dsa5.npcs.Actor.abc' });
    await t.run('infoBlock.create', { elementId: first?.id, name: 'Notes', text: 'mean' });
    await t.run('materialize.unmaterialize', { ids: [first?.id] });
    expect(t.element(first.id).uuid).toBeUndefined();

    const second = await t.adoptDoc({ uuid: 'Compendium.dsa5.npcs.Actor.abc' });
    expect(t.useForPrompts).toEqual([{ doc: 'Bandit', element: 'Bandit' }]);
    expect(second?.id).toBe(first.id);
    expect(t.element(first.id).uuid).toMatch(/^Actor\./);
    expect(t.element(first.id).infoBlocks?.map((b) => b.name)).toEqual(['Notes']);

    t.answers.useFor = 'new';
    await t.run('materialize.unmaterialize', { ids: [first.id] });
    const third = await t.adoptDoc({ uuid: 'Compendium.dsa5.npcs.Actor.abc' });
    expect(third?.id).not.toBe(first.id);
  });
});

describe('inferred Connections (spec §6 Connections)', () => {
  it('inventory item: "also adopt actor" adopts both and adds owns', async () => {
    const t = setup();
    const actor = t.foundryDoc('Actor', { name: 'Alrik', type: 'npc' });
    const sword = t.foundryDoc('Item', { name: 'Sword', type: 'meleeweapon' }, actor.uuid);
    const result = await t.adoptDoc({ uuid: sword.uuid, alsoAdoptActor: true });
    const actorId = result?.actorId as string;
    expect(t.element(actorId)).toMatchObject({ class: 'person', uuid: actor.uuid });
    expect(t.element(result.id)).toMatchObject({ class: 'item', uuid: sword.uuid });
    expect(t.connections('owns')).toEqual([[actorId, result.id]]);
  });

  it('an actor adopted later gets owns for its Story Element items', async () => {
    const t = setup();
    const actor = t.foundryDoc('Actor', { name: 'Alrik', type: 'npc' });
    const sword = t.foundryDoc('Item', { name: 'Sword', type: 'meleeweapon' }, actor.uuid);
    t.foundryDoc('Item', { name: 'Not adopted', type: 'equipment' }, actor.uuid);
    const { id: item } = await t.adoptDoc({ uuid: sword.uuid });
    expect(t.connections('owns')).toEqual([]);
    const { id: owner } = await t.adoptDoc({ uuid: actor.uuid });
    expect(t.connections('owns')).toEqual([[owner, item]]);
    expect(t.element(item).uuid).toBe(sword.uuid);
  });

  it('reconcile adds owns for an actor adopted while the item was', async () => {
    const t = setup();
    const actor = t.foundryDoc('Actor', { name: 'Alrik', type: 'npc' });
    const sword = t.foundryDoc('Item', { name: 'Sword', type: 'meleeweapon' }, actor.uuid);
    const { id: owner } = await t.adoptDoc({ uuid: actor.uuid });
    const { id: item } = await t.adoptDoc({ uuid: sword.uuid });
    await t.workingCopy.delete(t.connectionIds('owns'));
    await t.adopt.contributor.reconcile?.();
    expect(t.connections('owns')).toEqual([[owner, item]]);
  });

  it('present at from tokens on Event Scenes', async () => {
    const t = setup();
    const event = await t.create('event', 'Ambush');
    const actor = t.foundryDoc('Actor', { name: 'Bandit', type: 'npc' });
    const scene = [...t.scenes.all.values()][0];
    if (!scene) throw new Error('no Event Scene');
    scene.tokens.push({ _id: 'tok', actorId: actor._id, x: 0, y: 0, hidden: true });
    const { id } = await t.adoptDoc({ uuid: actor.uuid });
    expect(t.connections('presentAt')).toEqual([[id, event]]);
  });

  it('a Scene becomes a new Event owning it (config untouched), present at from its tokens', async () => {
    const t = setup();
    const actor = t.foundryDoc('Actor', { name: 'Bandit', type: 'npc' });
    const { id: bandit } = await t.adoptDoc({ uuid: actor.uuid });
    const scene = t.foundryScene('Bridge fight', [actor._id]);
    const { id } = await t.adoptDoc({ uuid: `Scene.${scene._id}`, class: 'event' });
    expect(t.element(id)).toMatchObject({ class: 'event', name: 'Bridge fight', adopted: true });
    expect(t.element(id).uuid).toMatch(/^JournalEntry\./);
    expect(t.scenes.all.size).toBe(1);
    const live = t.scenes.all.get(scene._id);
    expect(live?.flags.silk?.sceneOf).toBe(id);
    expect(live?.['grid']).toEqual({ type: 1, size: 77 });
    expect(live?.tokens.map((tk) => tk.actorId)).toEqual([actor._id]);
    expect(t.doc(id).flags.silk.scene).toBe(scene._id);
    expect(t.connections('presentAt')).toEqual([[bandit, id]]);
  });

  it('a Scene can become a Location with it as Overview Scene', async () => {
    const t = setup();
    const scene = t.foundryScene('Gareth map');
    const { id } = await t.adoptDoc({ uuid: `Scene.${scene._id}`, class: 'location' });
    expect(t.element(id).class).toBe('location');
    expect(t.doc(id).flags.silk.scene).toBe(scene._id);
    expect(t.scenes.all.size).toBe(1);
  });
});

describe('adopt.folder: bulk Adopt (spec §6 Ways in, Placement)', () => {
  it('confirms once, adopts the tree as nested Visual Groups and selects the new Nodes', async () => {
    const t = setup();
    const a = t.foundryDoc('Actor', { name: 'Orc chief', type: 'npc' });
    const b = t.foundryDoc('JournalEntry', { name: 'Orc lore' });
    const c = t.foundryDoc('Actor', { name: 'Warband', type: 'group' });
    const d = t.foundryDoc('Item', { name: 'Orc axe', type: 'meleeweapon' });
    t.folders.set('f1', {
      id: 'f1',
      name: 'Orcs',
      docs: [a.uuid, b.uuid, c.uuid],
      children: [
        { id: 'f2', name: 'Loot', docs: [d.uuid], children: [] },
        { id: 'f3', name: 'Empty', docs: [], children: [] },
      ],
    });
    const { ids } = await t.run<{ ids: string[] }>('adopt.folder', { folderId: 'f1' });
    expect(t.folderPrompts).toEqual([
      [
        { name: 'Orc chief', class: 'person' },
        { name: 'Orc lore', class: 'note' },
        { name: 'Orc axe', class: 'item' },
      ],
    ]);
    expect(ids.map((id) => t.element(id).name)).toEqual(['Orc chief', 'Orc lore', 'Orc axe']);
    expect(t.selected.at(-1)).toEqual(ids);
    const groups = t.groups();
    expect(groups.map((g) => g.label).sort()).toEqual(['Loot', 'Orcs']);
    const orcs = groups.find((g) => g.label === 'Orcs');
    const loot = groups.find((g) => g.label === 'Loot');
    expect(loot?.parent).toBe(orcs?.id);
    const [chief, lore, axe] = ids.map((id) => t.element(id));
    expect(chief?.group).toBe(orcs?.id);
    expect(lore?.group).toBe(orcs?.id);
    expect(axe?.group).toBe(loot?.id);
  });

  it('adopts nothing when the GM cancels', async () => {
    const t = setup();
    const a = t.foundryDoc('Actor', { name: 'Orc chief', type: 'npc' });
    t.folders.set('f1', { id: 'f1', name: 'Orcs', docs: [a.uuid], children: [] });
    t.answers.folder = false;
    expect(await t.run('adopt.folder', { folderId: 'f1' })).toEqual({ ids: [] });
    expect(t.elements()).toEqual([]);
  });
});

describe('ad-hoc docs and End Play Session (spec §6, §11.3)', () => {
  it('commits, then lists docs created since the last Commit that are no Story Elements', async () => {
    const t = setup();
    const created = (time: number) => ({ _stats: { createdTime: time } }) as object;
    t.foundryDoc('Actor', { name: 'Old', type: 'npc', ...created(50) });
    const fresh = t.foundryDoc('Actor', { name: 'Fresh NPC', type: 'npc', ...created(150) });
    const freshJournal = t.foundryDoc('JournalEntry', { name: 'Handout', ...created(160) });
    const adopted = t.foundryDoc('Item', { name: 'Adopted', type: 'equipment', ...created(170) });
    await t.adoptDoc({ uuid: adopted.uuid });
    const scene = t.foundryScene('Tavern');
    scene['_stats'] = { createdTime: 180 };
    await t.create('note', 'Silk note');
    t.setLastCommitTime(100);

    const result = await t.run<{ commit: string; adHoc: { uuid: string }[] }>(
      'history.endPlaySession',
      {},
    );
    expect(t.commits).toHaveLength(1);
    expect(result.commit).toBe('commit1');
    expect(result.adHoc.map((d) => d.uuid)).toEqual([
      fresh.uuid,
      freshJournal.uuid,
      `Scene.${scene._id}`,
    ]);
    expect(t.shownAdHoc).toEqual([result.adHoc]);
  });

  it('an ignored doc never reappears', async () => {
    const t = setup();
    const doc = t.foundryDoc('Actor', { name: 'Extra', type: 'npc' });
    const scene = t.foundryScene('Extra map');
    await t.run('adopt.ignore', { uuid: doc.uuid });
    await t.run('adopt.ignore', { uuid: `Scene.${scene._id}` });
    expect(await t.adopt.adHoc()).toEqual([]);
  });
});
