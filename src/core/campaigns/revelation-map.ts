/**
 * Revelation Map (spec §11.5): everything Revealed so far in one Campaign, as ids.
 * Current state only, unversioned, stored at `campaigns/<id>/revelation-map.json`.
 * Pure and immutable: every function returns a new map. Arrays are sorted and unique,
 * so the stored JSON is stable.
 */
import type { JsonValue } from '../canon';

export interface RevelationMap {
  /** Story Element ids with an element Reveal. */
  readonly elements: readonly string[];
  /** Person/Creature element ids whose Appearance is Revealed. */
  readonly appearance: readonly string[];
  readonly infoBlocks: readonly string[];
  readonly connections: readonly string[];
  readonly playerNotes: readonly string[];
}

export type RevealKind = 'element' | 'appearance' | 'infoBlock' | 'connection' | 'playerNote';

const FIELD = {
  element: 'elements',
  appearance: 'appearance',
  infoBlock: 'infoBlocks',
  connection: 'connections',
  playerNote: 'playerNotes',
} as const satisfies Record<RevealKind, keyof RevelationMap>;

const FIELDS = Object.values(FIELD);

export const REVELATION_MAP_FORMAT = 1;

export function emptyRevelationMap(): RevelationMap {
  return { elements: [], appearance: [], infoBlocks: [], connections: [], playerNotes: [] };
}

export function isRevealed(map: RevelationMap, kind: RevealKind, id: string): boolean {
  return map[FIELD[kind]].includes(id);
}

export function setRevealed(
  map: RevelationMap,
  kind: RevealKind,
  id: string,
  revealed: boolean,
): RevelationMap {
  const field = FIELD[kind];
  const ids = map[field].filter((x) => x !== id);
  if (revealed) ids.push(id);
  return { ...map, [field]: normalize(ids) };
}

/** Everything Revealed in either map; the default result of Join Campaigns. */
export function unionRevelationMaps(a: RevelationMap, b: RevelationMap): RevelationMap {
  return mapFields((f) => normalize([...a[f], ...b[f]]));
}

/**
 * Three-way merge per item: where `theirs` changed an item since `base`, it wins; otherwise
 * `ours` decides. Reconcile: base = the map this World last applied, theirs = the stored map
 * (changed elsewhere, e.g. Join Campaigns or a delete cleanup), ours = World ownership.
 */
export function mergeRevelationMaps(
  base: RevelationMap,
  theirs: RevelationMap,
  ours: RevelationMap,
): RevelationMap {
  return mapFields((f) => {
    const [b, t, o] = [new Set(base[f]), new Set(theirs[f]), new Set(ours[f])];
    return normalize(
      [...new Set([...b, ...t, ...o])].filter((id) => (t.has(id) !== b.has(id) ? t : o).has(id)),
    );
  });
}

/** Drop ids for which `exists` is false: deleted items drop out of the map. */
export function pruneRevelationMap(
  map: RevelationMap,
  exists: (id: string, kind: RevealKind) => boolean,
): RevelationMap {
  const kindOf = Object.fromEntries(Object.entries(FIELD).map(([k, f]) => [f, k])) as Record<
    keyof RevelationMap,
    RevealKind
  >;
  return mapFields((f) => map[f].filter((id) => exists(id, kindOf[f])));
}

/** Read the stored JSON (or `null` for a Campaign with no map yet). Junk entries are dropped. */
export function parseRevelationMap(json: JsonValue | null): RevelationMap {
  const doc = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  return mapFields((f) => {
    const value = doc[f];
    return Array.isArray(value)
      ? normalize(value.filter((v): v is string => typeof v === 'string'))
      : [];
  });
}

/** The stored JSON form. */
export function serializeRevelationMap(map: RevelationMap): JsonValue {
  return {
    formatVersion: REVELATION_MAP_FORMAT,
    ...Object.fromEntries(FIELDS.map((f) => [f, [...map[f]]])),
  };
}

function mapFields(fn: (field: keyof RevelationMap) => string[]): RevelationMap {
  return Object.fromEntries(FIELDS.map((f) => [f, fn(f)])) as unknown as RevelationMap;
}

function normalize(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}
