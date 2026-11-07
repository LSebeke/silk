/** What every detail window component shares: live records and commands that report errors. */
import { onDestroy } from 'svelte';
import type { Snapshot } from '../../core/canon';
import type { DetailContext } from './context';

/** The working copy's records, reactive. Call during component init. */
export function liveRecords(ctx: DetailContext): { readonly current: Snapshot } {
  let records = $state.raw<Snapshot>(ctx.workingCopy.records());
  // The working copy hands out the same (mutated) Map: copy it so `$state.raw` sees a change.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- an immutable snapshot copy
  onDestroy(ctx.workingCopy.subscribe((r) => (records = new Map(r))));
  return {
    get current() {
      return records;
    },
  };
}

/** Runs a command; a failure becomes a notification. */
export const runner =
  (ctx: DetailContext) =>
  async (name: string, args: object): Promise<void> => {
    try {
      await ctx.run(name, args);
    } catch (error) {
      ctx.error(error instanceof Error ? error.message : String(error));
    }
  };
