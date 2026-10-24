/** Canvas commands that live in the core (spec §15, "Canvas"). `canvas.open` is UI. */
import type { CanonRecord } from '../canon';
import type { Command } from '../commands/registry';
import type { WorkingCopy } from '../working-copy';
import type { CanvasState } from './canvas-state';

export interface CanvasCommandDeps {
  workingCopy(): WorkingCopy;
  state: CanvasState;
}

export interface NodeMove {
  id: string;
  x: number;
  y: number;
}

export function canvasCoreCommands(deps: CanvasCommandDeps): Command[] {
  const moveNodes: Command<{ moves: NodeMove[] }, void> = {
    name: 'canvas.moveNodes',
    title: 'SILK.Commands.canvas.moveNodes',
    available: (ctx) => ctx.isGM,
    async run({ moves }) {
      const wc = deps.workingCopy();
      const changed: CanonRecord[] = [];
      for (const { id, x, y } of moves) {
        const record = wc.get(id);
        // Visual Groups (T26) are layout records too; they extend this switch.
        if (record?.kind !== 'element') continue;
        const position = record.data['position'] as { x: number; y: number } | undefined;
        if (position?.x === x && position.y === y) continue;
        changed.push({ ...record, data: { ...record.data, position: { x, y } } });
      }
      if (changed.length) await wc.set(changed);
    },
  };

  const select: Command<{ ids: string[]; add?: boolean }, void> = {
    name: 'canvas.select',
    title: 'SILK.Commands.canvas.select',
    available: (ctx) => ctx.isGM,
    async run({ ids, add }) {
      deps.state.select(ids, add);
    },
  };

  return [moveNodes, select];
}
