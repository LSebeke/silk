/** Canon edit mode load sync and Abandon (spec §11.3, §11.4 Reuse). */
import { describe, expect, it } from 'vitest';
import {
  createMemoryFiles,
  openCanon,
  type CanonRecord,
  type MemoryFiles,
  type Snapshot,
} from '../canon';
import { createCampaigns } from '../campaigns';
import { MainMovedError, createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createRegistry } from '../commands/registry';
import { historyCommands } from '../history';
import { mergeCommands, routeMainMoved, type MergeUi } from './commands';
import { MERGE_DRAFT, createMerges } from './merges';

const el = (id: string, data: CanonRecord['data']): CanonRecord => ({ kind: 'element', id, data });
const gareth = el('el-gareth', { class: 'person', name: 'Gareth', position: { x: 0, y: 0 } });
const ulf = el('el-ulf', { class: 'person', name: 'Ulf', position: { x: 100, y: 0 } });
const set = (record: CanonRecord, data: CanonRecord['data']) => ({
  ...record,
  data: { ...record.data, ...data },
});

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
    newId: () => `${author}-id${++n}`,
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

/** This World on main (Gareth, Ulf committed); `other` is a second World bound to the Canon. */
async function onMain() {
  const files = createMemoryFiles();
  const w = world(files);
  const { canonId } = await w.history.createCanon({ name: 'Aventurien' });
  await w.workingCopy.set([gareth, ulf]);
  const head = await w.history.commit({ label: 'Init' });
  const other = world(files, 'Other GM');
  await other.history.bind({ canonId });
  /** The other World edits main and commits. */
  async function moveMain(records: CanonRecord[]) {
    await other.workingCopy.set(records);
    return other.history.commit({ label: 'Canon edit elsewhere' });
  }
  return { ...w, canonId, head, other, moveMain };
}

