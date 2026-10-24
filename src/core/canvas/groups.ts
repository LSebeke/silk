/**
 * Visual Groups (spec §10.4): labelled frames that hold Nodes, nesting without a depth limit.
 * Layout data in the Canon (§11.2): a `layoutGroup` record
 * `{ label, parent: groupId | null, position, size }`; a Node's frame is `element.data.group`
 * (merged as layout, merge.ts `LAYOUT_FIELDS`). Positions are absolute canvas coordinates.
 */
import {
  GROUP_PARENT,
  canonicalJson,
  type CanonRecord,
  type JsonObject,
  type Snapshot,
} from '../canon';
import type { Point } from '../elements/element';

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface VisualGroup {
  id: string;
  label: string;
  parent: string | null;
  position: Point;
  size: Size;
}

/** Element field naming the innermost Visual Group holding the Node. */
export const ELEMENT_GROUP = 'group';

/** A card's footprint for layout and frame fitting (ElementCard: 190 px wide, ≥ 78 px high). */
export const NODE_SIZE: Size = { width: 190, height: 80 };
/** Space between a frame and its contents; the top adds room for the title. */
export const FRAME_PAD = 30;
export const FRAME_TITLE = 40;

export function readGroup(record: CanonRecord | undefined): VisualGroup | undefined {
  if (record?.kind !== 'layoutGroup') return undefined;
  const d = record.data as Partial<Omit<VisualGroup, 'id'>>;
  return {
    id: record.id,
    label: typeof d.label === 'string' ? d.label : '',
    parent: typeof d.parent === 'string' ? d.parent : null,
    position: d.position ?? { x: 0, y: 0 },
    size: d.size ?? { width: 0, height: 0 },
  };
}

/** Element data with the Node in `group`, or in no group for `null`. */
export function withElementGroup(data: JsonObject, group: string | null): JsonObject {
  const out = Object.fromEntries(Object.entries(data).filter(([k]) => k !== ELEMENT_GROUP));
  if (group !== null) out[ELEMENT_GROUP] = group;
  return out;
}

export function groupRecord(group: VisualGroup): CanonRecord {
  const { id, ...data } = group;
  return { kind: 'layoutGroup', id, data: data as unknown as JsonObject };
}

/** The group holding a record: an element's `group` or a group's `parent`, if it exists. */
export function containerOf(records: Snapshot, id: string): string | null {
  const record = records.get(id);
  const raw =
    record?.kind === 'element'
      ? record.data[ELEMENT_GROUP]
      : record?.kind === 'layoutGroup'
        ? record.data[GROUP_PARENT]
        : null;
  return typeof raw === 'string' && records.get(raw)?.kind === 'layoutGroup' ? raw : null;
}

/** Enclosing groups, innermost first. Stops at a cycle. */
export function ancestorsOf(records: Snapshot, id: string): string[] {
  const out: string[] = [];
  for (
    let g = containerOf(records, id);
    g !== null && !out.includes(g);
    g = containerOf(records, g)
  )
    out.push(g);
  return out;
}

/** Footprint of an element (card) or a group (frame). */
export function rectOf(record: CanonRecord | undefined): Rect | undefined {
  if (record?.kind === 'element') {
    const p = record.data['position'] as Point | undefined;
    return { x: p?.x ?? 0, y: p?.y ?? 0, ...NODE_SIZE };
  }
  const group = readGroup(record);
  return group && { ...group.position, ...group.size };
}

