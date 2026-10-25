import { describe, expect, it } from 'vitest';
import {
  createMemoryFiles,
  openCanon,
  type CanonRecord,
  type MemoryFiles,
  type Snapshot,
} from '../canon';
import { createCampaigns } from '../campaigns';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { MERGE_DRAFT, createMerges } from './merges';

const el = (id: string, data: CanonRecord['data']): CanonRecord => ({ kind: 'element', id, data });
const gareth = el('el-gareth', { class: 'person', name: 'Gareth', position: { x: 0, y: 0 } });
const ulf = el('el-ulf', { class: 'person', name: 'Ulf', position: { x: 100, y: 0 } });
const knows: CanonRecord = {
  kind: 'connection',
  id: 'cn-knows',
  data: { from: 'el-gareth', to: 'el-ulf', type: 'free', direction: 'mutual', label: 'knows' },
};

/** A World over `files`; `applied` records every result handed to the doc rewrite. */
function world(files: MemoryFiles, author = 'GM') {
  const backend = createMemoryBackend();
  const workingCopy = createWorkingCopy(backend, { canWrite: () => true });
  const history = createHistory({ files, workingCopy, author: () => author, createdWith: 'test' });
  let n = 0;
  const campaigns = createCampaigns({
    history,
    workingCopy,
    applyRevelationMap: async () => {},
    now: () => '2026-10-24T12:00:00.000Z',
    newId: () => `id${++n}`,
  });
  const applied: Snapshot[] = [];
  const merges = createMerges({
    history,
    workingCopy,
    campaigns,
    author: () => author,
    now: () => '2026-10-25T12:00:00.000Z',
    applyResult: async (result) => {
      applied.push(result);
      await workingCopy.replaceAll(result);
    },
  });
  return { files, backend, workingCopy, history, campaigns, merges, applied };
}

/** Main has Gareth, Ulf and "knows"; an Adventure "Ch. 1" (Campaign "Phileasson") is checked out. */
async function onAdventure() {
  const files = createMemoryFiles();
  const w = world(files);
  const { canonId } = await w.history.createCanon({ name: 'Aventurien' });
  await w.workingCopy.set([gareth, ulf, knows]);
  const base = await w.history.commit({ label: 'Init' });
  const { id: campaignId } = await w.campaigns.create({ name: 'Phileasson' });
  const { adventureId } = await w.campaigns.startAdventure({ name: 'Ch. 1', campaignId });
  return { ...w, canonId, base, campaignId, adventureId };
}

/** Another World edits main (Canon edit mode) and commits. */
async function canonEdit(
  files: MemoryFiles,
  canonId: string,
  edit: (records: Snapshot) => CanonRecord[],
) {
  const other = world(files, 'Other GM');
  await other.history.bind({ canonId });
  await other.workingCopy.set(edit(other.workingCopy.records()));
  return other.history.commit({ label: 'Canon edit' });
}

const rename = (record: CanonRecord, name: string) => ({
  ...record,
  data: { ...record.data, name },
});

describe('End Adventure (spec §11.3)', () => {
  it('commits, merges into main as one Commit, rewrites to the result and checks out main', async () => {
    const w = await onAdventure();
    await w.workingCopy.set([rename(gareth, 'Gareth (dead)')]);
    const canonHead = await canonEdit(w.files, w.canonId, () => [rename(ulf, 'Ulf the Bold')]);

    const view = await w.merges.endAdventure();
    expect(view.counts.open).toBe(0);
    const { commit } = await w.merges.confirm();

    const canon = await openCanon(w.files, w.canonId);
    expect(await canon.getMain()).toBe(commit);
    const merged = await canon.readCommit(commit);
    expect(merged.label).toBe('Merge Ch. 1 (Phileasson)');
    const adventureHead = (await canon.getAdventure(w.adventureId))?.head;
    expect(merged.parents).toEqual([canonHead, adventureHead]);
    expect((await canon.readCommit(adventureHead ?? '')).label).toBe('Before merge');
    const result = await canon.readSnapshot(commit);
    expect(result.get('el-gareth')?.data.name).toBe('Gareth (dead)');
    expect(result.get('el-ulf')?.data.name).toBe('Ulf the Bold');
    expect(result.get('cn-knows')).toEqual(knows);

    expect(w.applied).toHaveLength(1);
    expect(w.workingCopy.get('el-ulf')?.data.name).toBe('Ulf the Bold');
    expect(w.workingCopy.binding).toEqual({
      canonId: w.canonId,
      checkout: { main: true },
      head: commit,
    });
    expect(w.workingCopy.meta(MERGE_DRAFT)).toBeUndefined();
    expect(await w.history.isDirty()).toBe(false);
  });

  it('refuses when no Adventure is checked out', async () => {
    const files = createMemoryFiles();
    const w = world(files);
    await w.history.createCanon({ name: 'A' });
    await expect(w.merges.endAdventure()).rejects.toThrow(/Adventure/);
  });
});

