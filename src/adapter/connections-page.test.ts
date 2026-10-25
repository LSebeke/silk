import { describe, expect, it } from 'vitest';
import { registerConnectionsPageHooks } from './connections-page';

function setup(activeGM = true) {
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const refreshed: string[][] = [];
  registerConnectionsPageHooks(
    { refresh: async (ids) => void refreshed.push([...(ids ?? [])]) },
    { on: (name, fn) => hooks.set(name, fn), isActiveGM: () => activeGM },
  );
  const fire = (name: string, ...args: unknown[]) => hooks.get(name)?.(...args);
  return { fire, refreshed };
}

const journal = { flags: { silk: { id: 'el1', connections: 'pg1' } } };
const companion = { flags: { silk: { companionOf: 'el2', connections: 'pg2' } } };

describe('Connections page stays generated (spec §5 In journals)', () => {
  it('a hand edit of a Connections page is regenerated', () => {
    const { fire, refreshed } = setup();
    fire('updateJournalEntryPage', { id: 'pg1', parent: journal }, {}, {}, 'user');
    fire('updateJournalEntryPage', { id: 'pg2', parent: companion }, {}, {}, 'user');
    expect(refreshed).toEqual([['el1'], ['el2']]);
  });

  it('ignores other pages, Silk’s own writes and non-active GMs', () => {
    const { fire, refreshed } = setup();
    fire('updateJournalEntryPage', { id: 'other', parent: journal }, {}, {}, 'user');
    fire(
      'updateJournalEntryPage',
      { id: 'pg1', parent: journal },
      {},
      { silk: { internal: true } },
    );
    expect(refreshed).toEqual([]);
    const other = setup(false);
    other.fire('updateJournalEntryPage', { id: 'pg1', parent: journal }, {}, {}, 'user');
    expect(other.refreshed).toEqual([]);
  });
});
