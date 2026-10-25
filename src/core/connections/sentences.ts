/**
 * Connection sentences for the Connections journal page (spec §5 "In journals"). Pure.
 * Free-form: directed "A loves B", mutual "A and B are friends". Behavioural types use
 * fixed localised phrases (`SILK.Connection.Sentence.<type>`).
 */
import type { Snapshot } from '../canon';
import { readElement } from '../elements';
import type { Connection } from './connection';
import { connectionsIn } from './rules';

/** Foundry `i18n.format`: `{from}`/`{to}`/`{label}` placeholders. */
export type Format = (key: string, data: Record<string, string>) => string;

const KEY = 'SILK.Connection.Sentence';

export function connectionSentence(
  c: Connection,
  name: (id: string) => string,
  format: Format,
): string {
  const data = { from: name(c.from), to: name(c.to), label: c.label };
  if (c.type !== 'free') return format(`${KEY}.${c.type}`, data);
  const shape = c.direction === 'mutual' ? 'mutual' : 'directed';
  return format(`${KEY}.${shape}${c.label ? '' : 'Unlabelled'}`, data);
}

/**
 * Sentences of every Connection touching `elementId`, sorted. `include` narrows them
 * (players see only Revealed Connections, §8).
 */
export function connectionSentences(
  records: Snapshot,
  elementId: string,
  format: Format,
  include: (c: Connection) => boolean = () => true,
): string[] {
  const name = (id: string) => readElement(records.get(id))?.name ?? '';
  return connectionsIn(records)
    .filter((c) => (c.from === elementId || c.to === elementId) && include(c))
    .map((c) => connectionSentence(c, name, format))
    .sort((a, b) => a.localeCompare(b));
}
