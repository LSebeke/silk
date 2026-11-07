/**
 * Foundry side of the Compendium picker (spec 1.1 §B.2, §B.2.1): the World docs and packs of a
 * `PickerKind` as a `PickerCatalog`. Filtering by type and language is the core's.
 */
import type { PickerCatalog, PickerEntry, PickerKind } from '../core/canvas';

interface IndexEntry {
  uuid: string;
  name: string;
  type?: string;
  img?: string;
}

type WorldDoc = IndexEntry & { flags?: Record<string, unknown> };

/** The slice of `game` the catalog reads. */
export interface CatalogGame {
  i18n?: { lang: string };
  actors?: Iterable<WorldDoc>;
  scenes?: Iterable<WorldDoc>;
  packs?: Iterable<{
    collection: string;
    documentName: string;
    visible?: boolean;
    metadata: { label: string; flags?: { dsalang?: string } };
    getIndex(options: { fields: string[] }): Promise<Iterable<IndexEntry>>;
  }>;
}

/** The World collection of each picker document name. */
const WORLD: Record<PickerKind['documentName'], (game: CatalogGame) => Iterable<WorldDoc>> = {
  Actor: (game) => game.actors ?? [],
  Scene: (game) => game.scenes ?? [],
};

const entry = (e: IndexEntry): PickerEntry => ({
  uuid: e.uuid,
  name: e.name,
  ...(e.type ? { type: e.type } : {}),
  ...(e.img ? { img: e.img } : {}),
});

/** `worldLabel`: the localised source label of World docs. */
export async function readPickerCatalog(
  game: CatalogGame,
  kind: PickerKind,
  worldLabel: string,
): Promise<PickerCatalog> {
  const world = [...WORLD[kind.documentName](game)]
    .filter((d) => !(d.flags?.['silk'] as { id?: string } | undefined)?.id)
    .map(entry);
  const kindPacks = [...(game.packs ?? [])].filter(
    (p) => p.documentName === kind.documentName && p.visible !== false,
  );
  const packs = await Promise.all(
    kindPacks.map(async (p) => {
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
  return { kind, lang: game.i18n?.lang ?? 'en', worldLabel, world, packs };
}
