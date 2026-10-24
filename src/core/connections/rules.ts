/**
 * Behavioural Connection rules (spec §5): class-pair validity, cardinality, no cycles,
 * owns xor located in, create-from defaults. Pure.
 */
import type { Snapshot } from '../canon';
import { readElement, type ElementClassId } from '../elements';
import {
  BEHAVIOURAL_TYPES,
  readConnection,
  type BehaviouralType,
  type Connection,
  type ConnectionData,
} from './connection';

const ACTORS: readonly ElementClassId[] = ['person', 'creature', 'playerCharacter'];

const PAIRS: Record<
  BehaviouralType,
  { from: readonly ElementClassId[]; to: readonly ElementClassId[] }
> = {
  owns: { from: ACTORS, to: ['item'] },
  presentAt: { from: ['person', 'creature'], to: ['event'] },
  locatedIn: { from: ['item', 'location'], to: ['location'] },
  takesPlaceAt: { from: ['event'], to: ['location'] },
};

/** Behavioural types valid from → to, by class only (no cardinality or cycle check). */
export function validTypes(from: ElementClassId, to: ElementClassId): BehaviouralType[] {
  return BEHAVIOURAL_TYPES.filter((t) => PAIRS[t].from.includes(from) && PAIRS[t].to.includes(to));
}

/**
 * Default Connection when a Node of class `created` is made from a Node of class `origin`
 * (spec §5 table). `reverse`: the new element is the source.
 */
export function createFromDefault(
  origin: ElementClassId,
  created: ElementClassId,
): { type: BehaviouralType; reverse: boolean } | undefined {
  const isPersonish = created === 'person' || created === 'creature';
  if ((origin === 'person' || origin === 'creature') && created === 'item')
    return { type: 'owns', reverse: false };
  if (origin === 'event' && isPersonish) return { type: 'presentAt', reverse: true };
  if (origin === 'location' && (created === 'location' || created === 'item'))
    return { type: 'locatedIn', reverse: true };
  if (origin === 'location' && created === 'event') return { type: 'takesPlaceAt', reverse: true };
  return undefined;
}

export const connectionsIn = (records: Snapshot): Connection[] =>
  [...records.values()].flatMap((r) => readConnection(r) ?? []);

/** True when `from` located in `to` would close a cycle. */
function locatedInCycle(connections: Connection[], from: string, to: string, ignore?: string) {
  const parent = new Map(
    connections
      .filter((c) => c.type === 'locatedIn' && c.id !== ignore && c.from !== from)
      .map((c) => [c.from, c.to]),
  );
  const seen = new Set<string>();
  for (let at: string | undefined = to; at !== undefined; at = parent.get(at)) {
    if (at === from) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}

export type Check =
  | {
      ok: true;
      /** Connections the new one replaces (cardinality, owns xor located in). */ replaces: string[];
    }
  | { ok: false; reason: string };

/**
 * Can `data` be stored (as Connection `id`, if it replaces an existing one)? Free-form
 * always can. Endpoints must exist; caller checks that.
 */
export function check(records: Snapshot, data: ConnectionData, id?: string): Check {
  if (data.type === 'free') return { ok: true, replaces: [] };
  const from = readElement(records.get(data.from));
  const to = readElement(records.get(data.to));
  if (!from || !to) return { ok: false, reason: 'missing endpoint' };
  if (data.direction === 'mutual')
    return { ok: false, reason: `${data.type} is directed, never mutual` };
  if (!validTypes(from.class, to.class).includes(data.type))
    return { ok: false, reason: `${data.type} is not valid from ${from.class} to ${to.class}` };
  const others = connectionsIn(records).filter((c) => c.id !== id);
  if (data.type === 'locatedIn' && locatedInCycle(others, data.from, data.to))
    return { ok: false, reason: 'located in would form a cycle' };
  const replaces = others.filter((c) => {
    switch (data.type) {
      case 'owns':
        // ≤1 owner per Item; owns xor located in.
        return (
          (c.type === 'owns' && c.to === data.to) || (c.type === 'locatedIn' && c.from === data.to)
        );
      case 'locatedIn':
        return (
          (c.type === 'locatedIn' && c.from === data.from) ||
          (c.type === 'owns' && c.to === data.from)
        );
      case 'takesPlaceAt':
        return c.type === 'takesPlaceAt' && c.from === data.from;
      case 'presentAt':
        return false;
    }
  });
  return { ok: true, replaces: replaces.map((c) => c.id) };
}

/** An existing Behavioural Connection identical to `data`, if any. */
export function duplicateOf(records: Snapshot, data: ConnectionData): Connection | undefined {
  if (data.type === 'free') return undefined;
  return connectionsIn(records).find(
    (c) => c.type === data.type && c.from === data.from && c.to === data.to,
  );
}
