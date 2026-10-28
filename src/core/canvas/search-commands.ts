/**
 * Search service + `canvas.search` / `canvas.jumpTo` (spec §10.8, §15 "Canvas"). The index
 * is rebuilt lazily after working copy changes. Jumping selects the Node (Focus View expands
 * to it); a Node the filters hide is shown temporarily, marked "filtered" (`!matches`),
 * until deselected. Newly created Nodes the filters would hide are treated the same way.
 */
import type { Command } from '../commands/registry';
import { readElement, type ElementData } from '../elements/element';
import type { WorkingCopy } from '../working-copy';
import type { CanvasState } from './canvas-state';
import type { CanvasFilter } from './filter-commands';
import { buildSearchIndex, searchIndex, type SearchHit, type SearchIndex } from './search';

export interface CanvasSearch {
  search(query: string): SearchHit[];
  jumpTo(id: string): void;
  /** The canvas moves the camera to a jumped-to Node. */
  onJump(listener: (id: string) => void): () => void;
  /** `element.create` hook: show a new Node the filters would hide. */
  afterCreate(element: { id: string } & ElementData): Promise<undefined>;
}

export interface CanvasSearchDeps {
  workingCopy(): WorkingCopy;
  filter: Pick<CanvasFilter, 'result' | 'showTemporarily' | 'keepTemporary'>;
  state: CanvasState;
}

export function createCanvasSearch(deps: CanvasSearchDeps): CanvasSearch {
  let index: SearchIndex | undefined;
  let watching: (() => void) | undefined;
  const listeners = new Set<(id: string) => void>();
  // Deselecting ends a temporary show.
  deps.state.subscribe(({ selection }) => deps.filter.keepTemporary(selection));

  function current(): SearchIndex {
    const wc = deps.workingCopy();
    if (!watching) watching = wc.watch(() => (index = undefined));
    return (index ??= buildSearchIndex(wc.records()));
  }

  const showIfHidden = (id: string) => {
    if (!deps.filter.result().visible.has(id)) deps.filter.showTemporarily([id]);
  };

  return {
    search: (query) => searchIndex(current(), query),
    jumpTo(id) {
      if (!readElement(deps.workingCopy().get(id))) throw new Error(`Silk: no element "${id}"`);
      showIfHidden(id);
      deps.state.select([id]);
      for (const l of listeners) l(id);
    },
    onJump(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async afterCreate({ id }) {
      showIfHidden(id);
      return undefined;
    },
  };
}

export function searchCommands(search: CanvasSearch): Command[] {
  const find: Command<{ query: string }, SearchHit[]> = {
    name: 'canvas.search',
    title: 'SILK.Commands.canvas.search',
    available: (ctx) => ctx.isGM,
    run: async ({ query }) => search.search(query ?? ''),
  };
  const jumpTo: Command<{ id: string }, void> = {
    name: 'canvas.jumpTo',
    title: 'SILK.Commands.canvas.jumpTo',
    available: (ctx) => ctx.isGM,
    run: async ({ id }) => search.jumpTo(id),
  };
  return [find, jumpTo];
}
