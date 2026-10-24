/**
 * Per-field 3-way merge of Canon snapshots (spec §11.3, §11.4).
 *
 * `ours` is the side merged into (Canon now / This World), `theirs` the
 * incoming side (Adventure / Canon incoming). Pure: produces a report the
 * merge UI renders, then `resolveMerge` applies the GM's picks.
 */
import type { CanonRecord, JsonObject, JsonValue, RecordKind, Snapshot } from './store';

export type Side = 'base' | 'ours' | 'theirs';

/** One changed field of one record. Values are `undefined` where absent. */
export interface FieldDiff {
  /**
   * JSON Pointer into the record's `data`; `''` is the whole record (added,
   * deleted, delete vs edit). Entries of id-keyed arrays (embedded Items,
   * tokens) are addressed by `_id`, not index: `/items/<_id>/name`.
   */
  field: string;
  base?: JsonValue;
  ours?: JsonValue;
  theirs?: JsonValue;
  /** Who changed it from base. `both` = same change on both sides. */
  change: 'ours' | 'theirs' | 'both' | 'conflict';
  /** Side taken unless picked. `null` = unresolved conflict. */
  auto: Side | null;
  /** Layout (Node position, Visual Group): conflicts auto-resolve to `theirs`. */
  layout?: true;
}

export interface RecordMerge {
  id: string;
  kind: RecordKind;
  base?: CanonRecord;
  ours?: CanonRecord;
  theirs?: CanonRecord;
  /** Changed fields only, sorted by `field`. Empty = record unchanged. */
  fields: FieldDiff[];
}

export interface MergeResult {
  base: Snapshot;
  ours: Snapshot;
  theirs: Snapshot;
  /** Every record present on any side, by id. */
  records: ReadonlyMap<string, RecordMerge>;
}

/** `merge.pick` (spec §15): take a side, or write a value (combined text). */
export type Pick =
  | { recordId: string; field: string; side: Side }
  | { recordId: string; field: string; value: JsonValue };

export interface Resolution {
  snapshot: Snapshot;
  /** Conflicts without a pick; they hold `ours` in `snapshot` until picked. */
  unresolved: { recordId: string; field: string }[];
  /** Connections dropped because an endpoint is deleted in the result (spec §11.4). */
  removedWithEndpoint: string[];
}

/** Connection fields naming its endpoint element ids. */
export const CONNECTION_ENDPOINTS = ['from', 'to'] as const;

/**
 * Layout fields per record kind, each merged as one field. Every field of a
 * `layoutGroup` record is layout too, merged per field.
 */
export const LAYOUT_FIELDS: Partial<Record<RecordKind, readonly string[]>> = {
  element: ['/position'],
};

/** Visual Group field holding the parent group id (or null). */
export const GROUP_PARENT = 'parent';

type Maybe = JsonValue | undefined;

export function mergeSnapshots(base: Snapshot, ours: Snapshot, theirs: Snapshot): MergeResult {
  const records = new Map<string, RecordMerge>();
  const ids = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
  for (const id of [...ids].sort()) {
    const b = base.get(id);
    const o = ours.get(id);
    const t = theirs.get(id);
    const any = o ?? t ?? b;
    if (!any) continue;
    const kind = any.kind;
    const fields: FieldDiff[] = [];
    diff(kind, '', b?.data, o?.data, t?.data, fields);
    fields.sort((x, y) => (x.field < y.field ? -1 : x.field > y.field ? 1 : 0));
    const whole = fields[0];
    // Delete vs a move-only edit: the delete wins, no prompt.
    const edited = o && t ? undefined : (o ?? t);
    if (whole?.field === '' && whole.auto === null && b && edited) {
      if (equal(withoutLayout(kind, b.data), withoutLayout(kind, edited.data)))
        whole.auto = o ? 'theirs' : 'ours';
    }
    records.set(id, { id, kind, base: b, ours: o, theirs: t, fields });
  }
  return { base, ours, theirs, records };
}

function isLayout(kind: RecordKind, field: string) {
  return kind === 'layoutGroup' || (LAYOUT_FIELDS[kind]?.includes(field) ?? false);
}

