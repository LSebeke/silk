/** Compendium picker (spec 1.1 §B.2). */
import { describe, expect, it } from 'vitest';
import {
  compendiumProvider,
  createCompendiumPicker,
  type CompendiumPicker,
  type PickerCatalog,
} from './compendium-picker';
import type { SourcePick } from './pipeline';

const catalog = (over: Partial<PickerCatalog> = {}): PickerCatalog => ({
  type: 'npc',
  lang: 'de',
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
      { id: 'world', count: 1 },
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
    const picker = createCompendiumPicker(catalog({ type: 'creature' }));
    expect(picker.get().sources).toEqual([
      { id: 'all', count: 3 },
      { id: 'world', count: 1 },
      { id: 'dsa5.npcs-de', label: 'NSC', count: 1 },
      { id: 'world.beasts', label: 'Beasts', count: 1 },
    ]);
    expect(picker.get().rows.map((r) => r.name)).not.toContain('Held');
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
      { uuid: 'Actor.ulf', name: 'Ulf', img: 'ulf.webp', source: 'world' },
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

describe('compendiumProvider (the Source Step ↑ choice)', () => {
  function provider(result: (picker: CompendiumPicker) => SourcePick | undefined) {
    const opened: { picker: CompendiumPicker; signal: AbortSignal }[] = [];
    const types: string[] = [];
    const p = compendiumProvider({
      actorType: (cls) =>
        (({ person: 'npc', creature: 'creature' }) as Record<string, string>)[cls],
      catalog: async (type) => {
        types.push(type);
        return catalog({ type });
      },
      open: async (picker, signal) => {
        opened.push({ picker, signal });
        return result(picker);
      },
    });
    return { p, opened, types };
  }
  const request = (cls: 'person' | 'creature') => ({
    class: cls,
    at: { x: 0, y: 0 },
    signal: new AbortController().signal,
  });

  it('available for classes with an Actor type', () => {
    const { p } = provider(() => undefined);
    expect(p.unavailable('person')).toBeUndefined();
    expect(p.unavailable('location')).toBe('SILK.Source.NotForClass');
  });

  it('opens the picker over the class type and resolves with its pick', async () => {
    const { p, types, opened } = provider((picker) => {
      picker.setSource('world');
      return picker.pick();
    });
    expect(await p.pick(request('person'))).toEqual({ adopt: { uuid: 'Actor.ulf' }, name: 'Ulf' });
    expect(types).toEqual(['npc']);
    expect(opened[0]?.picker.get().source).toBe('world');
  });

  it('closed without a pick: undefined', async () => {
    const { p } = provider(() => undefined);
    expect(await p.pick(request('creature'))).toBeUndefined();
  });
});
