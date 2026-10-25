/**
 * Attribution chips (spec §11.4): which Commit on main last changed a field since the
 * Adventure started. Pure over the first-parent chain of main.
 */
import { canonicalJson, valueAt, type Snapshot } from '../canon';
import type { Attribution } from './rows';

/** One Commit on main after the Adventure's base, with its snapshot and its parent's. */
export interface CanonChange {
  attribution: Attribution;
  snapshot: Snapshot;
  parent: Snapshot;
}

const json = (v: unknown) => (v === undefined ? '' : canonicalJson(v));

/** `changes` newest first. `undefined` when no Commit on the chain changed the field. */
export function attribute(
  changes: readonly CanonChange[],
  recordId: string,
  field: string,
): Attribution | undefined {
  for (const c of changes) {
    const now = valueAt(c.snapshot.get(recordId)?.data, field);
    const before = valueAt(c.parent.get(recordId)?.data, field);
    if (json(now) !== json(before)) return c.attribution;
  }
  return undefined;
}