function withoutLayout(kind: RecordKind, data: JsonObject): JsonObject {
  let out: Maybe = data;
  for (const field of LAYOUT_FIELDS[kind] ?? []) out = setAt(out, field, undefined);
  return out as JsonObject;
}

function diff(kind: RecordKind, field: string, b: Maybe, o: Maybe, t: Maybe, out: FieldDiff[]) {
  if (equal(o, b) && equal(t, b)) return;
  const layout = isLayout(kind, field);
  // Containers on all three sides: report the changed leaves, not the subtree.
  // Layout fields of elements (Node position) stay one field.
  const container = containerKind(b);
  const atomic = layout && kind !== 'layoutGroup';
  if (
    !atomic &&
    b !== undefined &&
    o !== undefined &&
    t !== undefined &&
    container &&
    container === containerKind(o) &&
    container === containerKind(t)
  ) {
    const [cb, co, ct] = [children(b), children(o), children(t)];
    for (const key of new Set([...cb.keys(), ...co.keys(), ...ct.keys()]))
      diff(kind, `${field}/${escape(key)}`, cb.get(key), co.get(key), ct.get(key), out);
    return;
  }
  const push = (change: FieldDiff['change'], auto: Side | null) =>
    out.push({ field, base: b, ours: o, theirs: t, change, auto, ...(layout && { layout }) });
  if (equal(o, t)) push('both', 'ours');
  else if (equal(o, b)) push('theirs', 'theirs');
  else if (equal(t, b)) push('ours', 'ours');
  // Layout never prompts: the incoming side wins.
  else push('conflict', layout ? 'theirs' : null);
}

export function resolveMerge(merge: MergeResult, picks: readonly Pick[]): Resolution {
  const snapshot = new Map<string, CanonRecord>();
  let unresolved: Resolution['unresolved'] = [];
  for (const r of merge.records.values()) {
    const recordPicks = picks.filter((p) => p.recordId === r.id);
    let data: Maybe = r.ours?.data;
    const valueFor = (field: string, pick: Pick): Maybe => {
      if ('value' in pick) return pick.value;
      return valueAt(r[pick.side]?.data, field);
    };
    for (const f of r.fields) {
      const pick = recordPicks.findLast((p) => p.field === f.field);
      if (pick) data = setAt(data, f.field, valueFor(f.field, pick));
      else if (f.auto) data = setAt(data, f.field, f[f.auto]);
      else unresolved.push({ recordId: r.id, field: f.field });
    }
    for (const pick of recordPicks)
      if (!r.fields.some((f) => f.field === pick.field))
        data = setAt(data, pick.field, valueFor(pick.field, pick));
    if (isObject(data)) snapshot.set(r.id, { kind: r.kind, id: r.id, data });
  }

  breakGroupCycles(merge, snapshot);

  // Connections follow a deleted endpoint. One absent from the result still
  // follows (dropping its open conflict) if any side's endpoint is gone.
  const removedWithEndpoint: string[] = [];
  const following = new Set<string>();
  const endpointGone = (data: JsonObject | undefined) =>
    CONNECTION_ENDPOINTS.some((key) => {
      const id = data?.[key];
      return typeof id === 'string' && merge.records.has(id) && !snapshot.has(id);
    });
  for (const r of merge.records.values()) {
    if (r.kind !== 'connection') continue;
    const result = snapshot.get(r.id);
    const sides = result ? [result] : [r.base, r.ours, r.theirs];
    if (!sides.some((side) => endpointGone(side?.data))) continue;
    following.add(r.id);
    if (result) {
      snapshot.delete(r.id);
      removedWithEndpoint.push(r.id);
    }
  }
  unresolved = unresolved.filter((u) => !following.has(u.recordId));
  return { snapshot, unresolved, removedWithEndpoint };
}

/**
 * Visual Group nesting cycle: its groups take the incoming parent (none if
 * the group is not on the incoming side). Repeats until acyclic; terminates
 * because the incoming side itself is acyclic.
 */
