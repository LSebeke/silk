/** Everything the Player Canvas talks to (spec §9). No Working Copy, no Canon. */
import type { Viewport } from '@xyflow/svelte';
import type { PlayerView } from '../../core/player-view';
import type { ResolveNode } from './player-flow';

export interface PlayerCanvasContext {
  /** Registry runner: clicks run `playerCanvas.openDoc`. */
  run(name: string, args?: object): Promise<unknown>;
  /** The Player View world setting. */
  view(): PlayerView;
  /** Called on Player View or visible-doc changes; returns the unsubscribe. */
  watch(fn: () => void): () => void;
  /** Name and Cover from the docs the player can see. */
  resolve: ResolveNode;
  /** Per-client pan/zoom (client setting `playerViewState`). */
  viewport: { get(): Viewport | undefined; save(viewport: Viewport): Promise<void> };
  localize(key: string): string;
}

export const PLAYER_CANVAS_CONTEXT = Symbol('silk-player-canvas');
