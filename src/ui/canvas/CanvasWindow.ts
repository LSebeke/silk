/** World Canvas window (spec §10.1). Loaded lazily by `canvas.open`. */
import { SvelteApplication } from '../SvelteApplication.svelte';
import CanvasRoot from './CanvasRoot.svelte';
import type { CanvasContext } from './context';

export class CanvasWindow extends SvelteApplication<{ ctx: CanvasContext }> {
  static readonly ID = 'silk-canvas';

  static override persistWindowState = true;

  static override DEFAULT_OPTIONS = {
    id: CanvasWindow.ID,
    classes: ['silk', 'silk-canvas-window'],
    window: { title: 'SILK.Canvas.Title', resizable: true, icon: 'fa-solid fa-diagram-project' },
    position: { width: 1100, height: 700 },
  };

  protected readonly component = CanvasRoot;

  readonly #ctx: CanvasContext;

  constructor(ctx: CanvasContext) {
    super();
    this.#ctx = ctx;
  }

  protected getProps() {
    return { ctx: this.#ctx };
  }
}
