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
  // Portability (spec §11.6). Lazy chunk: zip support stays out of the entry bundle.
  {
    name: 'canon.exportBackup',
    title: 'SILK.Commands.canon.exportBackup',
    available: (ctx) => ctx.isGM,
    run: async () => (await import('./portability')).runExportBackup(),
  },
  {
    name: 'canon.exportShare',
    title: 'SILK.Commands.canon.exportShare',
    available: (ctx) => ctx.isGM,
    run: async (args: { commit: string }) => (await import('./portability')).runExportShare(args),
  },
  {
    name: 'canon.import',
    title: 'SILK.Commands.canon.import',
    available: (ctx) => ctx.isGM,
    run: async (args: { file: Blob | ArrayBuffer | Uint8Array; asCopy?: boolean }) =>
      (await import('./portability')).runImport(args),
  },
];
