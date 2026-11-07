/** Everything the canvas UI talks to. Built by `module.ts`, passed into the lazy chunk. */
import type {
  CanvasFilter,
  CanvasState,
  CanvasSearch,
  CreationPipeline,
  Focus,
  LayoutTween,
  ViewStateStore,
} from '../../core/canvas';
import type { LiveKeybinding } from '../../adapter/keybindings';
import type { CheckoutSummary } from '../../core/campaigns';
import type { Point } from '../../core/elements';
import type { Reveal } from '../../core/reveal';
import type { WorkingCopy } from '../../core/working-copy';
import type { LegendState } from './legend';

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
  /** Search (§10.8): the canvas moves the camera on `canvas.jumpTo`. */
  search: Pick<CanvasSearch, 'onJump'>;
  localize(key: string): string;
  /** Adopt a dropped Foundry doc (§6 Ways in): ends in the Creation Pipeline. */
  adopt?(uuid: string, options: { at: Point; anchor: Point; connectTo?: string }): Promise<void>;
  /** Localised command title (context menus, §8 Controls). */
  title(name: string): string;
  /** The World's reveal state (eye toggles, menus; §8). Svelte-store `subscribe`. */
  reveal: Pick<Reveal, 'subscribe' | 'isRevealed'>;
  /** Legend open/closed (1.1 §E.3, client setting `legendOpen`); `legend.toggle` writes it. */
  legend: LegendState;
  /** Silk's Foundry keybindings as bound now (`game.keybindings`), for the legend. */
  keybindings(): LiveKeybinding[];
  /** Warning toast. */
  warn(message: string): void;
  /** Canon chip / unbound empty state (v1.1 §H); `null` while the World has no Canon. */
  checkoutSummary(): Promise<CheckoutSummary | null>;
}

/** Svelte context key for `CanvasContext` (cards read it). */
export const CANVAS_CONTEXT = Symbol('silk-canvas');

/** Palette drag (§10.3): `DataTransfer` type carrying the class id. */
export const PALETTE_MIME = 'application/x-silk-class';
