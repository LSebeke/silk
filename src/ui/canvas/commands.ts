/** Canvas commands (spec §15, "Canvas"). */
import type { Command } from '../../core/commands/registry';

export const canvasCommands: Command[] = [
  {
    name: 'canvas.open',
    title: 'SILK.Commands.canvas.open',
    available: (ctx) => ctx.isGM,
    async run() {
      // Lazy chunk: the canvas UI is not part of the entry bundle.
      const { CanvasWindow } = await import('./CanvasWindow');
      const existing = foundry.applications.instances.get('silk-canvas');
      await (existing ?? new CanvasWindow()).render({ force: true });
    },
  },
];
