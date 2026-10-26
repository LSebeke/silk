/** Player Canvas window (spec §9). Loaded lazily by `canvas.open` on a player's client. */
import { SvelteApplication } from '../SvelteApplication.svelte';
import PlayerCanvasRoot from './PlayerCanvasRoot.svelte';
import type { PlayerCanvasContext } from './context';

export class PlayerCanvasWindow extends SvelteApplication<{ ctx: PlayerCanvasContext }> {
  static readonly ID = 'silk-player-canvas';

  static override persistWindowState = true;

  static override DEFAULT_OPTIONS = {
    id: PlayerCanvasWindow.ID,
    classes: ['silk', 'silk-canvas-window', 'silk-player-canvas-window'],
    window: {
      title: 'SILK.PlayerCanvas.Title',
      resizable: true,
      icon: 'fa-solid fa-diagram-project',
    },
    position: { width: 1000, height: 650 },
  };

  protected readonly component = PlayerCanvasRoot;

  readonly #ctx: PlayerCanvasContext;

  constructor(ctx: PlayerCanvasContext) {
    super();
    this.#ctx = ctx;
  }

  protected getProps() {
    return { ctx: this.#ctx };
  }
}

/** Opens (or raises) the Player Canvas window. */
export async function openPlayerCanvasWindow(ctx: PlayerCanvasContext): Promise<void> {
  const existing = foundry.applications.instances.get(PlayerCanvasWindow.ID);
  if (existing) {
    await existing.render({ force: true });
    existing.bringToFront();
    return;
  }
  const app = new PlayerCanvasWindow(ctx);
  // v14 forgets detached windows across reloads; re-detach (spec §2).
  const detached = app.savedWindowState().detached;
  await app.render({ force: true, ...(detached ? { window: { detached: true } } : {}) });
}
