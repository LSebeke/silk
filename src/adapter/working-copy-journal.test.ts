import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../core/canon';
import { createWorkingCopy } from '../core/working-copy';
import {
  GARN_WRITE,
  ensureWorkingCopyJournal,
  isActiveGM,
  isGarnWrite,
  journalBackend,
  remotePatch,
  type JournalLike,
} from './working-copy-journal';

const gareth: CanonRecord = { kind: 'element', id: 'el-gareth', data: { name: 'Gareth', a: 1 } };
const binding = { canonId: 'c1', checkout: { main: true as const }, head: null };

/** Mimics Foundry's update merge: nested objects merge, `-=key` deletes. */
function fakeEntry(): JournalLike & { updates: [object, object][] } {
  const entry = {
    id: 'j1',
    flags: { garn: { workingCopy: true, records: {} } } as JournalLike['flags'],
    updates: [] as [object, object][],
    async update(data: { flags: { garn: Record<string, unknown> } }, options: object) {
      entry.updates.push([data, options]);
      const garn = entry.flags.garn as Record<string, unknown>;
      for (const [key, value] of Object.entries(data.flags.garn)) {
        if (key !== 'records' && key !== 'meta') garn[key] = value;
        else
          for (const [id, v] of Object.entries(value as object)) {
            const records = (garn[key] ??= {}) as Record<string, unknown>;
            if (id.startsWith('-=')) Reflect.deleteProperty(records, id.slice(2));
            else records[id] = v;
          }
      }
    },
  };
  return entry;
}

describe('Garn Working Copy journal', () => {
  it('round-trips records and binding through journal flags, tagged as Garn writes', async () => {
    const entry = fakeEntry();
    const wc = createWorkingCopy(
      journalBackend(() => entry),
      { canWrite: () => true },
    );
    await wc.setBinding(binding);
    await wc.set([gareth, { kind: 'element', id: 'el-ulf', data: {} }]);
    await wc.set([{ ...gareth, data: { name: 'G' } }]);
    await wc.delete(['el-ulf']);

    const reloaded = createWorkingCopy(
      journalBackend(() => entry),
      { canWrite: () => false },
    );
    expect(reloaded.binding).toEqual(binding);
    expect(reloaded.records()).toEqual(new Map([[gareth.id, { ...gareth, data: { name: 'G' } }]]));
    expect(entry.updates.every(([, options]) => isGarnWrite(options))).toBe(true);
  });

  it('round-trips World-only meta values (merge draft) and their removal', async () => {
    const entry = fakeEntry();
    const wc = createWorkingCopy(
      journalBackend(() => entry),
      { canWrite: () => true },
    );
    await wc.setMeta('mergeDraft', { picks: [{ recordId: 'a', field: '/name', side: 'ours' }] });
    const reload = () =>
      createWorkingCopy(
        journalBackend(() => entry),
        { canWrite: () => false },
      );
    expect(reload().meta('mergeDraft')).toEqual({
      picks: [{ recordId: 'a', field: '/name', side: 'ours' }],
    });
    const [changed] = entry.updates.at(-1) ?? [{}];
    expect(remotePatch(entry, changed, GARN_WRITE, 'gm', 'player')).toEqual({
      meta: { mergeDraft: { picks: [{ recordId: 'a', field: '/name', side: 'ours' }] } },
    });

    await wc.setMeta('mergeDraft', null);
    expect(reload().meta('mergeDraft')).toBeUndefined();
  });

  it('turns another client’s update into a patch and ignores its own Garn writes', async () => {
    const entry = fakeEntry();
    await journalBackend(() => entry).write({ binding, set: [gareth], delete: ['old'] });
    const [changed] = entry.updates[0] ?? [{}];

    expect(remotePatch(entry, changed, GARN_WRITE, 'gm', 'player')).toEqual({
      binding,
      set: [gareth],
      delete: ['old'],
    });
    expect(remotePatch(entry, changed, GARN_WRITE, 'gm', 'gm')).toBeNull();
    // v14 delivers deletions to other clients as a ForcedDeletion operator, not `-=key`.
    const forced = { flags: { garn: { records: { gone: { __$OPERATOR$__: 'ForcedDeletion' } } } } };
    expect(remotePatch(entry, forced, GARN_WRITE, 'gm', 'player')).toEqual({ delete: ['gone'] });
    expect(remotePatch({ ...entry, flags: {} }, changed, {}, 'gm', 'player')).toBeNull();
  });

  it('creates the hidden journal in its folder once', async () => {
    const created: { folders: object[]; entries: object[] } = { folders: [], entries: [] };
    const journals: JournalLike[] = [];
    const deps = {
      find: () => journals[0],
      findFolder: () => (created.folders.length ? { id: 'f1' } : undefined),
      createFolder: async (data: object) => (created.folders.push(data), { id: 'f1' }),
      createEntry: async (data: object) => {
        created.entries.push(data);
        journals.push(fakeEntry());
      },
    };

    await ensureWorkingCopyJournal(deps);
    await ensureWorkingCopyJournal(deps);

    expect(created.folders).toEqual([{ name: 'Garn (internal)', type: 'JournalEntry' }]);
    expect(created.entries).toEqual([
      {
        name: 'Garn Working Copy',
        folder: 'f1',
        ownership: { default: 0 },
        flags: { garn: { workingCopy: true, records: {} } },
      },
    ]);
  });

  it('only the active GM may write', () => {
    expect(isActiveGM({ user: { id: 'a', isGM: true }, users: { activeGM: { id: 'a' } } })).toBe(
      true,
    );
    expect(isActiveGM({ user: { id: 'b', isGM: true }, users: { activeGM: { id: 'a' } } })).toBe(
      false,
    );
    expect(isActiveGM({ user: { id: 'p', isGM: false }, users: { activeGM: null } })).toBe(false);
  });
});
