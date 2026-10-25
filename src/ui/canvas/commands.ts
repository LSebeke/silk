/** UI canvas commands (spec §15, "Canvas"). Core canvas commands are in src/core/canvas. */
import type { Command } from '../../core/commands/registry';
import type { CanvasContext } from './context';

export function canvasUiCommands(getContext: () => CanvasContext): Command[] {
  return [
    {
      name: 'canvas.open',
      title: 'SILK.Commands.canvas.open',
      available: (ctx) => ctx.isGM,
      async run() {
        // Reveal/checkout may have changed the Revelation Map behind the Revealed filter.
        void getContext()
          .refreshRevealed()
          .catch(() => {});
        // Lazy chunk: the canvas UI is not part of the entry bundle.
        const { CanvasWindow } = await import('./CanvasWindow');
        const existing = foundry.applications.instances.get(CanvasWindow.ID);
        if (existing) {
          await existing.render({ force: true });
          existing.bringToFront();
          return;
        }
        const app = new CanvasWindow(getContext());
        // v14 forgets detached windows across reloads; re-detach (spec §2).
        const detached = app.savedWindowState().detached;
        await app.render({ force: true, ...(detached ? { window: { detached: true } } : {}) });
      },
    },
  ];
}
