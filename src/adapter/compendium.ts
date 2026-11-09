/**
 * Foundry side of the Compendium picker (spec 1.1 §B.2, §B.2.1): the World docs and packs of a
 * `PickerKind` as a `PickerCatalog`. Filtering by type and language is the core's.
 */
import type { PickerCatalog, PickerEntry, PickerKind } from '../core/canvas';
import { sceneBackground } from '../core/event-scenes/port';

interface IndexEntry {
  uuid: string;
  name: string;
  type?: string;
  img?: string | null;
  /** Scene: Foundry's thumbnail and its Levels' backgrounds (`sceneBackground`). */
  thumb?: string | null;
  levels?: Iterable<{ background?: { src?: string | null } | null }> | null;
  background?: { src?: string | null } | null;
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

interface DocumentKind {
  world(game: CatalogGame): Iterable<WorldDoc>;
  /** Index fields a pack is asked for. */
  fields: string[];
  entry(e: IndexEntry): PickerEntry;
}

const garnFlags = (d: WorldDoc) =>
  d.flags?.['garn'] as { id?: string; sceneOf?: string } | undefined;

/** Per picker document name: its World docs, index fields and entry shape. */
const KINDS: Record<PickerKind['documentName'], DocumentKind> = {
  Actor: {
    world: (game) => [...(game.actors ?? [])].filter((d) => !garnFlags(d)?.id),
    fields: ['type', 'img'],
    entry: (e) => ({
      uuid: e.uuid,
      name: e.name,
      ...(e.type ? { type: e.type } : {}),
      ...(e.img ? { img: e.img } : {}),
    }),
  },
  // §B.2.1: World Scenes not linked to an element; img = background, thumb = Foundry's.
  // v14: the background lives on the first Level (`sceneBackground`).
  Scene: {
    world: (game) =>
      [...(game.scenes ?? [])].filter((d) => !garnFlags(d)?.id && !garnFlags(d)?.sceneOf),
    // `background.src`: packs not yet migrated to v14 Levels.
    fields: ['thumb', 'levels.background.src', 'background.src'],
    entry: (e) => {
      const img = sceneBackground(e);
      return {
        uuid: e.uuid,
        name: e.name,
        ...(img ? { img } : {}),
        ...(e.thumb ? { thumb: e.thumb } : {}),
      };
    },
  },
};

/** `worldLabel`: the localised source label of World docs. */
export async function readPickerCatalog(
  game: CatalogGame,
  kind: PickerKind,
  worldLabel: string,
): Promise<PickerCatalog> {
  const docKind = KINDS[kind.documentName];
  const world = [...docKind.world(game)].map(docKind.entry);
  const kindPacks = [...(game.packs ?? [])].filter(
    (p) => p.documentName === kind.documentName && p.visible !== false,
  );
  const packs = await Promise.all(
    kindPacks.map(async (p) => {
      const lang = p.metadata.flags?.dsalang;
      const index = await p.getIndex({ fields: docKind.fields });
      const path = folders(p);
      const title = packageTitle(game, p);
      return {
        id: p.collection,
        label: p.metadata.label,
        ...(path ? { folders: path } : {}),
        ...(title ? { packageTitle: title } : {}),
        ...(lang ? { lang } : {}),
        entries: [...index].map(docKind.entry),
      };
    }),
  );
  return { kind, lang: game.i18n?.lang ?? 'en', worldLabel, world, packs };
}

/** The slice of Foundry a Scene thumbnail needs (`foundry.canvas`, `ImageHelper`). */
export interface ThumbnailHelper {
  /** The image's size; null if it cannot be loaded. */
  loadTexture(src: string): Promise<{ width: number; height: number } | null>;
  createThumbnail(
    src: string,
    options: { width: number; height: number; format: string; quality: number },
  ): Promise<{ thumb: string } | null>;
}

/** Longest side of a card thumbnail Garn makes (§B.2.1 Images). */
const THUMB_SIZE = 192;

/**
 * A Scene's card image when it has no `thumb` (§B.2.1): its background downsampled once to
 * a WebP data URL, longest side 192 px, quality 0.7. Undefined if the image cannot be loaded.
 */
export async function sceneThumbnail(
  src: string,
  helper: ThumbnailHelper = foundryThumbnails(),
): Promise<string | undefined> {
  const size = await helper.loadTexture(src);
  if (!size?.width || !size.height) return undefined;
  const scale = Math.min(1, THUMB_SIZE / Math.max(size.width, size.height));
  const result = await helper.createThumbnail(src, {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    format: 'image/webp',
    quality: 0.7,
  });
  return result?.thumb || undefined;
}

/** `ThumbnailHelper` over the running Foundry (globals read per call). */
function foundryThumbnails(): ThumbnailHelper {
  const api = foundry as unknown as {
    canvas: { loadTexture(src: string): Promise<{ width: number; height: number } | null> };
    helpers: { media: { ImageHelper: Pick<ThumbnailHelper, 'createThumbnail'> } };
  };
  return {
    loadTexture: (src) => api.canvas.loadTexture(src),
    createThumbnail: (src, options) => api.helpers.media.ImageHelper.createThumbnail(src, options),
  };
}
