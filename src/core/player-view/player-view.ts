/**
 * Player View (spec §9): what the Player Canvas may show, stored in the world setting
 * `playerView` by the active GM. Revealed, Materialized Nodes (class, doc uuid, Canon
 * position) and Revealed Connections between them (type, direction, label). Names and
 * Covers come from the Foundry docs the player can see; Status, Info Blocks, Tags and
 * Visual Groups never go in. Pure.
 */
import type { Snapshot } from '../canon';
import { isRevealed, type RevelationMap } from '../campaigns';
import {
  readConnection,
  type ConnectionDirection,
  type ConnectionType,
} from '../connections/connection';
import { readElement, type ElementClassId } from '../elements';

export interface PlayerViewNode {
  id: string;
  class: ElementClassId;
  /** The Foundry doc (journal entry, or the LIMITED actor/item). */
  uuid: string;
  x: number;
  y: number;
}

export interface PlayerViewConnection {
  id: string;
  from: string;
  to: string;
  type: ConnectionType;
  direction: ConnectionDirection;
  label: string;
}

export interface PlayerView {
  nodes: PlayerViewNode[];
  connections: PlayerViewConnection[];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildPlayerView(records: Snapshot, map: RevelationMap): PlayerView {
  const nodes: PlayerViewNode[] = [];
  const connections: PlayerViewConnection[] = [];
  for (const record of records.values()) {
    const el = readElement(record);
    if (!el?.uuid || !isRevealed(map, 'element', el.id)) continue;
    nodes.push({ id: el.id, class: el.class, uuid: el.uuid, x: el.position.x, y: el.position.y });
  }
  const shown = new Set(nodes.map((n) => n.id));
  for (const record of records.values()) {
    const c = readConnection(record);
    if (!c || !isRevealed(map, 'connection', c.id) || !shown.has(c.from) || !shown.has(c.to))
      continue;
    const { id, from, to, type, direction, label } = c;
    connections.push({ id, from, to, type, direction, label });
  }
  return { nodes: nodes.sort(byId), connections: connections.sort(byId) };
}

const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    : [];

/** The well-formed entries of the stored setting (`{}` until the GM first writes it). */
export function parsePlayerView(stored: unknown): PlayerView {
  const raw = (stored ?? {}) as Record<string, unknown>;
  return {
    nodes: list(raw['nodes']).flatMap((n) =>
      str(n['id']) && str(n['class']) && str(n['uuid']) && num(n['x']) && num(n['y'])
        ? [
            {
              id: n['id'],
              class: n['class'] as ElementClassId,
              uuid: n['uuid'],
              x: n['x'],
              y: n['y'],
            },
          ]
        : [],
    ),
    connections: list(raw['connections']).flatMap((c) =>
      str(c['id']) && str(c['from']) && str(c['to']) && str(c['type']) && str(c['direction'])
        ? [
            {
              id: c['id'],
              from: c['from'],
              to: c['to'],
              type: c['type'] as ConnectionType,
              direction: c['direction'] as ConnectionDirection,
              label: str(c['label']) ? c['label'] : '',
            },
          ]
        : [],
    ),
  };
}
