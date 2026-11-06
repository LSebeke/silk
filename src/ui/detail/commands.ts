/**
 * `element.openDetail` (spec §8 Controls, §15). With `addInfoBlock` (v1.1 §C.1, Node menu
 * "Add Info Block…") it first runs `infoBlock.create` and focuses the new block's name.
 */
import type { Command } from '../../core/commands/registry';
import type { DetailContext } from './context';

export function detailUiCommands(getContext: () => DetailContext): Command[] {
  return [
    {
      name: 'element.openDetail',
      title: 'SILK.Commands.element.openDetail',
      available: (ctx) => ctx.isGM,
      async run({ id, addInfoBlock }: { id: string; addInfoBlock?: boolean }) {
        const ctx = getContext();
        const block = addInfoBlock
          ? ((await ctx.run('infoBlock.create', { elementId: id })) as { id: string }).id
          : undefined;
        const { ElementDetailWindow } = await import('./ElementDetailWindow');
        const existing = foundry.applications.instances.get(ElementDetailWindow.idFor(id)) as
          InstanceType<typeof ElementDetailWindow> | undefined;
        const window = existing ?? new ElementDetailWindow(ctx, id);
        if (block) window.focusBlock(block);
        await window.render({ force: true });
        if (existing) existing.bringToFront();
        return block ? { infoBlock: block } : undefined;
      },
    },
  ];
}
