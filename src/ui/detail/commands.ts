/**
 * `element.openDetail` (spec §8 Controls, §15). With `addInfoBlock` (v1.1 §C.1, Node menu
 * "Add Info Block…") it first runs `infoBlock.create` and focuses the new block's name.
 * `connection.openDetail` (v1.1 §F.2), `element.openImageEditor` (v1.1 §G.3).
 */
import type { Command } from '../../core/commands/registry';
import { readConnection } from '../../core/connections';
import { hasAppearanceClass, readElement } from '../../core/elements';
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
        await ElementDetailWindow.open(
          ElementDetailWindow.idFor(id),
          () => new ElementDetailWindow(ctx, id),
          (window) => block && window.focusBlock(block),
        );
        return block ? { infoBlock: block } : undefined;
      },
    },
    {
      name: 'connection.openDetail',
      title: 'SILK.Commands.connection.openDetail',
      available: (ctx) => ctx.isGM,
      async run({ id }: { id: string }) {
        const ctx = getContext();
        if (!readConnection(ctx.workingCopy.get(id)))
          throw new Error(`Silk: no Connection "${id}"`);
        const { ConnectionDetailWindow } = await import('./ConnectionDetailWindow');
        await ConnectionDetailWindow.open(
          ConnectionDetailWindow.idFor(id),
          () => new ConnectionDetailWindow(ctx, id),
        );
      },
    },
    {
      // v1.1 §G.3: Silk's editor, not Foundry's TokenConfig (which would write over a hood).
      name: 'element.openImageEditor',
      title: 'SILK.Commands.element.openImageEditor',
      available: (ctx) => ctx.isGM,
      async run({ id }: { id: string }) {
        const ctx = getContext();
        const element = readElement(ctx.workingCopy.get(id));
        if (!element || !hasAppearanceClass(element.class))
          throw new Error(`Silk: "${id}" has no image & token editor`);
        const { ImageEditorWindow } = await import('./ImageEditorWindow');
        await ImageEditorWindow.open(
          ImageEditorWindow.idFor(id),
          () => new ImageEditorWindow(ctx, id),
        );
      },
    },
  ];
}
