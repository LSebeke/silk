/** Canon window command (spec §15, "Campaigns / Canon"). */
import type { Command } from '../../core/commands/registry';

export const canonCommands: Command[] = [
  {
    name: 'canon.openWindow',
    title: 'SILK.Commands.canon.openWindow',
    available: (ctx) => ctx.isGM,
    async run() {
      // Lazy chunk: not part of the entry bundle.
      const { CanonWindow } = await import('./CanonWindow');
      const existing = foundry.applications.instances.get('silk-canon');
      await (existing ?? new CanonWindow()).render({ force: true });
    },
  },
];
