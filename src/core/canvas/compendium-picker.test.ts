/** Compendium picker (spec 1.1 §B.2). */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import {
  compendiumSource,
  createCompendiumPicker,
  pickerCommands,
  type CompendiumPicker,
  type PickerCatalog,
} from './compendium-picker';

const catalog = (over: Partial<PickerCatalog> = {}): PickerCatalog => ({
  kind: { documentName: 'Actor', type: 'npc' },
  lang: 'de',
  worldLabel: 'World',
  world: [
    { uuid: 'Actor.ulf', name: 'Ulf', type: 'npc', img: 'ulf.webp' },
    { uuid: 'Actor.wolf', name: 'Wolf', type: 'creature' },
    { uuid: 'Actor.held', name: 'Held', type: 'character' },
  ],
  packs: [
    {
      id: 'dsa5.npcs-de',
      label: 'NSC',
      lang: 'de',
      entries: [
        { uuid: 'Compendium.dsa5.npcs-de.Actor.a', name: 'Alrik', type: 'npc' },
        { uuid: 'Compendium.dsa5.npcs-de.Actor.b', name: 'Bär', type: 'creature' },
        { uuid: 'Compendium.dsa5.npcs-de.Actor.c', name: 'Ulfhild', type: 'npc' },
      ],
    },
    {
      id: 'dsa5.npcs-en',
      label: 'NPCs',
      lang: 'en',
      entries: [{ uuid: 'Compendium.dsa5.npcs-en.Actor.a', name: 'Alrik', type: 'npc' }],
    },
    {
      id: 'world.homebrew',
      label: 'Homebrew',
      entries: [{ uuid: 'Compendium.world.homebrew.Actor.h', name: 'Hesinde', type: 'npc' }],
    },
    {
      id: 'world.beasts',
      label: 'Beasts',
      entries: [{ uuid: 'Compendium.world.beasts.Actor.w', name: 'Warg', type: 'creature' }],
    },
  ],
  ...over,
});

describe('side list', () => {
  it('All (default), World, then each pack with its entry count of the class type', () => {
    const picker = createCompendiumPicker(catalog());
    expect(picker.get().sources).toEqual([
      { id: 'all', count: 4 },
      { id: 'world', label: 'World', count: 1 },
      { id: 'dsa5.npcs-de', label: 'NSC', count: 2 },
      { id: 'world.homebrew', label: 'Homebrew', count: 1 },
    ]);
    expect(picker.get().source).toBe('all');
  });

  it('hides packs whose dsalang differs from the client language; shows packs without', () => {
    const picker = createCompendiumPicker(catalog({ lang: 'en' }));
    expect(picker.get().sources.map((s) => s.id)).toEqual([
      'all',
      'world',
      'dsa5.npcs-en',
      'world.homebrew',
    ]);
  });

  it('Creature lists creature entries; Player Characters never appear', () => {
    const picker = createCompendiumPicker(
      catalog({ kind: { documentName: 'Actor', type: 'creature' } }),
    );
    expect(picker.get().sources).toEqual([
      { id: 'all', count: 3 },
      { id: 'world', label: 'World', count: 1 },
      { id: 'dsa5.npcs-de', label: 'NSC', count: 1 },
      { id: 'world.beasts', label: 'Beasts', count: 1 },
    ]);
    expect(picker.get().rows.map((r) => r.name)).not.toContain('Held');
  });

  it('a kind without a type lists every entry of its sources (Scenes)', () => {
    const picker = createCompendiumPicker({
      kind: { documentName: 'Scene' },
      lang: 'de',
      worldLabel: 'World',
      world: [{ uuid: 'Scene.gareth', name: 'Gareth' }],
      packs: [
        {
          id: 'dsa5-core.coremaps',
          label: 'Karten',
          lang: 'de',
          entries: [
            { uuid: 'Compendium.dsa5-core.coremaps.Scene.a', name: 'Aventurien' },
            { uuid: 'Compendium.dsa5-core.coremaps.Scene.b', name: 'Bosparan' },
          ],
        },
      ],
    });
    expect(picker.get().sources).toEqual([
      { id: 'all', count: 3 },
      { id: 'world', label: 'World', count: 1 },
      { id: 'dsa5-core.coremaps', label: 'Karten', count: 2 },
    ]);
  });
});

describe('results', () => {
  it('rows carry image, name and source label; All lists every source', () => {
    const picker = createCompendiumPicker(catalog());
    expect(picker.get().rows).toEqual([
      {
        uuid: 'Compendium.dsa5.npcs-de.Actor.a',
        name: 'Alrik',
        source: 'dsa5.npcs-de',
        label: 'NSC',
      },
      {
        uuid: 'Compendium.world.homebrew.Actor.h',
        name: 'Hesinde',
        source: 'world.homebrew',
        label: 'Homebrew',
      },
      { uuid: 'Actor.ulf', name: 'Ulf', img: 'ulf.webp', source: 'world', label: 'World' },
      {
        uuid: 'Compendium.dsa5.npcs-de.Actor.c',
        name: 'Ulfhild',
        source: 'dsa5.npcs-de',
        label: 'NSC',
      },
    ]);
  });

  it('a source filters; search matches the name within it, case-insensitive', () => {
    const picker = createCompendiumPicker(catalog());
    picker.setQuery('ulf');
    expect(picker.get().rows.map((r) => r.name)).toEqual(['Ulf', 'Ulfhild']);
    picker.setSource('dsa5.npcs-de');
    expect(picker.get().rows.map((r) => r.name)).toEqual(['Ulfhild']);
    picker.setSource('world');
    expect(picker.get().rows.map((r) => r.name)).toEqual(['Ulf']);
  });
});

