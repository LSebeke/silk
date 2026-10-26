/** Player Canvas commands (spec §9): a Node click opens its doc. `canvas.open` routes here. */
import type { Command } from '../../core/commands/registry';
import type { PlayerView, PlayerViewNode } from '../../core/player-view';

export function playerCanvasCommands(deps: {
  view(): PlayerView;
  openDoc(node: PlayerViewNode): Promise<void>;
}): Command[] {
  return [
    {
      name: 'playerCanvas.openDoc',
      title: 'SILK.Commands.playerCanvas.openDoc',
      available: () => true,
      async run({ id }: { id: string }) {
        const node = deps.view().nodes.find((n) => n.id === id);
        if (node) await deps.openDoc(node);
      },
    },
  ];
}
