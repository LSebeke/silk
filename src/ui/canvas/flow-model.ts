/**
 * Working copy → Svelte Flow Nodes. Pure; the canvas recomputes on every working copy or
 * selection change. Canvas Filters / Focus View (T23/T24) filter `records` before this;
 * Visual Groups (T26) add `group` Nodes; Connections (T7) add a `toFlowEdges`.
 */
import type { Node } from '@xyflow/svelte';
import type { Snapshot } from '../../core/canon';
import { ancestorsOf, containerOf, readGroup } from '../../core/canvas/groups';
import { isGhost, readElement, type ElementClassId, type Point } from '../../core/elements';

export interface ElementNodeData extends Record<string, unknown> {
  class: ElementClassId;
  name: string;
  ghost: boolean;
}

export type ElementNode = Node<ElementNodeData, 'element'>;

function sameNode(a: ElementNode, b: ElementNode) {
  return (
    a.parentId === b.parentId &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    !!a.selected === !!b.selected &&
    a.data.class === b.data.class &&
    a.data.name === b.data.name &&
    a.data.ghost === b.data.ghost
  );
}

/**
 * `previous` Nodes are reused when unchanged, and otherwise keep their Svelte Flow
 * bookkeeping (`measured`, …), so cards are not re-measured on every write.
 */
export function toFlowNodes(
  records: Snapshot,
  selection: readonly string[],
  previous: readonly ElementNode[],
  /** Absolute position override (Untangle tween), else the record's. */
  at?: (id: string) => Point | undefined,
): ElementNode[] {
  const prev = new Map(previous.map((n) => [n.id, n]));
  const selected = new Set(selection);
  const nodes: ElementNode[] = [];
  for (const record of records.values()) {
    const element = readElement(record);
    if (!element) continue;
    // In a Visual Group: a child Node, positioned relative to the frame.
    const parent = containerOf(records, element.id);
    const origin = readGroup(parent ? records.get(parent) : undefined)?.position ?? { x: 0, y: 0 };
    const position = at?.(element.id) ?? element.position;
    const node: ElementNode = {
      id: element.id,
      type: 'element',
      parentId: parent ?? undefined,
      position: { x: position.x - origin.x, y: position.y - origin.y },
      selected: selected.has(element.id),
      data: { class: element.class, name: element.name, ghost: isGhost(element) },
    };
    const old = prev.get(element.id);
    nodes.push(old ? (sameNode(old, node) ? old : { ...old, ...node }) : node);
  }
  return nodes;
}

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
}

export type GroupNode = Node<GroupNodeData, 'frame'>;

/** Frames sit below cards and Connections, also when selected (Svelte Flow adds 1000). */
const FRAME_Z = -1000;

/**
 * Visual Groups → frame Nodes (spec §10.4). Svelte Flow needs parents before children, so
 * the result is ordered by nesting depth; a nested frame is positioned relative to its parent.
 */
export function toGroupNodes(
  records: Snapshot,
  selection: readonly string[],
  previous: readonly GroupNode[],
): GroupNode[] {
  const prev = new Map(previous.map((n) => [n.id, n]));
  const selected = new Set(selection);
  const groups = [...records.values()].flatMap((r) => readGroup(r) ?? []);
  const depth = new Map(groups.map((g) => [g.id, ancestorsOf(records, g.id).length]));
  groups.sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));
  return groups.map((group) => {
    const parent = containerOf(records, group.id);
    const origin = readGroup(parent ? records.get(parent) : undefined)?.position ?? { x: 0, y: 0 };
    const node: GroupNode = {
      id: group.id,
      type: 'frame',
      ...(parent && { parentId: parent }),
      position: { x: group.position.x - origin.x, y: group.position.y - origin.y },
      width: group.size.width,
      height: group.size.height,
      zIndex: FRAME_Z,
      selected: selected.has(group.id),
      data: { label: group.label },
    };
    const old = prev.get(group.id);
    if (!old) return node;
    const same =
      old.parentId === node.parentId &&
      old.position.x === node.position.x &&
      old.position.y === node.position.y &&
      old.width === node.width &&
      old.height === node.height &&
      !!old.selected === !!node.selected &&
      old.data.label === node.data.label;
    return same ? old : { ...old, parentId: undefined, ...node };
  });
}

/** Three zoom levels (spec §10.2): full card → big title → coloured block with title. */
export type Lod = 'full' | 'title' | 'block';

export function lodForZoom(zoom: number): Lod {
  return zoom > 0.75 ? 'full' : zoom > 0.35 ? 'title' : 'block';
}
