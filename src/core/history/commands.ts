/** Canon binding and history commands (spec §15, "History", "Campaigns / Canon"). */
import type { Command } from '../commands/registry';
import type { History } from './history';

/** `getHistory` throws until the adapter has wired the working copy (Foundry `ready`). */
export function historyCommands(getHistory: () => History): Command[] {
  return [
    {
      name: 'canon.create',
      title: 'SILK.Commands.canon.create',
      available: (ctx) => ctx.isGM,
      run: (args: { name: string }) => getHistory().createCanon(args),
    },
    {
      name: 'canon.bind',
      title: 'SILK.Commands.canon.bind',
      available: (ctx) => ctx.isGM,
      run: (args: { canonId: string }) => getHistory().bind(args),
    },
    {
      name: 'history.commit',
      title: 'SILK.Commands.history.commit',
      available: (ctx) => ctx.isGM,
      run: (args: { label?: string }) => getHistory().commit(args),
    },
    {
      name: 'history.discard',
      title: 'SILK.Commands.history.discard',
      available: (ctx) => ctx.isGM,
      run: () => getHistory().discard(),
    },
  ];
}
