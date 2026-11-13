/**
 * Load-time migration of round 2 looks (spec v1.1 §G.3.2): on the first GM load, one sweep
 * over every Garn-managed actor builds the subject files and puts the texture scale back
 * (`round2Writes`). Done once per World (`done` / `markDone`, a world setting): later loads
 * never check again, and no other write migrates on its own. An actor that failed keeps the
 * sweep pending for the next load. Imported actors without a Garn look are left alone.
 */
import { readElement } from '../elements';
import { lookSource, round2Writes, type LookWriter, type PortraitDoc } from '../portrait';
import type { WorkingCopy } from '../working-copy';
import { documentName } from './layout';
import type { LifecycleContributor } from './lifecycle';
import type { Materializer } from './materializer';
import type { SystemMapping } from './port';

export interface LookMigrationDeps {
  workingCopy(): WorkingCopy;
  materializer: Pick<Materializer, 'docsOf'>;
  system: Pick<SystemMapping, 'sizeFactor'>;
  writeLook: LookWriter;
  /** The sweep already ran in this World. */
  done(): boolean;
  markDone(): Promise<void>;
}

export function lookMigration(deps: LookMigrationDeps): LifecycleContributor {
  return {
    async reconcile() {
      if (deps.done()) return;
      let failed = false;
      for (const record of deps.workingCopy().records().values()) {
        const el = readElement(record);
        if (!el?.uuid || documentName(el.class) !== 'Actor') continue;
        const main = deps.materializer.docsOf(el.id)?.main;
        if (!main) continue;
        const writes = round2Writes(lookSource(main as PortraitDoc, deps.system, el.img));
        if (!writes) continue;
        // One actor's file (an image gone, an upload refused) must not stop the load.
        try {
          await deps.writeLook(main.uuid, main as PortraitDoc, writes);
        } catch (error) {
          failed = true;
          console.error(`Garn: round 2 look of ${main.uuid} not migrated`, error);
        }
      }
      // A failure is tried again on the next load; the migrated looks are no longer round 2's.
      if (!failed) await deps.markDone();
    },
  };
}
