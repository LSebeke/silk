/**
 * Canvas Filters service + commands (spec §10.5, §15 "Filters / Focus"). Holds the result
 * of `applyFilters` over the working copy and the view state's filters; the canvas renders
 * `result().visible`, `materialize.visible` reads `visibleIds()`.
 */
import { isRevealed, type RevelationMap } from '../campaigns/revelation-map';
import type { Command } from '../commands/registry';
import type { StoryElement } from '../elements/element';
import type { WorkingCopy } from '../working-copy';
import {
  applyFilters,
  isFilterDimension,
  type CanvasFilters,
  type FilterDimension,
  type FilterResult,
} from './filters';
import type { ViewState, ViewStateStore } from './view-state';

/** Revealed dimension (§8): the Campaign's Revelation Map under an Adventure, else ownership. */
export interface RevealedSource {
  isRevealed(element: StoryElement): boolean;
  /** Re-read the checked-out Campaign's map (checkout, Reveal, canvas open). */
  refresh(): Promise<void>;
  subscribe(run: () => void): () => void;
}

export function createRevealedSource(deps: {
  /** The checked-out Adventure's Campaign map; `null` under main. */
  revelationMap(): Promise<RevelationMap | null>;
  /** Under main: the World's current ownership says the element is Revealed. */
  ownership(element: StoryElement): boolean;
}): RevealedSource {
  let map: RevelationMap | null = null;
  const subscribers = new Set<() => void>();
  return {
    isRevealed: (e) => (map ? isRevealed(map, 'element', e.id) : deps.ownership(e)),
    async refresh() {
      map = await deps.revelationMap();
      for (const s of subscribers) s();
    },
    subscribe(run) {
      subscribers.add(run);
      return () => subscribers.delete(run);
    },
  };
}

export interface CanvasFilter {
  result(): FilterResult;
  /** Rendered element ids. */
  visibleIds(): string[];
  filters(): CanvasFilters;
  /** Ids shown via "+N" badges. */
  expanded(): readonly string[];
  set(dimension: FilterDimension, values: readonly string[]): Promise<void>;
  clear(dimension?: FilterDimension): Promise<void>;
  expandBadge(id: string): Promise<void>;
  /** Svelte store contract: now and after every change. */
  subscribe(run: (result: FilterResult) => void): () => void;
}

type FilterView = Pick<ViewState, 'filters' | 'expanded'>;

export interface CanvasFilterDeps {
  workingCopy(): WorkingCopy;
  viewState: ViewStateStore;
  revealed: RevealedSource;
  /** N of the N-hop dimension (Focus View, T24). */
  hops?(): number;
}

export function createCanvasFilter(deps: CanvasFilterDeps): CanvasFilter {
  let cached: { key: string; result: FilterResult } | undefined;
  const subscribers = new Set<(result: FilterResult) => void>();
  let watching: (() => void) | undefined;

  function result(): FilterResult {
    // Recomputed after a working copy change (`watch`) or when the stored filters differ
    // (the view state setting can also be written directly, e.g. by tests).
    if (!watching) {
      try {
        watching = deps.workingCopy().watch(changed);
      } catch {
        // Session not ready: compute without caching.
      }
    }
    const view = current();
    const hops = deps.hops?.();
    const key = JSON.stringify([view.filters, view.expanded, hops]);
    if (cached?.key === key && watching) return cached.result;
    const next = applyFilters(deps.workingCopy().records(), {
      filters: view.filters ?? {},
      revealed: (e) => deps.revealed.isRevealed(e),
      include: view.expanded ?? [],
      ...(hops !== undefined ? { hops } : {}),
    });
    if (watching) cached = { key, result: next };
    return next;
  }

  function changed() {
    cached = undefined;
    if (!subscribers.size) return;
    const r = result();
    for (const s of subscribers) s(r);
  }
  deps.revealed.subscribe(changed);

  /** Unsaved filter changes: the canvas follows at once, not after the setting round trip. */
  let pending: FilterView | undefined;
  let saving = 0;
  const current = (): FilterView => {
    const { filters, expanded } = deps.viewState.get();
    return { filters, expanded, ...pending };
  };
  async function save(patch: FilterView) {
    pending = { ...pending, ...patch };
    saving++;
    changed();
    try {
      await deps.viewState.update(patch);
    } finally {
      if (--saving === 0) pending = undefined;
    }
  }

  return {
    result,
    visibleIds: () => [...result().visible],
    filters: () => current().filters ?? {},
    expanded: () => current().expanded ?? [],
    async set(dimension, values) {
      if (!isFilterDimension(dimension))
        throw new Error(`Silk: unknown filter dimension "${String(dimension)}"`);
      const filters = { ...current().filters, [dimension]: [...new Set(values)] };
      if (dimension === 'revealed') await deps.revealed.refresh();
      await save({ filters });
    },
    async clear(dimension) {
      if (dimension === undefined) return save({ filters: {}, expanded: [] });
      const rest = Object.entries(current().filters ?? {}).filter(([d]) => d !== dimension);
      await save({ filters: Object.fromEntries(rest) });
    },
    async expandBadge(id) {
      const extra = result().hiddenNeighbours(id);
      if (!extra.length) return;
      await save({ expanded: [...new Set([...(current().expanded ?? []), ...extra])] });
    },
    subscribe(run) {
      subscribers.add(run);
      run(result());
      return () => subscribers.delete(run);
    },
  };
}

export function filterCommands(filter: CanvasFilter): Command[] {
  const set: Command<{ dimension: FilterDimension; values: string[] }, void> = {
    name: 'filter.set',
    title: 'SILK.Commands.filter.set',
    available: (ctx) => ctx.isGM,
    run: ({ dimension, values }) => filter.set(dimension, values ?? []),
  };
  const clear: Command<{ dimension?: FilterDimension }, void> = {
    name: 'filter.clear',
    title: 'SILK.Commands.filter.clear',
    available: (ctx) => ctx.isGM,
    run: ({ dimension } = {}) => filter.clear(dimension),
  };
  const expandBadge: Command<{ id: string }, void> = {
    name: 'filter.expandBadge',
    title: 'SILK.Commands.filter.expandBadge',
    available: (ctx) => ctx.isGM,
    run: ({ id }) => filter.expandBadge(id),
  };
  return [set, clear, expandBadge];
}
