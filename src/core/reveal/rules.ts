/**
 * Reveal rules on the Revelation Map (spec §8). Pure.
 * - Revealing a part Reveals its element(s), but nothing more.
 * - Un-reveal reverses: an element takes its Info Blocks, Appearance and Connections with
 *   it. Player Notes stay in the map (hidden with the element, back on re-Reveal, §8).
 * - The Appearance block and the Appearance (hooded image) go together.
 */
import { isRevealed, setRevealed, type RevealKind, type RevelationMap } from '../campaigns';

export type RevealTarget = Exclude<RevealKind, 'playerNote'>;

/** What the rules need to know about the Story graph. */
export interface RevealGraph {
  /** The element holding Info Block `id`. */
  elementOfBlock(id: string): string | undefined;
  /** A Connection's endpoints. */
  endsOf(id: string): readonly [string, string] | undefined;
  blocksOf(elementId: string): readonly string[];
  connectionsOf(elementId: string): readonly string[];
  /** The element's Appearance Info Block (Person/Creature), if it has one. */
  appearanceBlock(elementId: string): string | undefined;
  /** Person/Creature: has an Appearance (hooded image). */
  hasAppearance(elementId: string): boolean;
}

export function applyReveal(
  map: RevelationMap,
  kind: RevealTarget,
  id: string,
  revealed: boolean,
  graph: RevealGraph,
): RevelationMap {
  let next = map;
  const set = (k: RevealKind, x: string, on: boolean) => (next = setRevealed(next, k, x, on));
  const appearance = (el: string, on: boolean) => {
    if (graph.hasAppearance(el)) set('appearance', el, on);
    const block = graph.appearanceBlock(el);
    if (block) set('infoBlock', block, on);
  };
  switch (kind) {
    case 'element':
      set('element', id, revealed);
      if (!revealed) {
        for (const b of graph.blocksOf(id)) set('infoBlock', b, false);
        for (const c of graph.connectionsOf(id)) set('connection', c, false);
        set('appearance', id, false);
      }
      break;
    case 'appearance':
      appearance(id, revealed);
      if (revealed) set('element', id, true);
      break;
    case 'infoBlock': {
      const el = graph.elementOfBlock(id);
      set('infoBlock', id, revealed);
      if (el && graph.appearanceBlock(el) === id) appearance(el, revealed);
      if (el && revealed) set('element', el, true);
      break;
    }
    case 'connection':
      set('connection', id, revealed);
      if (revealed) for (const end of graph.endsOf(id) ?? []) set('element', end, true);
      break;
  }
  return next;
}

/** Element ids whose docs a map change touches (their ownership must be re-applied). */
export function touchedElements(
  before: RevelationMap,
  after: RevelationMap,
  graph: RevealGraph,
): string[] {
  const out = new Set<string>();
  const kinds: [RevealKind, (id: string) => readonly string[]][] = [
    ['element', (id) => [id]],
    ['appearance', (id) => [id]],
    ['infoBlock', (id) => [graph.elementOfBlock(id) ?? []].flat()],
    ['connection', (id) => graph.endsOf(id) ?? []],
    ['playerNote', () => []],
  ];
  const field = {
    element: 'elements',
    appearance: 'appearance',
    infoBlock: 'infoBlocks',
    connection: 'connections',
    playerNote: 'playerNotes',
  } as const;
  for (const [kind, owners] of kinds) {
    const ids = new Set([...before[field[kind]], ...after[field[kind]]]);
    for (const id of ids)
      if (isRevealed(before, kind, id) !== isRevealed(after, kind, id))
        for (const el of owners(id)) out.add(el);
  }
  return [...out];
}
