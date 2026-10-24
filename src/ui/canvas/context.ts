/** Everything the canvas UI talks to. Built by `module.ts`, passed into the lazy chunk. */
import type { CanvasState, CreationPipeline, ViewStateStore } from '../../core/canvas';
import type { WorkingCopy } from '../../core/working-copy';

export interface CanvasContext {
  /** Registry runner: every UI action is a command. */
  run(name: string, args?: object): Promise<unknown>;
  workingCopy: WorkingCopy;
  state: CanvasState;
  pipeline: CreationPipeline;
  viewState: ViewStateStore;
  /** Client setting `detailDrop` (§10.2), read on open. */
  detailDrop: boolean;
  localize(key: string): string;
}

/** Svelte context key for `CanvasContext` (cards read it). */
export const CANVAS_CONTEXT = Symbol('silk-canvas');
