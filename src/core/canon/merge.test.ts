import { describe, expect, it } from 'vitest';
import { mergeSnapshots, resolveMerge } from './merge';
import type { CanonRecord, JsonObject, RecordKind, Snapshot } from './store';

function rec(kind: RecordKind, id: string, data: JsonObject): CanonRecord {
  return { kind, id, data };
}
const el = (id: string, data: JsonObject) => rec('element', id, data);
function snap(...records: CanonRecord[]): Snapshot {
  return new Map(records.map((r) => [r.id, r]));
}
function dataOf(s: Snapshot, id: string) {
  return s.get(id)?.data;
}

describe('3-way merge', () => {
  it('auto-merges one-sided changes from both sides into one record', () => {
    const base = snap(el('a', { name: 'Gareth', status: 'alive' }));
    const ours = snap(el('a', { name: 'Gareth the Bold', status: 'alive' }));
    const theirs = snap(el('a', { name: 'Gareth', status: 'dead' }));

    const merge = mergeSnapshots(base, ours, theirs);
    const { snapshot, unresolved } = resolveMerge(merge, []);

    expect(unresolved).toEqual([]);
    expect(dataOf(snapshot, 'a')).toEqual({ name: 'Gareth the Bold', status: 'dead' });
    expect(merge.records.get('a')?.fields).toEqual([
      {
        field: '/name',
        base: 'Gareth',
        ours: 'Gareth the Bold',
        theirs: 'Gareth',
        change: 'ours',
        auto: 'ours',
      },
      {
        field: '/status',
        base: 'alive',
        ours: 'alive',
        theirs: 'dead',
        change: 'theirs',
        auto: 'theirs',
      },
    ]);
  });

  it('reports both sides changing a field differently as a conflict until picked', () => {
    const base = snap(el('a', { name: 'Gareth', blocks: { secrets: 'none' } }));
    const ours = snap(el('a', { name: 'Garet', blocks: { secrets: 'spy' } }));
    const theirs = snap(el('a', { name: 'Gerold', blocks: { secrets: 'traitor' } }));

    const merge = mergeSnapshots(base, ours, theirs);
    expect(merge.records.get('a')?.fields).toEqual([
      {
        field: '/blocks/secrets',
        base: 'none',
        ours: 'spy',
        theirs: 'traitor',
        change: 'conflict',
        auto: null,
      },
      {
        field: '/name',
        base: 'Gareth',
        ours: 'Garet',
        theirs: 'Gerold',
        change: 'conflict',
        auto: null,
      },
    ]);
    expect(resolveMerge(merge, []).unresolved).toEqual([
      { recordId: 'a', field: '/blocks/secrets' },
      { recordId: 'a', field: '/name' },
    ]);

    const { snapshot, unresolved } = resolveMerge(merge, [
      { recordId: 'a', field: '/name', side: 'theirs' },
      { recordId: 'a', field: '/blocks/secrets', value: 'spy and traitor' },
    ]);
    expect(unresolved).toEqual([]);
    expect(dataOf(snapshot, 'a')).toEqual({
      name: 'Gerold',
      blocks: { secrets: 'spy and traitor' },
    });
  });

  it('lets a pick override an auto-merged field', () => {
    const base = snap(el('a', { name: 'Gareth' }));
    const theirs = snap(el('a', { name: 'Gerold' }));
    const merge = mergeSnapshots(base, base, theirs);
    const { snapshot } = resolveMerge(merge, [{ recordId: 'a', field: '/name', side: 'base' }]);
    expect(dataOf(snapshot, 'a')).toEqual({ name: 'Gareth' });
  });

  it('matches embedded Items by id: one row per item, edits to different items both apply', () => {
    const sword = { _id: 's1', name: 'Sword', system: { quantity: 1 } };
    const rope = { _id: 'r1', name: 'Rope', system: { quantity: 1 } };
    const sheet = (items: JsonObject[]) => snap(rec('sheet', 'sh', { name: 'Gareth', items }));
    const base = sheet([sword, rope]);
    // Ours reorders and edits the rope; theirs edits the sword, drops nothing, adds a torch.
    const ours = sheet([{ ...rope, system: { quantity: 3 } }, sword]);
    const torch = { _id: 't1', name: 'Torch', system: { quantity: 2 } };
    const theirs = sheet([{ ...sword, name: 'Old Sword' }, rope, torch]);

    const merge = mergeSnapshots(base, ours, theirs);
    expect(merge.records.get('sh')?.fields.map((f) => [f.field, f.change])).toEqual([
      ['/items/r1/system/quantity', 'ours'],
      ['/items/s1/name', 'theirs'],
      ['/items/t1', 'theirs'],
    ]);
    expect(dataOf(resolveMerge(merge, []).snapshot, 'sh')).toEqual({
      name: 'Gareth',
      items: [{ ...rope, system: { quantity: 3 } }, { ...sword, name: 'Old Sword' }, torch],
    });
  });

  it('reports an embedded Item deleted on one side and edited on the other as one conflict row', () => {
    const sword = { _id: 's1', name: 'Sword' };
    const sheet = (items: JsonObject[]) => snap(rec('sheet', 'sh', { items }));
    const merge = mergeSnapshots(
      sheet([sword]),
      sheet([]),
      sheet([{ ...sword, name: 'Old Sword' }]),
    );
    expect(merge.records.get('sh')?.fields).toEqual([
      {
        field: '/items/s1',
        base: sword,
        ours: undefined,
        theirs: { ...sword, name: 'Old Sword' },
        change: 'conflict',
        auto: null,
      },
    ]);
    const kept = resolveMerge(merge, [{ recordId: 'sh', field: '/items/s1', side: 'theirs' }]);
    expect(dataOf(kept.snapshot, 'sh')).toEqual({ items: [{ ...sword, name: 'Old Sword' }] });
  });

  describe('delete vs edit', () => {
    const gareth = el('a', { name: 'Gareth' });
    const edited = el('a', { name: 'Gareth the Bold' });
    const knows = rec('connection', 'c', { from: 'a', to: 'b', label: 'knows' });
    const ulf = el('b', { name: 'Ulf' });

    it('auto-applies a delete when the other side left the record alone', () => {
      const merge = mergeSnapshots(snap(gareth), snap(gareth), snap());
      expect(merge.records.get('a')?.fields).toEqual([
        {
          field: '',
          base: gareth.data,
          ours: gareth.data,
          theirs: undefined,
          change: 'theirs',
          auto: 'theirs',
        },
      ]);
      expect(resolveMerge(merge, []).snapshot.has('a')).toBe(false);
    });

    it('is one record-level conflict: delete, or keep with the edits', () => {
      const merge = mergeSnapshots(snap(gareth), snap(), snap(edited));
      expect(merge.records.get('a')?.fields).toEqual([
        {
          field: '',
          base: gareth.data,
          ours: undefined,
          theirs: edited.data,
          change: 'conflict',
          auto: null,
        },
      ]);
      expect(resolveMerge(merge, []).unresolved).toEqual([{ recordId: 'a', field: '' }]);
      const kept = resolveMerge(merge, [{ recordId: 'a', field: '', side: 'theirs' }]);
      expect(kept.snapshot.get('a')).toEqual(edited);
      const deleted = resolveMerge(merge, [{ recordId: 'a', field: '', side: 'ours' }]);
      expect(deleted.snapshot.has('a')).toBe(false);
      expect(deleted.unresolved).toEqual([]);
    });

    it('removes Connections whose endpoint ends up deleted, even ones edited or added', () => {
      const added = rec('connection', 'c2', { from: 'b', to: 'a', label: 'fears' });
      const base = snap(gareth, ulf, knows);
      const ours = snap(gareth, ulf, { ...knows, data: { ...knows.data, label: 'trusts' } }, added);
      const theirs = snap(ulf, knows);
      const { snapshot, unresolved, removedWithEndpoint } = resolveMerge(
        mergeSnapshots(base, ours, theirs),
        [],
      );
      expect([...snapshot.keys()]).toEqual(['b']);
      expect(unresolved).toEqual([]);
      expect(removedWithEndpoint).toEqual(['c', 'c2']);
    });

    it('drops a Connection delete-vs-edit conflict when its endpoint is deleted anyway', () => {
      const relabelled = { ...knows, data: { ...knows.data, label: 'trusts' } };
      const merge = mergeSnapshots(
        snap(gareth, ulf, knows),
        snap(ulf),
        snap(gareth, ulf, relabelled),
      );
      const { snapshot, unresolved } = resolveMerge(merge, [
        { recordId: 'a', field: '', side: 'ours' },
      ]);
      expect([...snapshot.keys()]).toEqual(['b']);
      expect(unresolved).toEqual([]);
    });

    it('keeps the Connections when the element is kept', () => {
      const merge = mergeSnapshots(
        snap(gareth, ulf, knows),
        snap(ulf, knows),
        snap(edited, ulf, knows),
      );
      const { snapshot } = resolveMerge(merge, [{ recordId: 'a', field: '', side: 'theirs' }]);
      expect(snapshot.get('c')).toEqual(knows);
    });
  });

  describe('layout', () => {
    const at = (x: number, y: number) => ({ x, y });

    it('treats a Node position as one field and lets the incoming side win a conflict', () => {
      const base = snap(el('a', { name: 'Gareth', position: at(0, 0) }));
      const ours = snap(el('a', { name: 'Gareth', position: at(5, 0) }));
      const theirs = snap(el('a', { name: 'Gareth', position: at(0, 9) }));
      const merge = mergeSnapshots(base, ours, theirs);
      expect(merge.records.get('a')?.fields).toEqual([
        {
          field: '/position',
          base: at(0, 0),
          ours: at(5, 0),
          theirs: at(0, 9),
          change: 'conflict',
          auto: 'theirs',
          layout: true,
        },
      ]);
      const { snapshot, unresolved } = resolveMerge(merge, []);
      expect(unresolved).toEqual([]);
      expect(dataOf(snapshot, 'a')).toEqual({ name: 'Gareth', position: at(0, 9) });
      const overridden = resolveMerge(merge, [{ recordId: 'a', field: '/position', side: 'ours' }]);
      expect(dataOf(overridden.snapshot, 'a')).toEqual({ name: 'Gareth', position: at(5, 0) });
    });

    it('lets a delete win over a move-only edit without prompting', () => {
      const gareth = el('a', { name: 'Gareth', position: at(0, 0) });
      const moved = el('a', { name: 'Gareth', position: at(3, 3) });
      // The incoming side only moved it; the delete still wins.
      const merge = mergeSnapshots(snap(gareth), snap(), snap(moved));
      const field = merge.records.get('a')?.fields[0];
      expect(field?.change).toBe('conflict');
      expect(field?.auto).toBe('ours');
      expect(resolveMerge(merge, []).snapshot.has('a')).toBe(false);
    });

    const group = (id: string, data: JsonObject) => rec('layoutGroup', id, data);

    it('merges Visual Groups per field, incoming side winning conflicts and delete vs edit', () => {
      const base = snap(group('g', { label: 'Town', color: 'red' }), group('h', { label: 'Inn' }));
      const ours = snap(group('g', { label: 'Village', color: 'blue' }));
      const theirs = snap(
        group('g', { label: 'City', color: 'red' }),
        group('h', { label: 'Tavern' }),
      );
      const merge = mergeSnapshots(base, ours, theirs);
      expect(merge.records.get('g')?.fields.map((f) => [f.field, f.change, f.auto])).toEqual([
        ['/color', 'ours', 'ours'],
        ['/label', 'conflict', 'theirs'],
      ]);
      const { snapshot, unresolved } = resolveMerge(merge, []);
      expect(unresolved).toEqual([]);
      expect(dataOf(snapshot, 'g')).toEqual({ label: 'City', color: 'blue' });
      expect(dataOf(snapshot, 'h')).toEqual({ label: 'Tavern' });
    });

    it('breaks a nesting cycle by taking the incoming parents', () => {
      // Base: g and h top-level. Ours nests h in g; theirs nests g in h.
      const base = snap(group('g', { parent: null }), group('h', { parent: null }));
      const ours = snap(group('g', { parent: null }), group('h', { parent: 'g' }));
      const theirs = snap(group('g', { parent: 'h' }), group('h', { parent: null }));
      const merge = mergeSnapshots(base, ours, theirs);
      const { snapshot, unresolved } = resolveMerge(merge, []);
      expect(unresolved).toEqual([]);
      expect(dataOf(snapshot, 'g')).toEqual({ parent: 'h' });
      expect(dataOf(snapshot, 'h')).toEqual({ parent: null });
    });
  });

  it('matches Event Scene tokens by id, so token moves on both sides of different tokens merge', () => {
    const scene = (tokens: JsonObject[]) => snap(rec('eventScene', 'sc', { tokens }));
    const t1 = { _id: 't1', x: 0, y: 0 };
    const t2 = { _id: 't2', x: 0, y: 0 };
    const merge = mergeSnapshots(
      scene([t1, t2]),
      scene([{ ...t1, x: 5 }, t2]),
      scene([t1, { ...t2, y: 7 }]),
    );
    expect(dataOf(resolveMerge(merge, []).snapshot, 'sc')).toEqual({
      tokens: [
        { ...t1, x: 5 },
        { ...t2, y: 7 },
      ],
    });
  });

  it('handles keys that look like JSON Pointer syntax or prototype names', () => {
    const base = snap(el('a', { 'a/b': 1, '~x': 1, ['__proto__']: 1 }));
    const theirs = snap(el('a', { 'a/b': 2, '~x': 2, ['__proto__']: 2 }));
    const merge = mergeSnapshots(base, base, theirs);
    expect(merge.records.get('a')?.fields.map((f) => f.field)).toEqual([
      '/__proto__',
      '/a~1b',
      '/~0x',
    ]);
    expect(dataOf(resolveMerge(merge, []).snapshot, 'a')).toEqual(theirs.get('a')?.data);
  });
});
