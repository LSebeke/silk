/**
 * Search (spec §10.8): one matcher + index shared by Search (`Ctrl+F`), `c` connect search
 * and the palette. Results in order: Nodes, Tags, Info Block text. Ghosts are included,
 * Connection labels are not (only element records are indexed). Pure.
 */
import type { Snapshot } from '../canon';
import type { ElementClassId } from '../elements/classes';
import { isGhost, readElement } from '../elements/element';

export interface SearchElement {
  id: string;
  name: string;
  class: ElementClassId;
  ghost: boolean;
}

export type SearchHit =
  | ({ kind: 'node' } & SearchElement)
  /** A Tag expands into its elements. */
  | { kind: 'tag'; tag: string; elements: SearchElement[] }
  | { kind: 'info'; id: string; name: string; block: string; snippet: string };

interface IndexedElement {
  element: SearchElement;
  key: string;
}

interface IndexedBlock {
  element: SearchElement;
  block: string;
  /** Plain text (HTML stripped). */
  text: string;
  key: string;
}

export interface SearchIndex {
  elements: IndexedElement[];
  tags: Map<string, { key: string; elements: SearchElement[] }>;
  blocks: IndexedBlock[];
}

/** Matcher normal form: lower case, no diacritics, collapsed whitespace. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The one matcher: substring of the normal form. */
export const matches = (key: string, query: string) => key.includes(query);

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

export function buildSearchIndex(records: Snapshot): SearchIndex {
  const index: SearchIndex = { elements: [], tags: new Map(), blocks: [] };
  for (const record of records.values()) {
    const e = readElement(record);
    if (!e) continue;
    const element: SearchElement = { id: e.id, name: e.name, class: e.class, ghost: isGhost(e) };
    index.elements.push({ element, key: normalize(e.name) });
    for (const tag of e.tags ?? []) {
      let entry = index.tags.get(tag);
      if (!entry) index.tags.set(tag, (entry = { key: normalize(tag), elements: [] }));
      entry.elements.push(element);
    }
    for (const b of e.infoBlocks ?? []) {
      const text = plain(b.text ?? '');
      index.blocks.push({ element, block: b.name, text, key: normalize(text) });
    }
  }
  const byName = (a: SearchElement, b: SearchElement) => a.name.localeCompare(b.name);
  index.elements.sort((a, b) => byName(a.element, b.element));
  for (const t of index.tags.values()) t.elements.sort(byName);
  return index;
}

/** Context around the first match in `text` (plain). */
function snippet(text: string, query: string): string {
  const at = normalize(text).indexOf(query);
  if (text.length <= 80 || at < 0) return text.length <= 80 ? text : `${text.slice(0, 80)}…`;
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + query.length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Hits for `query`, at most `limit` per kind. Empty query: none. */
export function searchIndex(index: SearchIndex, query: string, limit = 50): SearchHit[] {
  const q = normalize(query);
  if (!q) return [];
  const prefix: SearchHit[] = [];
  const inner: SearchHit[] = [];
  for (const e of index.elements) {
    if (prefix.length >= limit) break;
    if (!matches(e.key, q)) continue;
    (e.key.startsWith(q) ? prefix : inner).push({ kind: 'node', ...e.element });
  }
  const nodes = [...prefix, ...inner].slice(0, limit);

  const tags: SearchHit[] = [...index.tags]
    .filter(([, t]) => matches(t.key, q))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([tag, t]) => ({ kind: 'tag', tag, elements: t.elements }));

  const info: SearchHit[] = [];
  for (const b of index.blocks) {
    if (info.length >= limit) break;
    if (!matches(b.key, q)) continue;
    info.push({
      kind: 'info',
      id: b.element.id,
      name: b.element.name,
      block: b.block,
      snippet: snippet(b.text, q),
    });
  }
  return [...nodes, ...tags, ...info];
}