export function union(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The frame rect that holds `content` with padding and title room. */
export function frameAround(content: Rect): Rect {
  return {
    x: content.x - FRAME_PAD,
    y: content.y - FRAME_PAD - FRAME_TITLE,
    width: content.width + 2 * FRAME_PAD,
    height: content.height + 2 * FRAME_PAD + FRAME_TITLE,
  };
}

const contains = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/**
 * The innermost Visual Group whose frame contains `point` (§10.4: a dropped Node joins the
 * innermost frame). Deepest nesting wins, then the smallest frame. `exclude` skips groups
 * (e.g. the ones being moved).
 */
export function innermostGroupAt(
  records: Snapshot,
  point: Point,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  let best: { id: string; depth: number; area: number } | null = null;
  for (const record of records.values()) {
    const group = readGroup(record);
    if (!group || exclude.has(group.id)) continue;
    if (!contains({ ...group.position, ...group.size }, point)) continue;
    const depth = ancestorsOf(records, group.id).length;
    const area = group.size.width * group.size.height;
    if (!best || depth > best.depth || (depth === best.depth && area < best.area))
      best = { id: group.id, depth, area };
  }
  return best?.id ?? null;
}

/** Ids of everything inside a group (elements and groups), at any depth. */
export function descendantsOf(records: Snapshot, groupId: string): string[] {
  const out: string[] = [];
  for (const id of records.keys()) if (ancestorsOf(records, id).includes(groupId)) out.push(id);
  return out;
}

/**
 * Grow the frames enclosing `ids` (all levels) so they contain their contents. Frames never
 * shrink. Reads and writes `records` (a mutable copy); returns the grown group ids.
 */
export function growFrames(records: Map<string, CanonRecord>, ids: Iterable<string>): string[] {
  const grown: string[] = [];
  const todo = new Set<string>();
  for (const id of ids) for (const g of ancestorsOf(records, id)) todo.add(g);
  // Deepest first, so outer frames see the grown inner ones.
  const ordered = [...todo].sort(
    (a, b) => ancestorsOf(records, b).length - ancestorsOf(records, a).length,
  );
  for (const id of ordered) {
    const group = readGroup(records.get(id));
    if (!group) continue;
    const children = [...records.keys()].filter((c) => containerOf(records, c) === id);
    const content = union(children.flatMap((c) => rectOf(records.get(c)) ?? []));
    if (!content) continue;
    const current = { ...group.position, ...group.size };
    const next = union([current, frameAround(content)]);
    if (!next || sameRect(next, current)) continue;
    records.set(
      id,
      groupRecord({
        ...group,
        position: { x: next.x, y: next.y },
        size: { width: next.width, height: next.height },
      }),
    );
    grown.push(id);
  }
  return grown;
}

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export interface LayoutMove {
  id: string;
  x: number;
  y: number;
}

/**
 * `canvas.moveNodes` on layout: a moved frame carries everything inside it along; a moved
 * Node joins the innermost frame under its centre (or none). Returns the changed records.
 */
export function applyMoves(records: Snapshot, moves: readonly LayoutMove[]): CanonRecord[] {
  const next = new Map(records);
  const moved = new Set(moves.map((m) => m.id));
  const shifted = new Set<string>();
  const shift = (id: string, dx: number, dy: number) => {
    const record = next.get(id);
    const p = record?.data['position'] as Point | undefined;
    if (!record || !p) return;
    next.set(id, { ...record, data: { ...record.data, position: { x: p.x + dx, y: p.y + dy } } });
  };

  // Frames first; each content shifts with its innermost moved frame.
  const groupMoves = moves
    .filter((m) => records.get(m.id)?.kind === 'layoutGroup')
    .sort((a, b) => ancestorsOf(records, b.id).length - ancestorsOf(records, a.id).length);
  for (const { id, x, y } of groupMoves) {
    const group = readGroup(records.get(id));
    if (!group) continue;
    const [dx, dy] = [x - group.position.x, y - group.position.y];
    shift(id, dx, dy);
    for (const inner of descendantsOf(records, id)) {
      if (moved.has(inner) || shifted.has(inner)) continue;
      shifted.add(inner);
      shift(inner, dx, dy);
    }
  }

  for (const { id, x, y } of moves) {
    const record = next.get(id);
    if (record?.kind !== 'element') continue;
    const center = { x: x + NODE_SIZE.width / 2, y: y + NODE_SIZE.height / 2 };
    const data = withElementGroup(
      { ...record.data, position: { x, y } },
      innermostGroupAt(next, center),
    );
    next.set(id, { ...record, data });
  }

  return [...next.values()].filter((r) => {
    const before = records.get(r.id);
    return r !== before && canonicalJson(r) !== canonicalJson(before ?? null);
  });
}
