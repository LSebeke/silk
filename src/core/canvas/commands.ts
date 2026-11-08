/** Canvas commands that live in the core (spec §15, "Canvas"). `canvas.open` is UI. */
import type { Command } from '../commands/registry';
import type { WorkingCopy } from '../working-copy';
import type { CanvasState } from './canvas-state';
import { deleteSelectionCommand } from './delete-selection';
import { applyMoves } from './groups';

export interface CanvasCommandDeps {
  workingCopy(): WorkingCopy;
  state: CanvasState;
  /** Registry runner: `canvas.deleteSelection` runs the delete commands. */
  run(name: string, args?: object): Promise<unknown>;
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
      const changed = applyMoves(wc.records(), moves, (id) => deps.state.nodeSize(id));
      if (changed.length) await wc.set(changed);
    },
  };

  /** `connections`: replaces the Connection selection; omitted, it stays. */
  const select: Command<{ ids: string[]; add?: boolean; connections?: string[] }, void> = {
    name: 'canvas.select',
    title: 'SILK.Commands.canvas.select',
    available: (ctx) => ctx.isGM,
    async run({ ids, add, connections }) {
      deps.state.select(ids, add);
      if (connections) deps.state.selectConnections(connections);
    },
  };

  return [moveNodes, select, deleteSelectionCommand(deps)];
}
