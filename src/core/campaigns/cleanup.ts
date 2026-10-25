/**
 * element.delete removes the element's Revelation Map entries (spec §6, §11.5): the
 * element, its Info Blocks and its Connections, in every Campaign whose map is writable.
 * A closed Campaign's map is read-only; deleted ids there just drop out for readers.
 */
import type { LifecycleContributor } from '../materialize/lifecycle';
import type { Campaigns } from './campaigns';
import { pruneRevelationMap } from './revelation-map';

export function revelationMapCleanup(
  campaigns: () => Campaigns,
  /** The World is bound to a Canon. */
  bound: () => boolean,
): LifecycleContributor {
  return {
    async deleted({ element, connections }) {
      if (!bound()) return;
      const c = campaigns();
      const gone = new Set([
        element.id,
        ...(element.infoBlocks ?? []).map((b) => b._id),
        ...connections,
      ]);
      const current = (await c.checkedOutCampaign())?.id;
      for (const campaign of await c.list()) {
        if (campaign.closed && campaign.id !== current) continue;
        const map = await c.readRevelationMap(campaign.id);
        const pruned = pruneRevelationMap(map, (id) => !gone.has(id));
        if (JSON.stringify(pruned) !== JSON.stringify(map))
          await c.writeRevelationMap(campaign.id, pruned);
      }
    },
  };
}
