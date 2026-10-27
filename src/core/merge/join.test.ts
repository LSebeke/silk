import { describe, expect, it } from 'vitest';
import { createMemoryFiles, openCanon, type CanonRecord } from '../canon';
import { createCampaigns, emptyRevelationMap, type RevelationMap } from '../campaigns';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { MERGE_DRAFT, createMerges } from './merges';

const el = (id: string, data: CanonRecord['data']): CanonRecord => ({ kind: 'element', id, data });
const gareth = el('el-gareth', {
  class: 'person',
  name: 'Gareth',
  position: { x: 0, y: 0 },
  infoBlocks: [{ _id: 'ib-secret', name: 'Secret', text: 'x' }],
});
const ulf = el('el-ulf', { class: 'person', name: 'Ulf', position: { x: 100, y: 0 } });
const knows: CanonRecord = {
  kind: 'connection',
  id: 'cn-knows',
  data: { from: 'el-gareth', to: 'el-ulf', type: 'free', direction: 'mutual', label: 'knows' },
};
const map = (m: Partial<RevelationMap>): RevelationMap => ({ ...emptyRevelationMap(), ...m });

/** A bound World on main (Gareth, Ulf, "knows") with Campaigns "Phileasson" (source) and "Borbarad" (target). */
async function setup() {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const files = createMemoryFiles();
  const history = createHistory({ files, workingCopy, author: () => 'GM', createdWith: 'test' });
  let n = 0;
  const applied: { map: RevelationMap; campaignId: string }[] = [];
  const campaigns = createCampaigns({
    history,
    workingCopy,
    applyRevelationMap: async (m, campaignId) => void applied.push({ map: m, campaignId }),
    newId: () => `id${++n}`,
  });
  const retagged: [string, string][] = [];
  const ownership: RevelationMap[] = [];
  const merges = createMerges({
    history,
    workingCopy,
    campaigns,
    author: () => 'GM',
    applyResult: (result) => workingCopy.replaceAll(result),
    retagPlayerNotes: async (from, to) => void retagged.push([from, to]),
    applyRevelationMap: async (m) => void ownership.push(m),
  });
  const { canonId } = await history.createCanon({ name: 'Aventurien' });
  await workingCopy.set([gareth, ulf, knows]);
  const head = await history.commit({ label: 'Init' });
  const source = await campaigns.create({ name: 'Phileasson' });
  const target = await campaigns.create({ name: 'Borbarad' });
  return {
    files,
    canonId,
    head,
    workingCopy,
    campaigns,
    merges,
    retagged,
    ownership,
    sourceId: source.id,
    targetId: target.id,
  };
}

