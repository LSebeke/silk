/**
 * Load-time migration to Silk 1.1 (spec v1.1 §C.3): a Person/Creature Info Block named the
 * localised "Appearance" without the flag becomes the Appearance block
 * (`flags.silk.appearance`). Once per element: the migrated ids are World-only Working Copy
 * meta, so a block later named "Appearance" by hand stays a plain block.
 */
import type { JsonObject, JsonValue } from '../canon';
import { appearanceBlock, hasAppearanceClass, readElement } from '../elements';
import type { WorkingCopy } from '../working-copy';
import { blockJournal } from './layout';
import type { LifecycleContributor } from './lifecycle';
import type { Materializer } from './materializer';
import type { FoundryDocs } from './port';

/** Working Copy meta key: element ids already migrated. */
export const APPEARANCE_MIGRATED = 'appearanceMigrated';

export interface AppearanceMigrationDeps {
  workingCopy(): WorkingCopy;
  docs: Pick<FoundryDocs, 'updatePage'>;
  materializer: Pick<Materializer, 'docsOf' | 'sync'>;
  localize(key: string): string;
}

export function appearanceMigration(deps: AppearanceMigrationDeps): LifecycleContributor {
  return {
    async reconcile() {
      const wc = deps.workingCopy();
      const stored = wc.meta(APPEARANCE_MIGRATED);
      const done = new Set(Array.isArray(stored) ? stored.map(String) : []);
      const name = deps.localize('SILK.InfoBlock.Appearance');
      const before = done.size;
      for (const record of wc.records().values()) {
        const el = readElement(record);
        if (!el || done.has(el.id) || !hasAppearanceClass(el.class)) continue;
        done.add(el.id);
        if (appearanceBlock(el)) continue;
        const block = el.infoBlocks?.find((b) => b.name === name);
        if (!block) continue;
        if (!el.uuid) {
          const infoBlocks = (el.infoBlocks ?? []).map((b) =>
            b === block ? { ...b, appearance: true as const } : b,
          );
          const data = { ...record.data, infoBlocks } as unknown as JsonObject;
          await wc.set([{ ...record, data }]);
          continue;
        }
        const found = deps.materializer.docsOf(el.id);
        const holder = found && blockJournal(found.main, found.companion);
        if (!holder) continue;
        await deps.docs.updatePage(holder.uuid, block._id, { 'flags.silk.appearance': true });
        await deps.materializer.sync(el.id);
      }
      if (done.size !== before) await wc.setMeta(APPEARANCE_MIGRATED, [...done] as JsonValue);
    },
  };
}
