/** Canvas commands that live in the core (spec §15, "Canvas"). `canvas.open` is UI. */
import type { Command } from '../commands/registry';
import type { WorkingCopy } from '../working-copy';
import type { CanvasState } from './canvas-state';
import { applyMoves } from './groups';

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
      // Elements and Visual Groups: frames carry their contents, Nodes join frames (§10.4).
      const changed = applyMoves(wc.records(), moves);
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
