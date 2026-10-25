import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../canon';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCampaigns } from './campaigns';
import { revelationMapCleanup } from './cleanup';
import { emptyRevelationMap, setRevealed, type RevelationMap } from './revelation-map';

const reveal = (ids: Partial<Record<'element' | 'infoBlock' | 'connection', string[]>>) => {
  let map: RevelationMap = emptyRevelationMap();
  for (const [kind, list] of Object.entries(ids))
    for (const id of list) map = setRevealed(map, kind as 'element', id, true);
  return map;
};

describe('Revelation Map cleanup on element delete (spec §6)', () => {
  it('drops the element, its Info Blocks and Connections from every writable map', async () => {
    const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    const history = createHistory({
      files: createMemoryFiles(),
      workingCopy,
      author: () => 'GM',
      createdWith: 'test',
    });
    const campaigns = createCampaigns({
      history,
      workingCopy,
      applyRevelationMap: async () => {},
    });
    const cleanup = revelationMapCleanup(
      () => campaigns,
      () => !!workingCopy.binding,
    );
    // Unbound World: nothing to clean, no error.
    await cleanup.deleted?.({
      element: { id: 'el', class: 'note', name: 'N', position: { x: 0, y: 0 } },
      connections: [],
      keepFoundryDoc: false,
    });

    await history.createCanon({ name: 'C' });
    const open = await campaigns.create({ name: 'Open' });
    const closed = await campaigns.create({ name: 'Closed' });
    const full = reveal({ element: ['el', 'other'], infoBlock: ['b1', 'b2'], connection: ['c1'] });
    await campaigns.writeRevelationMap(open.id, full);
    await campaigns.writeRevelationMap(closed.id, full);
    await campaigns.close({ id: closed.id });

    await cleanup.deleted?.({
      element: {
        id: 'el',
        class: 'note',
        name: 'N',
        position: { x: 0, y: 0 },
        infoBlocks: [{ _id: 'b1', name: 'B', text: '' }],
      },
      connections: ['c1'],
      keepFoundryDoc: false,
    });

    expect(await campaigns.readRevelationMap(open.id)).toEqual(
      reveal({ element: ['other'], infoBlock: ['b2'] }),
    );
    // A closed Campaign's map is read-only: its stale ids are ignored by readers.
    expect(await campaigns.readRevelationMap(closed.id)).toEqual(full);
  });
});
