/**
 * `canvas.deleteSelection` (spec 1.1 §E.4, §D): `Del`/`Backspace` on the canvas selection.
 * Only Connections: deleted at once. With Nodes: the Node delete flow (`element.delete`, which
 * confirms) runs first; the selected Connections go only when it deleted something, so a
 * declined confirmation deletes nothing.
 */
import type { Command } from '../commands/registry';
import { readElement } from '../elements';
import type { CanvasCommandDeps } from './commands';

export function deleteSelectionCommand(deps: CanvasCommandDeps): Command {
  const command: Command<object, void> = {
    name: 'canvas.deleteSelection',
    title: 'GARN.Commands.canvas.deleteSelection',
    available: (ctx) => ctx.isGM,
    async run() {
      const { selection, connections } = deps.state.get();
      const wc = deps.workingCopy();
      // Visual Group frames are selectable Nodes, not elements.
      const elements = selection.filter((id) => readElement(wc.get(id)));
      if (elements.length) {
        const result = (await deps.run('element.delete', { ids: elements })) as { ids: string[] };
        if (!result.ids.length) return;
      }
      if (connections.length) await deps.run('connection.delete', { ids: [...connections] });
    },
  };
  return command as Command;
}