describe('Canon edit mode load sync (spec §11.3)', () => {
  it('main unchanged: nothing to do', async () => {
    const w = await onMain();
    expect(await w.merges.syncMain()).toBe('current');
    expect(w.applied).toEqual([]);
  });

  it('clean World, main moved: fast-forward, rewriting the World to main', async () => {
    const w = await onMain();
    const moved = await w.moveMain([set(ulf, { name: 'Ulf the Bold' })]);

    expect(await w.merges.syncMain()).toBe('fastForward');

    expect(w.workingCopy.binding).toEqual({
      canonId: w.canonId,
      checkout: { main: true },
      head: moved,
    });
    expect(w.applied).toHaveLength(1);
    expect(w.workingCopy.get('el-ulf')?.data.name).toBe('Ulf the Bold');
    expect(await w.history.isDirty()).toBe(false);
    expect(w.workingCopy.meta(MERGE_DRAFT)).toBeUndefined();
  });

  it('dirty World, main moved: opens a merge "Canon (incoming)" / "This World"; confirm commits on main', async () => {
    const w = await onMain();
    const moved = await w.moveMain([set(ulf, { name: 'Ulf the Bold' })]);
    await w.workingCopy.set([set(gareth, { name: 'Gareth (here)' })]);
    await expect(w.history.commit({})).rejects.toThrow(MainMovedError);

    expect(await w.merges.syncMain()).toBe('merge');
    const view = await w.merges.view();
    expect(view?.draft).toMatchObject({ kind: 'canonEdit', base: w.head, ours: moved });
    expect(view?.columns).toEqual({
      base: 'SILK.Merge.Base',
      ours: 'SILK.Merge.CanonIncoming',
      theirs: 'SILK.Merge.ThisWorld',
    });
    expect(view?.records.find((r) => r.id === 'el-gareth')?.badge).toBe('changed');
    expect(view?.records.find((r) => r.id === 'el-ulf')?.badge).toBe('canonOnly');
    expect(w.workingCopy.binding?.head).toBe(w.head);
    expect(w.applied).toEqual([]);

    const { commit } = await w.merges.confirm();

    const canon = await openCanon(w.files, w.canonId);
    expect(await canon.getMain()).toBe(commit);
    const merged = await canon.readCommit(commit);
    expect(merged.parents[0]).toBe(moved);
    expect(merged.label).toBe('Merge this World');
    const result = await canon.readSnapshot(commit);
    expect(result.get('el-gareth')?.data.name).toBe('Gareth (here)');
    expect(result.get('el-ulf')?.data.name).toBe('Ulf the Bold');
    expect(w.workingCopy.binding).toEqual({
      canonId: w.canonId,
      checkout: { main: true },
      head: commit,
    });
    expect(w.applied).toHaveLength(1);
    expect(await w.history.isDirty()).toBe(false);
    expect(w.workingCopy.meta(MERGE_DRAFT)).toBeUndefined();
  });

  it('conflicts are picked per field; on a position conflict the incoming Canon wins', async () => {
    const w = await onMain();
    await w.moveMain([set(gareth, { name: 'Gareth (Canon)', position: { x: 5, y: 5 } }), ulf]);
    await w.workingCopy.set([set(gareth, { name: 'Gareth (World)', position: { x: 9, y: 9 } })]);

    expect(await w.merges.syncMain()).toBe('merge');
    const view = await w.merges.view();
    const fields = view?.records.find((r) => r.id === 'el-gareth')?.fields ?? [];
    expect(fields.find((f) => f.field === '/name')).toMatchObject({
      ours: 'Gareth (Canon)',
      theirs: 'Gareth (World)',
      open: true,
    });
    expect(fields.find((f) => f.field === '/position')?.result).toEqual({ x: 5, y: 5 });

    await w.merges.pick({ recordId: 'el-gareth', field: '/name', side: 'theirs' });
    const { commit } = await w.merges.confirm();
    const result = await (await openCanon(w.files, w.canonId)).readSnapshot(commit);
    expect(result.get('el-gareth')?.data).toMatchObject({
      name: 'Gareth (World)',
      position: { x: 5, y: 5 },
    });
  });

  it('a reload resumes the open draft with its picks; main moving again keeps the picks', async () => {
    const w = await onMain();
    await w.moveMain([set(gareth, { name: 'Gareth (Canon)' }), ulf]);
    await w.workingCopy.set([set(gareth, { name: 'Gareth (World)' }), ulf]);
    await w.merges.syncMain();
    await w.merges.pick({ recordId: 'el-gareth', field: '/name', side: 'theirs' });
    const draft = (await w.merges.view())?.draft;

    expect(await w.merges.syncMain()).toBe('merge');
    expect((await w.merges.view())?.draft).toEqual(draft);

    const moved = await w.moveMain([set(gareth, { name: 'Gareth (Canon)' })]);
    expect(await w.merges.syncMain()).toBe('merge');
    const next = (await w.merges.view())?.draft;
    expect(next).toMatchObject({ ours: moved, picks: draft?.picks });
  });

  it('this World keeps its doc uuids', async () => {
    const w = await onMain();
    await w.moveMain([set(gareth, { uuid: 'Actor.elsewhere' }), set(ulf, { name: 'Ulf 2' })]);
    await w.workingCopy.set([set(gareth, { uuid: 'Actor.here' }), ulf]);
    await w.merges.syncMain();
    await w.merges.confirm();
    expect(w.workingCopy.get('el-gareth')?.data.uuid).toBe('Actor.here');
  });

  it('does nothing under an Adventure (merges never flow into it)', async () => {
    const w = await onMain();
    const { id: campaignId } = await w.campaigns.create({ name: 'P' });
    await w.campaigns.startAdventure({ name: 'Ch. 1', campaignId });
    await w.moveMain([set(ulf, { name: 'Ulf 2' })]);
    expect(await w.merges.syncMain()).toBe('current');
  });
});

