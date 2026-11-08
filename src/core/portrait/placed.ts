/**
 * One placed token's part of a look write (v1.1 §G.3 "All tokens follow", §G.3.1): the data
 * every token gets, with the token's own Unhooded snapshot stored, restored or dropped.
 * Pure; the adapter runs it for every placed token of the actor, linked and unlinked.
 */
import { hoodSnapshot, snapshotData } from './hood';
import type { PlacedToken, SnapshotMode } from './portrait';
import { valueAt } from './writes';

const SNAPSHOT = 'flags.silk.unhooded';
const DROP_SNAPSHOT = 'flags.silk.-=unhooded';

/** Update data for `token` (dotted keys), or `undefined` when it already matches. */
export function placedTokenUpdate(
  token: PlacedToken,
  data: Record<string, unknown>,
  snapshot?: SnapshotMode,
): Record<string, unknown> | undefined {
  const own = token.flags?.silk?.unhooded;
  let update = data;
  if (snapshot === 'store' && !own && token.texture?.src !== data['texture.src'])
    update = { ...data, [SNAPSHOT]: hoodSnapshot(token) };
  else if (snapshot === 'restore' && own)
    update = { ...data, ...snapshotData(own), [DROP_SNAPSHOT]: null };
  else if (snapshot === 'drop' && own) update = { ...data, [DROP_SNAPSHOT]: null };
  return Object.entries(update).every(([k, v]) => matches(token, k, v)) ? undefined : update;
}

/** `token` already has `value` at the dotted `key` (a `-=` key: nothing there). */
function matches(token: PlacedToken, key: string, value: unknown): boolean {
  const deleted = key.split('.').at(-1)?.startsWith('-=');
  if (deleted) return valueAt(token, key.replace('-=', '')) === undefined;
  const current = valueAt(token, key);
  if (typeof value === 'object' && value !== null)
    return JSON.stringify(current) === JSON.stringify(value);
  return (current ?? null) === (value ?? null);
}
