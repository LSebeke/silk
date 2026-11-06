import { describe, expect, it } from 'vitest';
import { readPickerCatalog, type CatalogGame } from './compendium';

function fakeGame(): CatalogGame & { indexed: object[] } {
  const indexed: object[] = [];
  const pack = (collection: string, documentName: string, label: string, dsalang?: string) => ({
    collection,
    documentName,
    visible: true,
    metadata: { label, ...(dsalang ? { flags: { dsalang } } : {}) },
    async getIndex(options: object) {
      indexed.push({ collection, ...options });
      return [{ _id: 'a', uuid: `Compendium.${collection}.Actor.a`, name: 'Alrik', type: 'npc' }];
    },
  });
  return {
    indexed,
    i18n: { lang: 'de' },
    actors: [
      { uuid: 'Actor.ulf', name: 'Ulf', img: 'ulf.webp', type: 'npc', flags: {} },
      { uuid: 'Actor.el', name: 'Known', type: 'npc', flags: { silk: { id: 'e1' } } },
    ],
    packs: [
      pack('dsa5.npcs', 'Actor', 'NSC', 'de'),
      pack('dsa5.items', 'Item', 'Items'),
      { ...pack('world.secret', 'Actor', 'Secret'), visible: false },
    ],
  };
}

describe('readPickerCatalog', () => {
  it('World actors that are not Story Elements; visible Actor packs with their lang flag', async () => {
    const game = fakeGame();
    expect(await readPickerCatalog(game, 'npc')).toEqual({
      type: 'npc',
      lang: 'de',
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
});
