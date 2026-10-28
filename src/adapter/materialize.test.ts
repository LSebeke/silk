import { describe, expect, it } from 'vitest';
import type { Materializer } from '../core/materialize';
import { registerMaterializeHooks } from './materialize';

function setup(activeGM = true) {
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const synced: string[] = [];
  const materializer = {
    elementIdOf: (doc: { flags?: { silk?: { id?: string } } }) => doc.flags?.silk?.id,
    sync: async (id: string) => void synced.push(id),
  } as unknown as Materializer;
  registerMaterializeHooks(materializer, {
    on: (name, fn) => hooks.set(name, fn),
    isActiveGM: () => activeGM,
  });
  const fire = (name: string, ...args: unknown[]) => hooks.get(name)?.(...args);
  return { fire, synced };
}

const actor = { flags: { silk: { id: 'el1' } } };

describe('Foundry edits flow back (spec §7)', () => {
  it('syncs the element of an updated doc, or of an edited page’s journal', () => {
    const { fire, synced } = setup();
    fire('updateActor', actor, { name: 'X' }, {}, 'user');
    fire('updateJournalEntryPage', { parent: actor }, {}, {}, 'user');
    fire('deleteJournalEntryPage', { parent: actor }, {}, 'user');
    fire('createItem', { flags: {} }, {}, 'user');
    expect(synced).toEqual(['el1', 'el1', 'el1']);
  });

  it('ignores Silk’s own writes, non-active GMs and unlinked token actors', () => {
    const { fire, synced } = setup();
    fire('updateActor', actor, {}, { silk: { internal: true } }, 'user');
    fire('updateActor', { ...actor, isToken: true }, {}, {}, 'user');
    expect(synced).toEqual([]);
    const other = setup(false);
    other.fire('updateActor', actor, {}, {}, 'user');
    expect(other.synced).toEqual([]);
  });

  it('syncs an actor whose effects change (Dead), linked actors only (§7)', () => {
    const { fire, synced } = setup();
    fire('createActiveEffect', { parent: actor }, {}, 'user');
    fire('updateActiveEffect', { parent: actor }, {}, {}, 'user');
    fire('deleteActiveEffect', { parent: actor }, {}, 'user');
    fire('createActiveEffect', { parent: { ...actor, isToken: true } }, {}, 'user');
    expect(synced).toEqual(['el1', 'el1', 'el1']);
  });
});
