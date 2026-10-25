/**
 * Canvas Filters engine (spec §10.5). Pure: records + active filters → which Nodes render.
 * OR within a dimension, AND across dimensions; an empty value list is inactive.
 * Filtered-out Nodes are not rendered; a visible Node with Connections to hidden Nodes
 * gets a "+N" badge. Focus View (§10.6) is the `hops` dimension (seeds + N); Search's
 * temporary "filtered" Nodes (§10.8) go in `include` and are marked where `!matches(id)`.
 */
import type { Snapshot } from '../canon';
import { readConnection } from '../connections/connection';
import { isGhost, readElement, type StoryElement } from '../elements/element';
import { statusOf } from '../elements/status';
import { ancestorsOf, readGroup } from './groups';

export const FILTER_DIMENSIONS = [
  'class',
  'status',
  'revealed',
  'materialized',
  'tag',
  'group',
  'hops',
  'contents',
] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

/**
 * Values per dimension: class ids, Status values, `revealed|hidden`, `materialized|ghost`,
 * Tags, Visual Group ids, N-hop seed ids, Location ids ("show contents").
 */
export type CanvasFilters = Partial<Record<FilterDimension, readonly string[]>>;

/** Default N of the N-hop dimension (§10.6). */
export const DEFAULT_HOPS = 2;

export interface FilterInput {
  filters: CanvasFilters;
  /**
   * Revealed dimension: under an Adventure the Campaign's Revelation Map, under main the
   * World's current ownership (§8). See `createRevealedSource`.
   */
  revealed(element: StoryElement): boolean;
  /** N of the N-hop dimension; default `DEFAULT_HOPS`. */
  hops?: number;
  /** Always shown, whatever the filters: expanded "+N" neighbours, Focus Pins, Search jumps. */
  include?: Iterable<string>;
}

export interface FilterResult {
  /** Any dimension active. */
  active: boolean;
  /** Element ids to render. */
  visible: ReadonlySet<string>;
  /** Visual Group ids to render: all without filters, else those holding a visible Node. */
  frames: ReadonlySet<string>;
  /** Element count (M of "N of M shown"). */
  total: number;
  /** Visible id → number of distinct hidden neighbours ("+N"); only N > 0. */
  badges: ReadonlyMap<string, number>;
  hiddenNeighbours(id: string): string[];
  /** Passes the filters (as opposed to shown only via `include`). */
  matches(id: string): boolean;
}

export const isFilterDimension = (d: unknown): d is FilterDimension =>
  FILTER_DIMENSIONS.includes(d as FilterDimension);

/** Only dimensions with values. */
export function activeFilters(filters: CanvasFilters): [FilterDimension, readonly string[]][] {
  return FILTER_DIMENSIONS.flatMap((d) => {
    const values = filters[d];
    return values?.length ? [[d, values] as [FilterDimension, readonly string[]]] : [];
  });
}

export function applyFilters(records: Snapshot, input: FilterInput): FilterResult {
  const elements: StoryElement[] = [];
  const frames = new Set<string>();
  const neighbours = new Map<string, Set<string>>();
  const locatedIn = new Map<string, string[]>();
  for (const record of records.values()) {
    const element = readElement(record);
    if (element) {
      elements.push(element);
      continue;
    }
    if (readGroup(record)) {
      frames.add(record.id);
      continue;
    }
    const c = readConnection(record);
    if (!c) continue;
    if (!neighbours.has(c.from)) neighbours.set(c.from, new Set());
    if (!neighbours.has(c.to)) neighbours.set(c.to, new Set());
    neighbours.get(c.from)?.add(c.to);
    neighbours.get(c.to)?.add(c.from);
    // Container → contents, for "show contents".
    if (c.type === 'locatedIn') locatedIn.set(c.to, [...(locatedIn.get(c.to) ?? []), c.from]);
  }
  const ids = new Set(elements.map((e) => e.id));
  const active = activeFilters(input.filters);

  const tests = active.map(([dimension, values]): ((e: StoryElement) => boolean) => {
    const set = new Set(values);
    switch (dimension) {
      case 'class':
        return (e) => set.has(e.class);
      case 'status':
        return (e) => {
          const status = statusOf(e);
          return status !== undefined && set.has(status);
        };
      case 'revealed':
        return (e) => set.has(input.revealed(e) ? 'revealed' : 'hidden');
      case 'materialized':
        return (e) => set.has(isGhost(e) ? 'ghost' : 'materialized');
      case 'tag':
        return (e) => (e.tags ?? []).some((t) => set.has(t));
      case 'group':
        return (e) => ancestorsOf(records, e.id).some((g) => set.has(g));
      case 'hops': {
        const near = reach(values, input.hops ?? DEFAULT_HOPS, (id) => neighbours.get(id));
        return (e) => near.has(e.id);
      }
      case 'contents': {
        const inside = reach(values, Infinity, (id) => locatedIn.get(id));
        return (e) => inside.has(e.id);
      }
    }
  });

  const matched = new Set<string>();
  for (const e of elements) if (tests.every((t) => t(e))) matched.add(e.id);
  const visible = new Set(matched);
  for (const id of input.include ?? []) if (ids.has(id)) visible.add(id);

  const hidden = (id: string) =>
    [...(neighbours.get(id) ?? [])].filter((n) => ids.has(n) && !visible.has(n));
  const badges = new Map<string, number>();
  if (visible.size < ids.size)
    for (const id of visible) {
      const n = hidden(id).length;
      if (n) badges.set(id, n);
    }

  const shownFrames = active.length ? new Set<string>() : frames;
  if (active.length)
    for (const id of visible) for (const g of ancestorsOf(records, id)) shownFrames.add(g);

  return {
    active: active.length > 0,
    visible,
    frames: shownFrames,
    total: ids.size,
    badges,
    hiddenNeighbours: (id) => (visible.has(id) ? hidden(id) : []),
    matches: (id) => matched.has(id),
  };
}

/** Breadth-first: ids within `depth` steps of `seeds`. */
function reach(
  seeds: readonly string[],
  depth: number,
  next: (id: string) => Iterable<string> | undefined,
): Set<string> {
  const seen = new Set(seeds);
  let frontier = [...seen];
  for (let d = 0; d < depth && frontier.length; d++) {
    const out: string[] = [];
    for (const id of frontier)
      for (const n of next(id) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
    frontier = out;
  }
  return seen;
}
