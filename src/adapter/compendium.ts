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
  modules?: { get(id: string): { title: string } | undefined };
  system?: { title: string };
  world?: { title: string };
  packs?: Iterable<{
    collection: string;
    documentName: string;
    visible?: boolean;
    /** `game.folders.get(pack.config.folder)`; `ancestors` = [parent, grandparent, …]. */
    folder?: { name: string; ancestors?: { name: string }[] } | null;
    metadata: {
      label: string;
      packageType?: string;
      packageName?: string;
      flags?: { dsalang?: string };
    };
    getIndex(options: { fields: string[] }): Promise<Iterable<IndexEntry>>;
  }>;
}

type CatalogPack = NonNullable<CatalogGame['packs']> extends Iterable<infer P> ? P : never;

/** The pack's folder names, root first; undefined = no folder. */
const folders = ({ folder }: CatalogPack) =>
  folder
    ? [...(folder.ancestors ?? [])]
        .reverse()
        .map((f) => f.name)
        .concat(folder.name)
    : undefined;

/** Title of the module, system or world the pack comes from. */
function packageTitle(game: CatalogGame, { metadata }: CatalogPack): string | undefined {
  if (metadata.packageType === 'system') return game.system?.title;
  if (metadata.packageType === 'world') return game.world?.title;
  return metadata.packageName ? game.modules?.get(metadata.packageName)?.title : undefined;
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
      const path = folders(p);
      const title = packageTitle(game, p);
      return {
        id: p.collection,
        label: p.metadata.label,
        ...(path ? { folders: path } : {}),
        ...(title ? { packageTitle: title } : {}),
        ...(lang ? { lang } : {}),
        entries: [...index].map(entry),
      };
    }),
  );
  return { kind, lang: game.i18n?.lang ?? 'en', worldLabel, world, packs };
}
