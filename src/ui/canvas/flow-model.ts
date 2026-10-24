/**
 * Working copy → Svelte Flow Nodes. Pure; the canvas recomputes on every working copy or
 * selection change. Canvas Filters / Focus View (T23/T24) filter `records` before this;
 * Visual Groups (T26) add `group` Nodes; Connections (T7) add a `toFlowEdges`.
 */
import type { Node } from '@xyflow/svelte';
import type { Snapshot } from '../../core/canon';
import { isGhost, readElement, type ElementClassId } from '../../core/elements';

export interface ElementNodeData extends Record<string, unknown> {
  class: ElementClassId;
  name: string;
  ghost: boolean;
}

export type ElementNode = Node<ElementNodeData, 'element'>;

function sameNode(a: ElementNode, b: ElementNode) {
  return (
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
): ElementNode[] {
  const prev = new Map(previous.map((n) => [n.id, n]));
  const selected = new Set(selection);
  const nodes: ElementNode[] = [];
  for (const record of records.values()) {
    const element = readElement(record);
    if (!element) continue;
    const node: ElementNode = {
      id: element.id,
      type: 'element',
      position: { x: element.position.x, y: element.position.y },
      selected: selected.has(element.id),
      data: { class: element.class, name: element.name, ghost: isGhost(element) },
    };
    const old = prev.get(element.id);
    nodes.push(old ? (sameNode(old, node) ? old : { ...old, ...node }) : node);
  }
  return nodes;
}

/** Three zoom levels (spec §10.2): full card → big title → coloured block with title. */
export type Lod = 'full' | 'title' | 'block';

export function lodForZoom(zoom: number): Lod {
  return zoom > 0.75 ? 'full' : zoom > 0.35 ? 'title' : 'block';
}