describe('merge session (spec §11.4)', () => {
  /** Both sides renamed Gareth; the Canon also relabelled "knows", the Adventure too. */
  async function conflicted() {
    const w = await onAdventure();
    await w.workingCopy.set([
      rename(gareth, 'Gareth (Adventure)'),
      { ...knows, data: { ...knows.data, label: 'owes money to' } },
    ]);
    await canonEdit(w.files, w.canonId, () => [
      rename(gareth, 'Gareth (Canon)'),
      { ...knows, data: { ...knows.data, label: 'hates' } },
    ]);
    return w;
  }

  it('lists conflicts with badges and counts; confirm refuses while any is open', async () => {
    const w = await conflicted();
    const view = await w.merges.endAdventure();

    expect(view.title).toEqual({ adventure: 'Ch. 1', campaign: 'Phileasson' });
    expect(view.counts).toMatchObject({ conflicts: 2, open: 2 });
    const garethView = view.records.find((r) => r.id === 'el-gareth');
    expect(garethView).toMatchObject({ badge: 'conflict', open: 1 });
    expect(garethView?.fields).toEqual([
      expect.objectContaining({
        field: '/name',
        base: 'Gareth',
        ours: 'Gareth (Canon)',
        theirs: 'Gareth (Adventure)',
        open: true,
        text: false,
      }),
    ]);
    expect(view.records.find((r) => r.id === 'cn-knows')?.fields[0]).toMatchObject({
      field: '/label',
      text: true,
    });
    expect(view.records.find((r) => r.id === 'el-ulf')?.badge).toBe('same');
    await expect(w.merges.confirm()).rejects.toThrow(/2 conflict/);
  });

  it('nextConflict walks the open conflicts and wraps; picks resolve them; confirm uses them', async () => {
    const w = await conflicted();
    await w.merges.endAdventure();

    expect(await w.merges.nextConflict()).toEqual({ recordId: 'cn-knows', field: '/label' });
    expect(await w.merges.nextConflict()).toEqual({ recordId: 'el-gareth', field: '/name' });
    expect(await w.merges.nextConflict()).toEqual({ recordId: 'cn-knows', field: '/label' });

    await w.merges.pick({ recordId: 'el-gareth', field: '/name', side: 'ours' });
    expect(await w.merges.nextConflict()).toEqual({ recordId: 'cn-knows', field: '/label' });
    // Write combined text.
    await w.merges.pick({ recordId: 'cn-knows', field: '/label', value: 'hates; owes money to' });
    expect(await w.merges.nextConflict()).toBeNull();
    const view = await w.merges.view();
    expect(view?.counts.open).toBe(0);
    expect(view?.records.find((r) => r.id === 'el-gareth')?.fields[0]).toMatchObject({
      result: 'Gareth (Canon)',
      open: false,
      pick: { side: 'ours' },
    });

    const { commit } = await w.merges.confirm();
    const result = await (await openCanon(w.files, w.canonId)).readSnapshot(commit);
    expect(result.get('el-gareth')?.data.name).toBe('Gareth (Canon)');
    expect(result.get('cn-knows')?.data.label).toBe('hates; owes money to');
  });

  it('a later pick of the same field replaces the earlier one; auto-merges can be overridden', async () => {
    const w = await onAdventure();
    await w.workingCopy.set([rename(ulf, 'Ulf (Adventure)')]);
    await w.merges.endAdventure();
    await w.merges.pick({ recordId: 'el-ulf', field: '/name', side: 'theirs' });
    await w.merges.pick({ recordId: 'el-ulf', field: '/name', side: 'base' });

    expect((await w.merges.view())?.draft.picks).toEqual([
      { recordId: 'el-ulf', field: '/name', side: 'base' },
    ]);
    const { commit } = await w.merges.confirm();
    const result = await (await openCanon(w.files, w.canonId)).readSnapshot(commit);
    expect(result.get('el-ulf')?.data.name).toBe('Ulf');
  });

  it('the draft lives in the World: a reload resumes picks; cancel discards it, the Adventure stays', async () => {
    const w = await conflicted();
    await w.merges.endAdventure();
    await w.merges.pick({ recordId: 'el-gareth', field: '/name', side: 'theirs' });

    const reloaded = createMerges({
      history: w.history,
      workingCopy: createWorkingCopy(w.backend, { canWrite: () => true }),
      campaigns: w.campaigns,
      author: () => 'GM',
      applyResult: async () => {},
    });
    expect((await reloaded.view())?.draft.picks).toHaveLength(1);
    // Ending again resumes the same draft.
    expect((await w.merges.endAdventure()).draft.picks).toHaveLength(1);

    await w.merges.cancel();
    expect(await w.merges.view()).toBeNull();
    expect(w.workingCopy.binding?.checkout).toEqual({ adventure: w.adventureId });
    expect(w.applied).toEqual([]);
  });

  it('this World keeps its own doc uuids; they are never shown as changes', async () => {
    const w = await onAdventure();
    await w.workingCopy.set([{ ...gareth, data: { ...gareth.data, uuid: 'Actor.here' } }]);
    await canonEdit(w.files, w.canonId, () => [
      { ...gareth, data: { ...gareth.data, uuid: 'Actor.elsewhere' } },
    ]);

    const view = await w.merges.endAdventure();
    expect(view.records.find((r) => r.id === 'el-gareth')).toMatchObject({ badge: 'same' });
    await expect(
      w.merges.pick({ recordId: 'el-gareth', field: '/uuid', side: 'ours' }),
    ).rejects.toThrow(/World/);
    await w.merges.confirm();
    expect(w.workingCopy.get('el-gareth')?.data.uuid).toBe('Actor.here');
  });

  it('delete vs edit is one element-level choice; Connections and sheet follow a deleted element', async () => {
    const w = await onAdventure();
    const sheet: CanonRecord = {
      kind: 'sheet',
      id: 'el-ulf-sheet',
      data: { element: 'el-ulf', documentName: 'Actor', doc: { name: 'Ulf' } },
    };
    await w.workingCopy.delete(['el-ulf', 'cn-knows']);
    await canonEdit(w.files, w.canonId, () => [rename(ulf, 'Ulf the Bold'), sheet]);

    const view = await w.merges.endAdventure();
    const ulfView = view.records.find((r) => r.id === 'el-ulf');
    expect(ulfView).toMatchObject({ badge: 'conflict', open: 1 });
    expect(ulfView?.whole).toMatchObject({ field: '', theirs: undefined, open: true });
    expect(view.records.find((r) => r.id === 'cn-knows')?.badge).toBe('deleted');

    await w.merges.pick({ recordId: 'el-ulf', field: '', side: 'theirs' });
    const { commit } = await w.merges.confirm();
    const result = await (await openCanon(w.files, w.canonId)).readSnapshot(commit);
    expect([...result.keys()]).toEqual(['el-gareth']);
  });

  it('the summary lists merges main received since the Adventure started', async () => {
    const w = await onAdventure();
    // A second World plays another Adventure on the same base and ends it first.
    const other = world(w.files, 'Other GM');
    await other.history.bind({ canonId: w.canonId });
    const { adventureId } = await other.campaigns.startAdventure({
      name: 'Side quest',
      campaignId: w.campaignId,
    });
    await other.workingCopy.set([rename(ulf, 'Ulf (side)')]);
    await other.merges.endAdventure();
    const { commit } = await other.merges.confirm();

    const view = await w.merges.endAdventure();
    expect(view.received).toEqual([
      {
        adventure: 'Side quest',
        campaign: 'Phileasson',
        date: '2026-10-25T12:00:00.000Z',
        commit,
      },
    ]);
    expect(view.records.find((r) => r.id === 'el-ulf')?.badge).toBe('canonOnly');
    expect(view.counts.canonOnly).toBe(1);
    const ref = await (await openCanon(w.files, w.canonId)).getAdventure(adventureId);
    expect(ref).toMatchObject({ merged: commit, ended: '2026-10-25T12:00:00.000Z' });
  });

  it('refuses to confirm when main moved after the merge started', async () => {
    const w = await onAdventure();
    await w.merges.endAdventure();
    await canonEdit(w.files, w.canonId, () => [rename(ulf, 'Ulf late')]);
    await expect(w.merges.confirm()).rejects.toThrow(/moved/);
    // Ending again picks up the new main.
    expect((await w.merges.endAdventure()).counts.canonOnly).toBe(1);
  });
});