function breakGroupCycles(merge: MergeResult, snapshot: Map<string, CanonRecord>) {
  const parentOf = (id: string) => {
    const parent = snapshot.get(id)?.data[GROUP_PARENT];
    return typeof parent === 'string' && snapshot.get(parent)?.kind === 'layoutGroup'
      ? parent
      : null;
  };
  for (const record of snapshot.values()) {
    if (record.kind !== 'layoutGroup') continue;
    for (;;) {
      const path: string[] = [];
      let id: string | null = record.id;
      while (id !== null && !path.includes(id)) {
        path.push(id);
        id = parentOf(id);
      }
      if (id === null) break;
      const cycle = path.slice(path.indexOf(id));
      const incoming = (member: string) => merge.theirs.get(member)?.data[GROUP_PARENT] ?? null;
      // Already incoming everywhere (a cyclic incoming side): cut it at one group.
      const cut = cycle.every((m) => equal(snapshot.get(m)?.data[GROUP_PARENT], incoming(m)));
      for (const member of cut ? cycle.slice(0, 1) : cycle) {
        const group = snapshot.get(member);
        if (!group) continue;
        const parent = cut ? null : incoming(member);
        snapshot.set(member, { ...group, data: { ...group.data, [GROUP_PARENT]: parent } });
      }
    }
  }
}

// ---- JSON tree helpers ----

function isObject(v: Maybe): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Array of objects with unique string `_id`s (embedded Items, tokens). `[]` qualifies. */
function isIdArray(v: Maybe): v is JsonObject[] {
  if (!Array.isArray(v)) return false;
  const ids = new Set<string>();
  for (const item of v) {
    if (!isObject(item) || typeof item._id !== 'string' || ids.has(item._id)) return false;
    ids.add(item._id);
  }
  return true;
}

function containerKind(v: Maybe): 'object' | 'idArray' | null {
  return isObject(v) ? 'object' : isIdArray(v) ? 'idArray' : null;
}

function children(v: JsonValue): Map<string, JsonValue> {
  if (isIdArray(v)) return new Map(v.map((item) => [item._id as string, item]));
  return new Map(Object.entries(v as JsonObject));
}

function equal(a: Maybe, b: Maybe): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as JsonValue[];
    return a.length === bb.length && a.every((x, i) => equal(x, bb[i]));
  }
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const keys = Object.keys(ao);
  return (
    keys.length === Object.keys(bo).length &&
    keys.every((k) => Object.hasOwn(bo, k) && equal(ao[k], bo[k]))
  );
}

function escape(key: string) {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function segments(field: string): string[] {
  return field === ''
    ? []
    : field
        .slice(1)
        .split('/')
        .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** Value at `field`, matching id-array entries by `_id`. */
export function valueAt(value: Maybe, field: string): Maybe {
  for (const key of segments(field)) {
    if (value === undefined) return undefined;
    value = child(value, key);
  }
  return value;
}

function child(v: JsonValue, key: string): Maybe {
  if (Array.isArray(v)) return v.find((item) => isObject(item) && item._id === key);
  return isObject(v) && Object.hasOwn(v, key) ? v[key] : undefined;
}

/**
 * Copy of `root` with `field` set to `value` (`undefined` removes it). New
 * id-array entries are appended. A missing parent leaves `root` unchanged.
 */
function setAt(root: Maybe, field: string, value: Maybe): Maybe {
  const keys = segments(field);
  const go = (node: Maybe, i: number): Maybe => {
    const key = keys[i];
    if (key === undefined) return value;
    if (node === undefined || node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      const idx = node.findIndex((item) => isObject(item) && item._id === key);
      const next = go(idx < 0 ? undefined : node[idx], i + 1);
      const copy = [...node];
      if (idx < 0) {
        if (next !== undefined && i + 1 === keys.length) copy.push(next);
      } else if (next === undefined) copy.splice(idx, 1);
      else copy[idx] = next;
      return copy;
    }
    const current = Object.hasOwn(node, key) ? node[key] : undefined;
    if (current === undefined && i + 1 < keys.length) return node;
    const next = go(current, i + 1);
    // fromEntries, not assignment: keys are data and may be `__proto__`.
    const rest = Object.entries(node).filter(([k]) => k !== key);
    return Object.fromEntries(next === undefined ? rest : [...rest, [key, next]]);
  };
  return go(root, 0);
}