describe('Abandon (spec §11.3)', () => {
  async function onAdventure() {
    const w = await onMain();
    const { id: campaignId } = await w.campaigns.create({ name: 'Phileasson' });
    const { adventureId } = await w.campaigns.startAdventure({ name: 'Ch. 1', campaignId });
    await w.workingCopy.set([set(gareth, { name: 'Gareth (dead)' }), el('el-new', { name: 'N' })]);
    await w.history.commit({ label: 'Session 1' });
    return { ...w, adventureId };
  }

  it('needs the Adventure name typed exactly', async () => {
    const w = await onAdventure();
    await expect(w.merges.abandon({ confirm: 'ch. 1' })).rejects.toThrow(/Ch\. 1/);
    expect(w.workingCopy.binding?.checkout).toEqual({ adventure: w.adventureId });
    expect(w.applied).toEqual([]);
  });

  it('resets the World to main head, dropping the Adventure work; the Adventure is marked abandoned', async () => {
    const w = await onAdventure();
    const moved = await w.moveMain([gareth, set(ulf, { name: 'Ulf 2' })]);
    await w.workingCopy.set([el('el-uncommitted', { name: 'U' })]);
    await w.merges.endAdventure(); // an open merge draft goes too

    await w.merges.abandon({ confirm: 'Ch. 1' });

    expect(w.workingCopy.binding).toEqual({
      canonId: w.canonId,
      checkout: { main: true },
      head: moved,
    });
    expect(w.applied).toHaveLength(1);
    expect([...(w.applied[0]?.keys() ?? [])].sort()).toEqual(['el-gareth', 'el-ulf']);
    expect(w.workingCopy.get('el-gareth')?.data.name).toBe('Gareth');
    expect(w.workingCopy.meta(MERGE_DRAFT)).toBeUndefined();
    expect(await w.history.isDirty()).toBe(false);
    const ref = await (await openCanon(w.files, w.canonId)).getAdventure(w.adventureId);
    expect(ref).toMatchObject({ abandoned: '2026-10-25T12:00:00.000Z' });
    expect(ref?.merged).toBeUndefined();
  });

  it('refuses under main', async () => {
    const w = await onMain();
    await expect(w.merges.abandon({ confirm: '' })).rejects.toThrow(/Adventure/);
  });
});

describe('commands (spec §15)', () => {
  async function setup() {
    const w = await onMain();
    const calls: string[] = [];
    const ui: MergeUi = {
      open: async () => void calls.push('open'),
      close: async () => void calls.push('close'),
      confirmNoUndo: async () => true,
      focus: async () => {},
    };
    const registry = createRegistry(() => ({ isGM: true }));
    const merge = mergeCommands(() => w.merges, ui);
    for (const command of [...historyCommands(() => w.history), ...merge])
      registry.register(routeMainMoved(command, () => w.merges, ui));
    return { ...w, registry, calls };
  }

  it('history.commit under a moved main opens the merge instead of committing', async () => {
    const w = await setup();
    await w.moveMain([set(ulf, { name: 'Ulf 2' })]);
    await w.workingCopy.set([set(gareth, { name: 'G 2' })]);

    await expect(w.registry.run('history.commit', {})).rejects.toThrow(MainMovedError);

    expect(w.calls).toEqual(['open']);
    expect((await w.merges.view())?.draft.kind).toBe('canonEdit');
  });

  it('adventure.abandon { confirm } resets to main and closes an open merge window', async () => {
    const w = await setup();
    const { id } = await w.campaigns.create({ name: 'P' });
    await w.campaigns.startAdventure({ name: 'Ch. 1', campaignId: id });
    await w.workingCopy.set([el('el-new', { name: 'N' })]);

    await w.registry.run('adventure.abandon', { confirm: 'Ch. 1' });

    expect(w.workingCopy.binding?.checkout).toEqual({ main: true });
    expect(w.workingCopy.get('el-new')).toBeUndefined();
    expect(w.calls).toEqual(['close']);
  });
});
