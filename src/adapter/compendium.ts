/**
 * Foundry side of the Compendium picker (spec 1.1 §B.2): World actors and Actor packs as a
 * `PickerCatalog`. Filtering by type and language is the core's.
 */
import type { ActorType, PickerCatalog, PickerEntry } from '../core/canvas';

interface IndexEntry {
  uuid: string;
  name: string;
  type?: string;
  img?: string;
}

/** The slice of `game` the catalog reads. */
export interface CatalogGame {
  i18n?: { lang: string };
  actors?: Iterable<IndexEntry & { flags?: Record<string, unknown> }>;
  packs?: Iterable<{
    collection: string;
    documentName: string;
    visible?: boolean;
    metadata: { label: string; flags?: { dsalang?: string } };
    getIndex(options: { fields: string[] }): Promise<Iterable<IndexEntry>>;
  }>;
}

const entry = (e: IndexEntry): PickerEntry => ({
  uuid: e.uuid,
  name: e.name,
  type: e.type ?? '',
  ...(e.img ? { img: e.img } : {}),
});

/** `worldLabel`: the localised source label of World actors. */
export async function readPickerCatalog(
  game: CatalogGame,
  type: ActorType,
  worldLabel: string,
): Promise<PickerCatalog> {
  const world = [...(game.actors ?? [])]
    .filter((a) => !(a.flags?.['silk'] as { id?: string } | undefined)?.id)
    .map(entry);
  const actorPacks = [...(game.packs ?? [])].filter(
    (p) => p.documentName === 'Actor' && p.visible !== false,
  );
  const packs = await Promise.all(
    actorPacks.map(async (p) => {
      const lang = p.metadata.flags?.dsalang;
      const index = await p.getIndex({ fields: ['type', 'img'] });
      return {
        id: p.collection,
        label: p.metadata.label,
        ...(lang ? { lang } : {}),
        entries: [...index].map(entry),
      };
    }),
  );
  return { type, lang: game.i18n?.lang ?? 'en', worldLabel, world, packs };
}
