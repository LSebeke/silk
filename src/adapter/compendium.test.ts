import { describe, expect, it } from 'vitest';
import { readPickerCatalog, sceneThumbnail, type CatalogGame } from './compendium';

function fakeGame(): CatalogGame & { indexed: object[] } {
  const indexed: object[] = [];
  const pack = (collection: string, documentName: string, label: string, dsalang?: string) => ({
    collection,
    documentName,
    visible: true,
    metadata: { label, ...(dsalang ? { flags: { dsalang } } : {}) },
    async getIndex(options: object) {
      indexed.push({ collection, ...options });
      return documentName === 'Scene'
        ? [
            {
              _id: 's',
              uuid: `Compendium.${collection}.Scene.s`,
              name: 'Gareth',
              thumb: 'gareth-thumb.webp',
              levels: [{ _id: 'l', background: { src: 'maps/gareth.webp' } }],
            },
            { _id: 't', uuid: `Compendium.${collection}.Scene.t`, name: 'Blank' },
          ]
        : [{ _id: 'a', uuid: `Compendium.${collection}.Actor.a`, name: 'Alrik', type: 'npc' }];
    },
  });
  return {
    indexed,
    i18n: { lang: 'de' },
    actors: [
      { uuid: 'Actor.ulf', name: 'Ulf', img: 'ulf.webp', type: 'npc', flags: {} },
      { uuid: 'Actor.el', name: 'Known', type: 'npc', flags: { silk: { id: 'e1' } } },
    ],
    scenes: [
      {
        uuid: 'Scene.punin',
        name: 'Punin',
        flags: {},
        thumb: null,
        background: { src: 'maps/punin.webp' },
      },
      { uuid: 'Scene.linked', name: 'Linked', flags: { silk: { id: 'e2' } } },
      { uuid: 'Scene.overview', name: 'Overview', flags: { silk: { sceneOf: 'e3' } } },
    ],
    packs: [
      pack('dsa5.npcs', 'Actor', 'NSC', 'de'),
      pack('dsa5-core.coremaps', 'Scene', 'Karten', 'de'),
      pack('dsa5.items', 'Item', 'Items'),
      { ...pack('world.secret', 'Actor', 'Secret'), visible: false },
    ],
  };
}

describe('readPickerCatalog', () => {
  it('World actors that are not Story Elements; visible Actor packs with their lang flag', async () => {
    const game = fakeGame();
    expect(await readPickerCatalog(game, { documentName: 'Actor', type: 'npc' }, 'Welt')).toEqual({
      kind: { documentName: 'Actor', type: 'npc' },
      lang: 'de',
      worldLabel: 'Welt',
      world: [{ uuid: 'Actor.ulf', name: 'Ulf', img: 'ulf.webp', type: 'npc' }],
      packs: [
        {
          id: 'dsa5.npcs',
          label: 'NSC',
          lang: 'de',
          entries: [{ uuid: 'Compendium.dsa5.npcs.Actor.a', name: 'Alrik', type: 'npc' }],
        },
      ],
    });
    // The index brings type and image along.
    expect(game.indexed).toEqual([{ collection: 'dsa5.npcs', fields: ['type', 'img'] }]);
  });

  it('a Scene kind reads World Scenes not linked to an element and Scene packs (§B.2.1)', async () => {
    const game = fakeGame();
    expect(await readPickerCatalog(game, { documentName: 'Scene' }, 'Welt')).toEqual({
      kind: { documentName: 'Scene' },
      lang: 'de',
      worldLabel: 'Welt',
      // img = background.src; thumb = Foundry's own thumbnail.
      world: [{ uuid: 'Scene.punin', name: 'Punin', img: 'maps/punin.webp' }],
      packs: [
        {
          id: 'dsa5-core.coremaps',
          label: 'Karten',
          lang: 'de',
          entries: [
            {
              uuid: 'Compendium.dsa5-core.coremaps.Scene.s',
              name: 'Gareth',
              img: 'maps/gareth.webp',
              thumb: 'gareth-thumb.webp',
            },
            { uuid: 'Compendium.dsa5-core.coremaps.Scene.t', name: 'Blank' },
          ],
        },
      ],
    });
    expect(game.indexed).toEqual([
      {
        collection: 'dsa5-core.coremaps',
        fields: ['thumb', 'levels.background.src', 'background.src'],
      },
    ]);
  });

  it('packs carry their folder ancestry (root first) and package title (§B.2 #88)', async () => {
    const folder = (name: string, ...ancestors: string[]) => ({
      name,
      ancestors: ancestors.map((n) => ({ name: n })),
    });
    const pack = (
      collection: string,
      packageType: string,
      packageName: string,
      f?: ReturnType<typeof folder>,
    ) => ({
      collection,
      documentName: 'Actor',
      folder: f ?? null,
      metadata: { label: collection, packageType, packageName },
      getIndex: async () => [],
    });
    const game: CatalogGame = {
      modules: new Map([['nightblack', { title: 'Nightblack' }]]),
      system: { title: 'Das Schwarze Auge' },
      world: { title: 'My World' },
      packs: [
        pack('nightblack.karten', 'module', 'nightblack', folder('Nightblack sea', 'Adventures')),
        pack('dsa5.npcs', 'system', 'dsa5'),
        pack('world.home', 'world', 'w'),
        pack('gone.pack', 'module', 'gone'),
      ],
    };
    const { packs } = await readPickerCatalog(game, { documentName: 'Actor' }, 'Welt');
    expect(packs.map(({ id, folders, packageTitle }) => ({ id, folders, packageTitle }))).toEqual([
      {
        id: 'nightblack.karten',
        folders: ['Adventures', 'Nightblack sea'],
        packageTitle: 'Nightblack',
      },
      { id: 'dsa5.npcs', folders: undefined, packageTitle: 'Das Schwarze Auge' },
      { id: 'world.home', folders: undefined, packageTitle: 'My World' },
      { id: 'gone.pack', folders: undefined, packageTitle: undefined },
    ]);
  });
});

describe('sceneThumbnail (§B.2.1 Images)', () => {
  const helper = (size: { width: number; height: number } | null) => {
    const calls: object[] = [];
    return {
      calls,
      loadTexture: async () => size,
      createThumbnail: async (src: string, options: object) => {
        calls.push({ src, ...options });
        return { thumb: 'data:image/webp;base64,AAA' };
      },
    };
  };

  it('a WebP data URL, longest side 192 px, quality 0.7, aspect kept', async () => {
    const wide = helper({ width: 4000, height: 2000 });
    expect(await sceneThumbnail('maps/a.webp', wide)).toBe('data:image/webp;base64,AAA');
    expect(wide.calls).toEqual([
      { src: 'maps/a.webp', width: 192, height: 96, format: 'image/webp', quality: 0.7 },
    ]);
    const tall = helper({ width: 1000, height: 3000 });
    await sceneThumbnail('maps/b.webp', tall);
    expect(tall.calls).toMatchObject([{ width: 64, height: 192 }]);
  });

  it('a small image is not upscaled; an unloadable one has no thumb', async () => {
    const small = helper({ width: 100, height: 50 });
    await sceneThumbnail('maps/c.webp', small);
    expect(small.calls).toMatchObject([{ width: 100, height: 50 }]);
    expect(await sceneThumbnail('maps/gone.webp', helper(null))).toBeUndefined();
  });
});
