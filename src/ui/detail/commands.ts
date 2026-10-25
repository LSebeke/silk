/** `element.openDetail` (spec §8 Controls, §15). */
import type { Command } from '../../core/commands/registry';
import type { DetailContext } from './context';

export function detailUiCommands(getContext: () => DetailContext): Command[] {
  return [
    {
      name: 'element.openDetail',
      title: 'SILK.Commands.element.openDetail',
      available: (ctx) => ctx.isGM,
      async run({ id }: { id: string }) {
        const { ElementDetailWindow } = await import('./ElementDetailWindow');
        const existing = foundry.applications.instances.get(ElementDetailWindow.idFor(id));
        if (existing) {
          await existing.render({ force: true });
          existing.bringToFront();
          return;
        }
        await new ElementDetailWindow(getContext(), id).render({ force: true });
      },
    },
  ];
}
