/**
 * Foundry side of owns ↔ inventory (spec §7 owns): Item copies, moves and deletions reach
 * the core as snapshots. Hooks fire on every client; only the active GM reacts, and
 * Silk's own writes (tagged `SILK_WRITE`) are skipped.
 */
import type { Owns } from '../core/owns';
import { snapshot, type FoundryDoc } from './foundry-docs';
import { isSilkWrite } from './working-copy-journal';

export function registerOwnsHooks(
  owns: Pick<Owns, 'itemCreated' | 'itemDeleted' | 'actorCreated'>,
  deps: {
    on(hook: string, fn: (...args: unknown[]) => void): void;
    isActiveGM(): boolean;
  },
): void {
  const react =
    (handler: (doc: NonNullable<ReturnType<typeof snapshot>>) => Promise<void>) =>
    (doc: unknown, options: unknown) => {
      if (!deps.isActiveGM() || isSilkWrite(options)) return;
      const snap = snapshot(doc as FoundryDoc);
      if (snap) handler(snap).catch((error: unknown) => console.error(error));
    };
  deps.on(
    'createItem',
    react((doc) => owns.itemCreated(doc)),
  );
  deps.on(
    'deleteItem',
    react((doc) => owns.itemDeleted(doc)),
  );
  deps.on(
    'createActor',
    react((doc) => owns.actorCreated(doc)),
  );
}