describe('keys and pick', () => {
  it('↑/↓ move within the results (clamped); a new query or source resets to the first', () => {
    const picker = createCompendiumPicker(catalog());
    expect(picker.get().active).toBe(0);
    picker.move(1);
    picker.move(1);
    expect(picker.get().active).toBe(2);
    picker.move(5);
    expect(picker.get().active).toBe(3);
    picker.move(-9);
    expect(picker.get().active).toBe(0);
    picker.move(2);
    picker.setQuery('a');
    expect(picker.get().active).toBe(0);
  });

  it('Enter picks the active row: a pack entry is a compendium source, a World actor is Adopted', () => {
    const picker = createCompendiumPicker(catalog());
    expect(picker.pick()).toEqual({
      source: { kind: 'compendium', uuid: 'Compendium.dsa5.npcs-de.Actor.a' },
      name: 'Alrik',
    });
    picker.setSource('world');
    expect(picker.pick()).toEqual({ adopt: { uuid: 'Actor.ulf' }, name: 'Ulf' });
  });

  it('no results: nothing to pick', () => {
    const picker = createCompendiumPicker(catalog());
    picker.setQuery('zzz');
    expect(picker.pick()).toBeUndefined();
  });
});

describe('compendiumSource (the Source Step ↑ choice), driven by picker commands', () => {
  function setup() {
    const opened: CompendiumPicker[] = [];
    let closed = 0;
    const types: string[] = [];
    const source = compendiumSource({
      kind: (cls) => {
        const type = ({ person: 'npc', creature: 'creature' } as Record<string, string>)[cls];
        return type ? { documentName: 'Actor', type } : undefined;
      },
      catalog: async (kind) => {
        types.push(kind.type ?? '');
        return catalog({ kind });
      },
      open: async (picker) => {
        opened.push(picker);
        return () => void closed++;
      },
    });
    const registry = createRegistry(() => ({ isGM: true }));
    for (const c of pickerCommands(source)) registry.register(c);
    return { source, registry, opened, types, closed: () => closed };
  }
  const request = (cls: 'person' | 'creature', signal = new AbortController().signal) => ({
    class: cls,
    at: { x: 0, y: 0 },
    signal,
  });

  it('available for classes with an Actor type', () => {
    const { source } = setup();
    expect(source.unavailable('person')).toBeUndefined();
    expect(source.unavailable('location')).toBe('SILK.Source.NotForClass');
  });

  it('picker.search / picker.source / picker.pick drive the open picker; the pick closes it', async () => {
    const { source, registry, opened, types, closed } = setup();
    const picked = source.pick(request('person'));
    // Commands wait for the window to open.
    await registry.run('picker.search', { query: 'ulf' });
    await registry.run('picker.source', { id: 'dsa5.npcs-de' });
    expect(opened[0]?.get()).toMatchObject({ source: 'dsa5.npcs-de', query: 'ulf' });
    expect(await registry.run('picker.pick', {})).toEqual({ picked: true });
    expect(await picked).toEqual({
      source: { kind: 'compendium', uuid: 'Compendium.dsa5.npcs-de.Actor.c' },
      name: 'Ulfhild',
    });
    expect(types).toEqual(['npc']);
    expect(closed()).toBe(1);
    await expect(registry.run('picker.pick', {})).rejects.toThrow(/not open/);
  });

  it('picker.pick { uuid } picks that row; a pack entry carries its image', async () => {
    const { source, registry } = setup();
    const picked = source.pick(request('person'));
    await registry.run('picker.source', { id: 'world.homebrew' });
    expect(await registry.run('picker.pick', { uuid: 'Actor.nope' })).toEqual({ picked: false });
    await registry.run('picker.source', { id: 'all' });
    await registry.run('picker.pick', { uuid: 'Actor.ulf' });
    expect(await picked).toEqual({ adopt: { uuid: 'Actor.ulf' }, name: 'Ulf' });
  });

  it('picker.cancel closes without a pick (back to the Source Step)', async () => {
    const { source, registry, closed } = setup();
    const picked = source.pick(request('creature'));
    await registry.run('picker.cancel', {});
    expect(await picked).toBeUndefined();
    expect(closed()).toBe(1);
  });

  it('an aborted creation closes the picker', async () => {
    const { source, registry, closed } = setup();
    const abort = new AbortController();
    const picked = source.pick(request('person', abort.signal));
    await registry.run('picker.search', { query: 'a' });
    abort.abort();
    expect(await picked).toBeUndefined();
    expect(closed()).toBe(1);
  });
});

