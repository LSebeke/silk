import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeSnapshots, resolveMerge, type Pick, type Side } from './merge';
import type { CanonRecord, JsonObject, JsonValue, RecordKind, Snapshot } from './store';

// Small vocabularies so the three sides collide on keys, ids and values.
const leaf = fc.oneof(fc.integer({ min: 0, max: 2 }), fc.constantFrom('x', 'y'), fc.constant(null));
const { tree } = fc.letrec<{ tree: JsonObject; value: JsonValue; items: JsonValue[] }>((tie) => ({
  tree: fc.dictionary(fc.constantFrom('a', 'b', 'c', 'position'), tie('value'), { maxKeys: 3 }),
  value: fc.oneof({ depthSize: 'small', withCrossShrink: true }, leaf, tie('tree'), tie('items')),
  items: fc.uniqueArray(
    fc.record({ _id: fc.constantFrom('i1', 'i2', 'i3'), v: leaf, n: tie('tree') }),
    { selector: (item) => item._id, maxLength: 3 },
  ),
}));

const RECORDS: [string, RecordKind][] = [
  ['e1', 'element'],
  ['e2', 'element'],
  ['s1', 'sheet'],
];

function side(base: Snapshot): fc.Arbitrary<Snapshot> {
  const record = ([id, kind]: [string, RecordKind]) =>
    fc.oneof(
      fc.constant(base.get(id)),
      fc.constant(undefined),
      tree.map((data): CanonRecord => ({ kind, id, data })),
    );
  return fc
    .tuple(...RECORDS.map(record))
    .map((records) => new Map(records.filter((r) => r !== undefined).map((r) => [r.id, r])));
}

const bases = fc.tuple(...RECORDS.map(() => fc.option(tree, { nil: undefined }))).map(
  (datas): Snapshot =>
    new Map(
      RECORDS.flatMap(([id, kind], i) => {
        const data = datas[i];
        return data ? [[id, { kind, id, data }] as const] : [];
      }),
    ),
);
const triples = bases.chain((base) => fc.tuple(fc.constant(base), side(base), side(base)));

/** Embedded-entry order is not data (Foundry sorts by `sort`): compare by `_id`. */
function normalize(s: Snapshot) {
  const sortIds = (v: JsonValue): JsonValue =>
    Array.isArray(v)
      ? v
          .map(sortIds)
          .sort((a, b) =>
            String((a as JsonObject)?._id).localeCompare(String((b as JsonObject)?._id)),
          )
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sortIds(x)]))
        : v;
  return Object.fromEntries([...s].map(([id, r]) => [id, sortIds(r.data)]));
}

function pickAll(merge: ReturnType<typeof mergeSnapshots>, side: Side): Pick[] {
  return [...merge.records.values()].flatMap((r) =>
    r.fields.map((f) => ({ recordId: r.id, field: f.field, side })),
  );
}

describe('3-way merge properties', () => {
  it('picking one side for every field reproduces that side', () => {
    fc.assert(
      fc.property(triples, fc.constantFrom<Side>('base', 'ours', 'theirs'), ([b, o, t], pick) => {
        const merge = mergeSnapshots(b, o, t);
        const { snapshot, unresolved } = resolveMerge(merge, pickAll(merge, pick));
        expect(unresolved).toEqual([]);
        expect(normalize(snapshot)).toEqual(normalize({ base: b, ours: o, theirs: t }[pick]));
      }),
    );
  });

  it('takes the changed side when only one side changed', () => {
    fc.assert(
      fc.property(triples, ([b, , t]) => {
        const toTheirs = resolveMerge(mergeSnapshots(b, b, t), []);
        expect(toTheirs.unresolved).toEqual([]);
        expect(normalize(toTheirs.snapshot)).toEqual(normalize(t));
        const toOurs = resolveMerge(mergeSnapshots(b, t, b), []);
        expect(normalize(toOurs.snapshot)).toEqual(normalize(t));
      }),
    );
  });

  it('identical sides merge cleanly to that side', () => {
    fc.assert(
      fc.property(triples, ([b, o]) => {
        const merge = mergeSnapshots(b, o, o);
        expect(
          [...merge.records.values()]
            .flatMap((r) => r.fields)
            .every((f) => f.change !== 'conflict'),
        ).toBe(true);
        expect(normalize(resolveMerge(merge, []).snapshot)).toEqual(normalize(o));
      }),
    );
  });

  it('is symmetric: swapping sides swaps who changed what, conflicts stay conflicts', () => {
    fc.assert(
      fc.property(triples, ([b, o, t]) => {
        const flip = {
          ours: 'theirs',
          theirs: 'ours',
          both: 'both',
          conflict: 'conflict',
        } as const;
        const ab = mergeSnapshots(b, o, t);
        const ba = mergeSnapshots(b, t, o);
        const changes = (m: typeof ab, swap: boolean) =>
          [...m.records.values()].flatMap((r) =>
            r.fields.map((f) => `${r.id}${f.field}:${swap ? flip[f.change] : f.change}`),
          );
        expect(changes(ba, true)).toEqual(changes(ab, false));
      }),
    );
  });
});
