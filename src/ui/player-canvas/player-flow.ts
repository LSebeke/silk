/**
 * Player View → Svelte Flow Nodes and edges (spec §9). Pure. Read-only: nothing drags,
 * selects or connects. Edges reuse the GM canvas geometry (`toFlowEdges`: arrowheads,
 * parallel fan-out).
 */
import type { Edge, Node } from '@xyflow/svelte';
import type { CanonRecord } from '../../core/canon';
import type { ElementClassId } from '../../core/elements';
import type { PlayerView, PlayerViewNode } from '../../core/player-view';
import { toFlowEdges, type ConnectionEdgeData } from '../canvas/flow-edges';

export interface PlayerNodeData extends Record<string, unknown> {
  class: ElementClassId;
  /** From the Foundry doc the player can see. */
  name: string;
  /** Cover / actor image (hooded until Appearance); the card falls back to the class icon. */
  img?: string;
}

export type PlayerNode = Node<PlayerNodeData, 'player'>;
export type PlayerEdge = Edge<ConnectionEdgeData, 'player'>;

/** What the player's client shows for a Node. */
export type ResolveNode = (node: PlayerViewNode) => { name: string; img?: string };

export function toPlayerNodes(view: PlayerView, resolve: ResolveNode): PlayerNode[] {
  return view.nodes.map((n) => {
    const { name, img } = resolve(n);
    return {
      id: n.id,
      type: 'player',
      position: { x: n.x, y: n.y },
      draggable: false,
      selectable: false,
      connectable: false,
      data: { class: n.class, name, ...(img ? { img } : {}) },
    };
  });
}

export function toPlayerEdges(view: PlayerView): PlayerEdge[] {
  const records = new Map<string, CanonRecord>();
  for (const n of view.nodes)
    records.set(n.id, {
      kind: 'element',
      id: n.id,
      data: { class: n.class, name: '', position: { x: n.x, y: n.y } },
    });
  for (const { id, ...data } of view.connections)
    records.set(id, { kind: 'connection', id, data: { ...data } });
  return toFlowEdges(records, []).map((e) => ({ ...e, type: 'player', selectable: false }));
}