describe('Join Campaigns (spec §11.5)', () => {
  it('reviews Target / Source / Result with no base column; the union is the default, source items carry "from <source>"', async () => {
    const t = await setup();
    await t.campaigns.writeRevelationMap(t.targetId, map({ elements: ['el-ulf'] }));
    await t.campaigns.writeRevelationMap(
      t.sourceId,
      map({ elements: ['el-gareth'], infoBlocks: ['ib-secret'], connections: ['cn-knows'] }),
    );

    const view = await t.merges.join({ sourceId: t.sourceId, targetId: t.targetId });

    expect(view.draft.kind).toBe('join');
    expect(view.title).toEqual({ adventure: 'Phileasson', campaign: 'Borbarad' });
    expect(view.columns).toEqual({
      base: '',
      ours: 'SILK.Merge.Target',
      theirs: 'SILK.Merge.Source',
    });
    expect(view.counts.open).toBe(0);
    const g = view.records.find((r) => r.id === 'el-gareth');
    expect(g?.badge).toBe('added');
    expect(g?.rows.map((r) => [r.field, r.ours, r.theirs, r.result, r.from])).toEqual([
      ['/infoBlocks/ib-secret', undefined, true, true, 'Phileasson'],
      ['/revealed', undefined, true, true, 'Phileasson'],
    ]);
    expect(g?.rows.every((r) => !r.conflict && !r.canonOnly)).toBe(true);
    const u = view.records.find((r) => r.id === 'el-ulf');
    expect(u?.rows.map((r) => [r.field, r.ours, r.theirs, r.result, r.from])).toEqual([
      ['/revealed', true, undefined, true, undefined],
    ]);
    expect(view.records.find((r) => r.id === 'cn-knows')?.rows).toHaveLength(1);
    expect(await t.merges.nextConflict()).toBeNull();
  });

  it('confirm writes the target map (no Commit), re-tags Player Notes and closes the source', async () => {
    const t = await setup();
    await t.campaigns.writeRevelationMap(t.targetId, map({ elements: ['el-ulf'] }));
    await t.campaigns.writeRevelationMap(
      t.sourceId,
      map({ elements: ['el-gareth'], playerNotes: ['pn-1'] }),
    );
    await t.merges.join({ sourceId: t.sourceId, targetId: t.targetId });

    await t.merges.confirm();

    expect(await t.campaigns.readRevelationMap(t.targetId)).toEqual(
      map({ elements: ['el-gareth', 'el-ulf'], playerNotes: ['pn-1'] }),
    );
    expect(t.retagged).toEqual([[t.sourceId, t.targetId]]);
    const campaigns = await t.campaigns.list();
    expect(campaigns.find((c) => c.id === t.sourceId)?.closed).toBe(true);
    expect(await (await openCanon(t.files, t.canonId)).getMain()).toBe(t.head);
    expect(t.workingCopy.meta(MERGE_DRAFT)).toBeUndefined();
    // Not on a target Adventure: other Worlds apply it at their next reconcile.
    expect(t.ownership).toEqual([]);
  });

  it('an override drops a source item from the result; closeSource: false keeps the source open', async () => {
    const t = await setup();
    await t.campaigns.writeRevelationMap(t.sourceId, map({ elements: ['el-gareth', 'el-ulf'] }));
    await t.merges.join({ sourceId: t.sourceId, targetId: t.targetId, closeSource: false });

    await t.merges.pick({ recordId: 'el-ulf', field: '/revealed', side: 'ours' });
    const view = await t.merges.view();
    const row = view?.records.find((r) => r.id === 'el-ulf')?.rows[0];
    expect(row?.result).toBeUndefined();
    await t.merges.confirm();

    expect((await t.campaigns.readRevelationMap(t.targetId)).elements).toEqual(['el-gareth']);
    expect((await t.campaigns.list()).find((c) => c.id === t.sourceId)?.closed).toBe(false);
  });

  it('a World on a target Adventure applies the ownership right away', async () => {
    const t = await setup();
    await t.campaigns.writeRevelationMap(t.sourceId, map({ elements: ['el-gareth'] }));
    await t.campaigns.startAdventure({ name: 'Ch. 1', campaignId: t.targetId });
    await t.merges.join({ sourceId: t.sourceId, targetId: t.targetId });
    await t.merges.confirm();
    expect(t.ownership).toEqual([map({ elements: ['el-gareth'] })]);
  });

  it('a closed Campaign cannot be the target; a Campaign cannot join itself', async () => {
    const t = await setup();
    await t.campaigns.close({ id: t.targetId });
    await expect(t.merges.join({ sourceId: t.sourceId, targetId: t.targetId })).rejects.toThrow(
      /closed/,
    );
    await expect(t.merges.join({ sourceId: t.sourceId, targetId: t.sourceId })).rejects.toThrow(
      /itself/,
    );
  });

  it('refuses while an Adventure merge is open', async () => {
    const t = await setup();
    await t.campaigns.startAdventure({ name: 'Ch. 1', campaignId: t.sourceId });
    await t.merges.endAdventure();
    await expect(t.merges.join({ sourceId: t.sourceId, targetId: t.targetId })).rejects.toThrow(
      /merge/,
    );
  });
});
