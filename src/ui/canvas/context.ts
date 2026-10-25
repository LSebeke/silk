/** Everything the canvas UI talks to. Built by `module.ts`, passed into the lazy chunk. */
import type {
  CanvasFilter,
  CanvasState,
  CreationPipeline,
  Focus,
  LayoutTween,
  ViewStateStore,
} from '../../core/canvas';
import type { Reveal } from '../../core/reveal';
import type { WorkingCopy } from '../../core/working-copy';

export interface CanvasContext {
  /** Registry runner: every UI action is a command. */
  run(name: string, args?: object): Promise<unknown>;
  /** Registry `isAvailable`. */
  available(name: string): boolean;
  workingCopy: WorkingCopy;
  state: CanvasState;
  pipeline: CreationPipeline;
  viewState: ViewStateStore;
  /** Untangle tween (§10.7). */
  layoutTween: LayoutTween;
  /** Client setting `detailDrop` (§10.2), read on open. */
  detailDrop: boolean;
  /** Canvas Filters (§10.5): what renders, "+N" badges, chip bar. */
  filter: CanvasFilter;
  /** Focus View (§10.6): seeds, hops, Focus Pins, why the focus changed. */
  focus: Focus;
  /** Re-read the Revealed source (Revelation Map) on open. */
  refreshRevealed(): Promise<void>;
  /** Client setting `renderBudgetWarning` (§10.5): warn above this many visible Nodes. */
  renderBudget: number;
  localize(key: string): string;
  /** Localised command title (context menus, §8 Controls). */
  title(name: string): string;
  /** The World's reveal state (eye toggles, menus; §8). Svelte-store `subscribe`. */
  reveal: Pick<Reveal, 'subscribe' | 'isRevealed'>;
  /** Warning toast. */
  warn(message: string): void;
}

/** Svelte context key for `CanvasContext` (cards read it). */
export const CANVAS_CONTEXT = Symbol('silk-canvas');
