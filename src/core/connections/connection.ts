/**
 * Connection records (spec §5, §11.1): `{ kind: 'connection', id, data }`.
 * `from`/`to` are element ids (merge.ts `CONNECTION_ENDPOINTS`). A directed Connection
 * points from → to; a mutual one has no direction (from/to is then just an order).
 * Behavioural types are always directed and carry no label (fixed localised phrases).
 */
import type { CanonRecord, JsonObject } from '../canon';

export const BEHAVIOURAL_TYPES = ['owns', 'presentAt', 'locatedIn', 'takesPlaceAt'] as const;
export type BehaviouralType = (typeof BEHAVIOURAL_TYPES)[number];
export type ConnectionType = BehaviouralType | 'free';

export type ConnectionDirection = 'directed' | 'mutual';

export interface ConnectionData {
  from: string;
  to: string;
  type: ConnectionType;
  direction: ConnectionDirection;
  /** Free-form only: verb phrase (directed) or plural predicate (mutual). */
  label: string;
}

export interface Connection extends ConnectionData {
  id: string;
}

export function connectionRecord(id: string, data: ConnectionData): CanonRecord {
  return { kind: 'connection', id, data: data as unknown as JsonObject };
}

/** The Connection in a record, or undefined if the record is not a Connection. */
export function readConnection(record: CanonRecord | undefined): Connection | undefined {
  if (record?.kind !== 'connection') return undefined;
  const data = record.data as unknown as Partial<ConnectionData>;
  return {
    from: data.from ?? '',
    to: data.to ?? '',
    type: data.type ?? 'free',
    direction: data.direction ?? 'directed',
    label: data.label ?? '',
    id: record.id,
  };
}

export const isBehavioural = (type: ConnectionType): type is BehaviouralType => type !== 'free';