describe('pick image', () => {
  it('a pack entry pick carries the entry image (the Ghost card shows it)', () => {
    const picker = createCompendiumPicker(
      catalog({
        world: [],
        packs: [
          {
            id: 'p',
            label: 'P',
            entries: [{ uuid: 'Compendium.p.Actor.x', name: 'X', type: 'npc', img: 'x.webp' }],
          },
        ],
      }),
    );
    expect(picker.pick()).toEqual({
      source: { kind: 'compendium', uuid: 'Compendium.p.Actor.x' },
      name: 'X',
      img: 'x.webp',
    });
  });
});

describe('merged rows (spec 1.1 §B.2, #87)', () => {
  const twins = (): PickerCatalog =>
    catalog({
      world: [{ uuid: 'Actor.alrik', name: 'alrik ', type: 'npc', img: 'w.webp' }],
      packs: [
        {
          id: 'z.pack',
          label: 'Zeta',
          entries: [{ uuid: 'Compendium.z.Actor.a', name: 'ALRIK', type: 'npc' }],
        },
        {
          id: 'a.pack',
          label: 'Alpha',
          entries: [
            { uuid: 'Compendium.a.Actor.a', name: 'Alrik', type: 'npc', img: 'a.webp' },
            { uuid: 'Compendium.a.Actor.b', name: 'Bosper', type: 'npc' },
          ],
        },
      ],
    });

  it('All merges same-name entries (case-insensitive, trimmed) incl. World actors into one row', () => {
    const picker = createCompendiumPicker(twins());
    const [alrik, bosper] = picker.get().rows;
    expect(picker.get().rows).toHaveLength(2);
    expect(alrik).toMatchObject({ uuid: 'Actor.alrik', name: 'alrik ', count: 3 });
    expect(bosper?.count).toBeUndefined();
    expect(picker.get().sources[0]).toEqual({ id: 'all', count: 4 });
  });

  it('a single pack or World shows its entries unmerged', () => {
    const picker = createCompendiumPicker(
      catalog({
        world: [
          { uuid: 'Actor.a1', name: 'Alrik', type: 'npc' },
          { uuid: 'Actor.a2', name: 'alrik', type: 'npc' },
        ],
        packs: [],
      }),
    );
    expect(picker.get().rows).toHaveLength(1);
    picker.setSource('world');
    const rows = picker.get().rows;
    expect(rows.map((r) => r.uuid).sort()).toEqual(['Actor.a1', 'Actor.a2']);
    expect(rows.map((r) => r.count)).toEqual([undefined, undefined]);
  });

  it('picking a merged row lists its sources: World first, then packs by label', () => {
    const picker = createCompendiumPicker(twins());
    expect(picker.pick()).toEqual({
      choose: ['Actor.alrik', 'Compendium.a.Actor.a', 'Compendium.z.Actor.a'],
    });
    const state = picker.get();
    expect(state.choosing).toBe('alrik ');
    expect(state.rows.map((r) => [r.uuid, r.label])).toEqual([
      ['Actor.alrik', 'World'],
      ['Compendium.a.Actor.a', 'Alpha'],
      ['Compendium.z.Actor.a', 'Zeta'],
    ]);
    expect(state.active).toBe(0);
    picker.move(1);
    expect(picker.pick()).toEqual({
      source: { kind: 'compendium', uuid: 'Compendium.a.Actor.a' },
      name: 'Alrik',
      img: 'a.webp',
    });
  });

  it('back (Esc) returns from the source list to the results at the merged row', () => {
    const picker = createCompendiumPicker(twins());
    picker.pick();
    picker.move(2);
    expect(picker.back()).toBe(true);
    expect(picker.get().choosing).toBeUndefined();
    expect(picker.get().active).toBe(0);
    expect(picker.get().rows).toHaveLength(2);
    expect(picker.back()).toBe(false);
  });

  it('a new query or source leaves the source list', () => {
    const picker = createCompendiumPicker(twins());
    picker.pick();
    picker.setQuery('bos');
    expect(picker.get().choosing).toBeUndefined();
    expect(picker.get().rows.map((r) => r.name)).toEqual(['Bosper']);
  });

  it('picker.pick on a merged row returns { choose }; a second picker.pick { uuid } picks one', async () => {
    const source = compendiumSource({
      kind: () => ({ documentName: 'Actor', type: 'npc' }),
      catalog: async () => twins(),
      open: async () => () => undefined,
    });
    const registry = createRegistry(() => ({ isGM: true }));
    for (const c of pickerCommands(source)) registry.register(c);
    const signal = new AbortController().signal;
    const picked = source.pick({ class: 'person', at: { x: 0, y: 0 }, signal });
    expect(await registry.run('picker.pick', { uuid: 'Actor.alrik' })).toEqual({
      choose: ['Actor.alrik', 'Compendium.a.Actor.a', 'Compendium.z.Actor.a'],
    });
    expect(await registry.run('picker.pick', { uuid: 'Compendium.z.Actor.a' })).toEqual({
      picked: true,
    });
    expect(await picked).toEqual({
      source: { kind: 'compendium', uuid: 'Compendium.z.Actor.a' },
      name: 'ALRIK',
    });
  });
});
