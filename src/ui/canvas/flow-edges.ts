/**
 * Working copy → Svelte Flow edges (spec §5 rendering). Pure. Directed = arrowhead,
 * mutual = none; parallel Connections between one pair fan out as separate curves;
 * edges attach on the side facing the other Node (`facingAnchor`, used by ConnectionEdge).
 */
import { MarkerType, type Edge } from '@xyflow/svelte';
import type { Snapshot } from '../../core/canon';
import {
  readConnection,
  type Connection,
  type ConnectionDirection,
  type ConnectionType,
} from '../../core/connections';
import { readElement } from '../../core/elements';

export interface ConnectionEdgeData extends Record<string, unknown> {
  type: ConnectionType;
  direction: ConnectionDirection;
  label: string;
  /** Curve bend in px, perpendicular to source → target. */
  offset: number;
}

export type ConnectionEdge = Edge<ConnectionEdgeData, 'connection'>;

const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const;
const FAN = 44;

function sameEdge(a: ConnectionEdge, b: ConnectionEdge) {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.data?.type === b.data?.type &&
    a.data?.direction === b.data?.direction &&
    a.data?.label === b.data?.label &&
    a.data?.offset === b.data?.offset
  );
}

/** `previous` edges are reused when unchanged, so Svelte Flow keeps their selection. */
export function toFlowEdges(
  records: Snapshot,
  previous: readonly ConnectionEdge[],
): ConnectionEdge[] {
  const prev = new Map(previous.map((e) => [e.id, e]));
  const connections = [...records.values()].flatMap((r) => {
    const c = readConnection(r);
    return c && readElement(records.get(c.from)) && readElement(records.get(c.to)) ? [c] : [];
  });
  const pairKey = (c: Connection) => (c.from < c.to ? `${c.from}|${c.to}` : `${c.to}|${c.from}`);
  const pairs = new Map<string, string[]>();
  for (const c of connections) pairs.set(pairKey(c), [...(pairs.get(pairKey(c)) ?? []), c.id]);
  return connections.map((c) => {
    const ids = pairs.get(pairKey(c)) ?? [c.id];
    // Spread in the lower-id → higher-id frame, so reversed edges stay apart.
    const offset = (ids.indexOf(c.id) - (ids.length - 1) / 2) * FAN * (c.from < c.to ? 1 : -1);
    const edge: ConnectionEdge = {
      id: c.id,
      type: 'connection',
      source: c.from,
      target: c.to,
      data: { type: c.type, direction: c.direction, label: c.label, offset: offset || 0 },
      // Always set: merging into a previous edge must drop a stale arrowhead.
      markerEnd: c.direction === 'directed' ? ARROW : undefined,
    };
    const old = prev.get(c.id);
    return old ? (sameEdge(old, edge) ? old : { ...old, ...edge }) : edge;
  });
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Midpoint of `from`'s side that faces `to`. */
export function facingAnchor(from: Box, to: Box): { x: number; y: number; side: Side } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = (to.x + to.width / 2 - cx) / from.width;
  const dy = (to.y + to.height / 2 - cy) / from.height;
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0
      ? { x: from.x + from.width, y: cy, side: 'right' }
      : { x: from.x, y: cy, side: 'left' };
  return dy >= 0
    ? { x: cx, y: from.y + from.height, side: 'bottom' }
    : { x: cx, y: from.y, side: 'top' };
}
