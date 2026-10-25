/** End Adventure and merge commands (spec §15, "Adventures / merge"). */
import type { Command } from '../commands/registry';
import type { Pick } from '../canon';
import type { FieldRef, Merges } from './merges';

/** What the commands need from the merge window (UI: lazy chunk + DialogV2). */
export interface MergeUi {
  /** Open (or refresh) the merge window. */
  open(): Promise<void>;
  close(): Promise<void>;
  /** "Merge into the Canon? There is no undo." */
  confirmNoUndo(): Promise<boolean>;
  /** Show this conflict (select its Node, open the drawer). */
  focus(ref: FieldRef): Promise<void>;
}

/** `getMerges` throws until the adapter has wired the session (Foundry `ready`). */
export function mergeCommands(getMerges: () => Merges, ui: MergeUi): Command[] {
  const gm = (ctx: { isGM: boolean }) => ctx.isGM;
  return [
    {
      name: 'adventure.end',
      title: 'SILK.Commands.adventure.end',
      available: gm,
      async run() {
        await getMerges().endAdventure();
        await ui.open();
      },
    },
    {
      // ⏎ is handled inside the merge window (a global Enter keybinding would be wrong).
      name: 'merge.nextConflict',
      title: 'SILK.Commands.merge.nextConflict',
      available: gm,
      async run() {
        const next = await getMerges().nextConflict();
        if (next) await ui.focus(next);
        return next;
      },
    },
    {
      name: 'merge.pick',
      title: 'SILK.Commands.merge.pick',
      available: gm,
      run: (args: Pick) => getMerges().pick(args),
    },
    {
      name: 'merge.confirm',
      title: 'SILK.Commands.merge.confirm',
      available: gm,
      async run(args: { confirmed?: boolean } = {}) {
        if (!args.confirmed && !(await ui.confirmNoUndo())) return { confirmed: false };
        const { commit } = await getMerges().confirm();
        await ui.close();
        return { confirmed: true, commit };
      },
    },
    {
      name: 'merge.cancel',
      title: 'SILK.Commands.merge.cancel',
      available: gm,
      async run() {
        await getMerges().cancel();
        await ui.close();
      },
    },
  ];
}
