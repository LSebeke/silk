/**
 * The Silk-generated Connections page (spec §4 Journal layout, §5 "In journals"): one
 * read-only sentence per Connection, on both endpoints. Kept current from Working Copy
 * changes (Connection create/edit/flip/delete, endpoint rename, Materialize, class change).
 * Pure core over the `FoundryDocs` port; the active GM runs it.
 */
import type { Snapshot } from '../canon';
import { connectionSentences, readConnection, type Connection, type Format } from '../connections';
import { readElement } from '../elements';
import type { WorkingCopy } from '../working-copy';
import type { DocSnapshot, FoundryDocs } from './port';

export interface ConnectionsPagesDeps {
  workingCopy(): WorkingCopy;
  docs: Pick<FoundryDocs, 'updatePage'>;
  /** The element's docs if Materialized (`Materializer.docsOf`). */
  docsOf(id: string): { main: DocSnapshot; companion?: DocSnapshot } | undefined;
  format: Format;
  /** Which Connections the page lists. Default all; Reveal (T16) narrows it. */
  include?(connection: Connection, records: Snapshot): boolean;
}

export interface ConnectionsPages {
  /** Rewrites the pages of `ids` (default: every element) where they are stale. */
  refresh(ids?: readonly string[]): Promise<void>;
  /** Follows Working Copy changes. Returns a stop function. */
  watch(): () => void;
  /** Resolves when queued page writes are done. */
  idle(): Promise<void>;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function connectionsPageHtml(sentences: readonly string[]): string {
  return sentences.length ? `<ul>${sentences.map((s) => `<li>${s}</li>`).join('')}</ul>` : '';
}

/** What a record contributes to Connections pages, to diff changes against. */
type Seen = { kind: 'connection'; ends: string[] } | { kind: 'element'; key: string; name: string };

function seen(records: Snapshot, id: string): Seen | undefined {
  const record = records.get(id);
  const c = readConnection(record);
  if (c) return { kind: 'connection', ends: [c.from, c.to] };
  const el = readElement(record);
  if (el) return { kind: 'element', key: `${el.uuid ?? ''}|${el.class}`, name: el.name };
  return undefined;
}

export function createConnectionsPages(deps: ConnectionsPagesDeps): ConnectionsPages {
  let queue: Promise<void> = Promise.resolve();

  function html(records: Snapshot, id: string) {
    // Names and labels are escaped before they enter the localised phrase.
    const format: Format = (key, data) =>
      deps.format(key, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, escape(v)])));
    const { include: filter } = deps;
    const include = filter ? (c: Connection) => filter(c, records) : undefined;
    return connectionsPageHtml(connectionSentences(records, id, format, include));
  }

  async function write(id: string) {
    const records = deps.workingCopy().records();
    if (!readElement(records.get(id))) return;
    const found = deps.docsOf(id);
    if (!found) return;
    const journal = found.main.documentName === 'JournalEntry' ? found.main : found.companion;
    const pageId = journal?.flags.silk.connections;
    const page = pageId ? journal.pages?.find((p) => p._id === pageId) : undefined;
    if (!journal || !page) return;
    const content = html(records, id);
    if ((page.text?.content ?? '') === content) return;
    await deps.docs.updatePage(journal.uuid, page._id, { 'text.content': content });
  }

  function refresh(ids?: readonly string[]) {
    const job = queue.then(async () => {
      const targets = ids ?? [...deps.workingCopy().records().keys()];
      for (const id of new Set(targets)) await write(id);
    });
    queue = job.catch((error: unknown) => console.error(error));
    return job;
  }

  return {
    refresh,
    idle: () => queue,
    watch() {
      const wc = deps.workingCopy();
      const cache = new Map<string, Seen>();
      for (const id of wc.records().keys()) {
        const s = seen(wc.records(), id);
        if (s) cache.set(id, s);
      }
      return wc.watch((change) => {
        const records = wc.records();
        const affected = new Set<string>();
        const neighbours = (id: string) => {
          for (const r of records.values()) {
            const c = readConnection(r);
            if (c && (c.from === id || c.to === id)) affected.add(c.from).add(c.to);
          }
        };
        for (const id of [...change.set, ...change.deleted]) {
          const before = cache.get(id);
          const after = seen(records, id);
          if (after) cache.set(id, after);
          else cache.delete(id);
          for (const s of [before, after])
            if (s?.kind === 'connection') for (const end of s.ends) affected.add(end);
          if (after?.kind === 'element') {
            if (before?.kind !== 'element' || before.name !== after.name) neighbours(id);
            if (before?.kind !== 'element' || before.key !== after.key) affected.add(id);
          }
        }
        if (change.binding) for (const id of records.keys()) affected.add(id);
        if (affected.size) void refresh([...affected]).catch(() => {});
      });
    },
  };
}
