import { describe, expect, it } from 'vitest';
import { createMemoryFiles, openCanon, type CanonRecord, type MemoryFiles } from '../canon';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCampaigns } from './campaigns';
import { emptyRevelationMap, setRevealed, type RevelationMap } from './revelation-map';

const gareth: CanonRecord = { kind: 'element', id: 'el-gareth', data: { name: 'Gareth' } };

/** A World bound to a fresh Canon, with one Commit on main. */
async function world(files: MemoryFiles = createMemoryFiles()) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const history = createHistory({ files, workingCopy, author: () => 'GM', createdWith: 'test' });
  const applied: { campaignId: string; map: RevelationMap }[] = [];
  let n = 0;
  const campaigns = createCampaigns({
    history,
    workingCopy,
    applyRevelationMap: async (map, campaignId) => void applied.push({ campaignId, map }),
    now: () => '2026-10-24T12:00:00.000Z',
    newId: () => `id${++n}`,
  });
  return { files, workingCopy, history, campaigns, applied };
}

async function boundWorld() {
  const w = await world();
  const { canonId } = await w.history.createCanon({ name: 'Aventurien' });
  await w.workingCopy.set([gareth]);
  const main = await w.history.commit({ label: 'Init' });
  return { ...w, canonId, main };
}

describe('campaigns', () => {
  it('create writes campaign.json, open, and lists it', async () => {
    const { campaigns, files, canonId } = await boundWorld();

    const created = await campaigns.create({ name: 'Phileasson' });

    expect(created).toEqual({
      id: 'id1',
      name: 'Phileasson',
      closed: false,
      createdAt: '2026-10-24T12:00:00.000Z',
    });
    expect(JSON.parse(files.contents.get(`${canonId}/campaigns/id1/campaign.json`) ?? '')).toEqual({
      ...created,
      formatVersion: 1,
    });
    expect(await campaigns.list()).toEqual([created]);
  });

  it('rename, close and reopen overwrite campaign.json in place', async () => {
    const { campaigns } = await boundWorld();
    const { id } = await campaigns.create({ name: 'A' });

    await campaigns.rename({ id, name: 'B' });
    await campaigns.close({ id });
    expect(await campaigns.list()).toMatchObject([{ id, name: 'B', closed: true }]);
    await campaigns.reopen({ id });
    expect(await campaigns.list()).toMatchObject([{ id, closed: false }]);
  });

  it('refuses blank names and unknown Campaigns', async () => {
    const { campaigns } = await boundWorld();
    await expect(campaigns.create({ name: '  ' })).rejects.toThrow(/name/);
    await expect(campaigns.rename({ id: 'nope', name: 'x' })).rejects.toThrow(/no Campaign/);
  });

  it('needs a bound World', async () => {
    const { campaigns } = await world();
    await expect(campaigns.create({ name: 'A' })).rejects.toThrow(/not bound/);
  });

  it('stores the Revelation Map per Campaign; a closed map is read-only', async () => {
    const { campaigns, files, canonId } = await boundWorld();
    const { id } = await campaigns.create({ name: 'A' });
    expect(await campaigns.readRevelationMap(id)).toEqual(emptyRevelationMap());

    const map = setRevealed(emptyRevelationMap(), 'element', gareth.id, true);
    await campaigns.writeRevelationMap(id, map);

    expect(await campaigns.readRevelationMap(id)).toEqual(map);
    expect(
      JSON.parse(files.contents.get(`${canonId}/campaigns/${id}/revelation-map.json`) ?? ''),
    ).toMatchObject({ formatVersion: 1, elements: [gareth.id] });

    await campaigns.close({ id });
    await expect(campaigns.writeRevelationMap(id, emptyRevelationMap())).rejects.toThrow(/closed/);
  });
});

describe('adventure.start', () => {
  it('branches from clean main, checks out the Adventure and applies its Revelation Map', async () => {
    const { campaigns, workingCopy, files, canonId, main, applied } = await boundWorld();
    const { id: campaignId } = await campaigns.create({ name: 'Phileasson' });
    const map = setRevealed(emptyRevelationMap(), 'element', gareth.id, true);
    await campaigns.writeRevelationMap(campaignId, map);

    const { adventureId } = await campaigns.startAdventure({ name: 'Ch. 1', campaignId });

    expect(await (await openCanon(files, canonId)).getAdventure(adventureId)).toEqual({
      id: adventureId,
      name: 'Ch. 1',
      campaignId,
      base: main,
      head: main,
    });
    expect(workingCopy.binding).toEqual({
      canonId,
      checkout: { adventure: adventureId },
      head: main,
    });
    expect(applied).toEqual([{ campaignId, map }]);
    expect((await campaigns.checkedOutCampaign())?.id).toBe(campaignId);
  });

  it('commits under the Adventure then land on the Adventure ref', async () => {
    const { campaigns, history, workingCopy, files, canonId, main } = await boundWorld();
    const { id: campaignId } = await campaigns.create({ name: 'C' });
    const { adventureId } = await campaigns.startAdventure({ name: 'A', campaignId });
    await workingCopy.set([{ ...gareth, data: { name: 'Gareth (dead)' } }]);
    const head = await history.commit({ label: 'Session 1' });

    const canon = await openCanon(files, canonId);
    expect(await canon.getMain()).toBe(main);
    expect((await canon.getAdventure(adventureId))?.head).toBe(head);
  });

  it('refuses a dirty main, a closed or unknown Campaign, a blank name and a running Adventure', async () => {
    const { campaigns, workingCopy } = await boundWorld();
    const { id: open } = await campaigns.create({ name: 'Open' });
    const { id: closed } = await campaigns.create({ name: 'Closed' });
    await campaigns.close({ id: closed });

    await expect(campaigns.startAdventure({ name: 'X', campaignId: closed })).rejects.toThrow(
      /closed/,
    );
    await expect(campaigns.startAdventure({ name: 'X', campaignId: 'nope' })).rejects.toThrow(
      /no Campaign/,
    );
    await expect(campaigns.startAdventure({ name: ' ', campaignId: open })).rejects.toThrow(/name/);

    await workingCopy.set([{ kind: 'element', id: 'el-new', data: {} }]);
    await expect(campaigns.startAdventure({ name: 'X', campaignId: open })).rejects.toThrow(
      /uncommitted/,
    );
    await workingCopy.delete(['el-new']);

    await campaigns.startAdventure({ name: 'X', campaignId: open });
    await expect(campaigns.startAdventure({ name: 'Y', campaignId: open })).rejects.toThrow(/main/);
  });

  it('refuses when main has no Commit yet or moved on in another World', async () => {
    const fresh = await world();
    await fresh.history.createCanon({ name: 'A' });
    const { id } = await fresh.campaigns.create({ name: 'C' });
    await expect(fresh.campaigns.startAdventure({ name: 'X', campaignId: id })).rejects.toThrow(
      /Commit/,
    );

    const first = await boundWorld();
    const second = await world(first.files);
    await second.history.bind({ canonId: first.canonId });
    await second.workingCopy.set([{ kind: 'element', id: 'el-x', data: {} }]);
    await second.history.commit({});
    const { id: c } = await first.campaigns.create({ name: 'C' });
    await expect(first.campaigns.startAdventure({ name: 'X', campaignId: c })).rejects.toThrow(
      /moved/,
    );
  });
});

describe('overview', () => {
  it('summarises Canon, Checkout, Adventures, Campaigns and the commit history', async () => {
    const { campaigns, canonId, main } = await world().then(async (w) => {
      const { canonId } = await w.history.createCanon({ name: 'Aventurien' });
      await w.workingCopy.set([gareth]);
      const main = await w.history.commit({ label: 'Init' });
      return { ...w, canonId, main };
    });
    expect(await campaigns.overview()).toEqual({
      canon: { id: canonId, name: 'Aventurien', readOnly: false },
      checkout: { kind: 'main' },
      dirty: false,
      adventures: [],
      campaigns: [],
      log: [{ hash: main, label: 'Init', date: expect.any(String) }],
    });

    const { id: campaignId } = await campaigns.create({ name: 'Phileasson' });
    const { adventureId } = await campaigns.startAdventure({ name: 'Ch. 1', campaignId });
    const overview = await campaigns.overview();
    expect(overview.checkout).toEqual({
      kind: 'adventure',
      id: adventureId,
      name: 'Ch. 1',
      campaignId,
      campaignName: 'Phileasson',
    });
    expect(overview.adventures).toEqual([
      { id: adventureId, name: 'Ch. 1', campaignId, campaignName: 'Phileasson', current: true },
    ]);
  });

  it('is empty for an unbound World', async () => {
    const { campaigns } = await world();
    expect(await campaigns.overview()).toEqual({
      canon: null,
      checkout: null,
      dirty: false,
      adventures: [],
      campaigns: [],
      log: [],
    });
  });
});
