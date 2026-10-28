import { describe, expect, it } from 'vitest';
import { createMemoryFiles, type CanonRecord, type MemoryFiles, type Snapshot } from '../canon';
import { createCampaigns } from '../campaigns';
import { createHistory } from '../history';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createMerges, type MergeView, type RecordView } from './merges';
import type { SheetSections } from './rows';

/** Test labels: Actor `system.<top>` → `S.<top>`, Items → `I.<type>`. */
const sections: SheetSections = {
  system: (_doc, path) => `S.${path[0] ?? ''}`,
  item: (type) => `I.${type ?? ''}`,
};

let dates = 0;
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
  const merges = createMerges({
    history,
    workingCopy,
    campaigns,
    author: () => author,
    now: () => `2026-10-${String(++dates).padStart(2, '0')}T12:00:00.000Z`,
    sections,
    applyResult: (result: Snapshot) => workingCopy.replaceAll(result),
  });
  return { files, workingCopy, history, campaigns, merges };
}

const el = (id: string, data: CanonRecord['data']): CanonRecord => ({ kind: 'element', id, data });
const gareth = el('el-gareth', { class: 'person', name: 'Gareth', position: { x: 0, y: 0 } });
const ulf = el('el-ulf', { class: 'person', name: 'Ulf', position: { x: 300, y: 0 } });
const brawl = el('el-brawl', { class: 'event', name: 'Brawl', position: { x: 0, y: 300 } });

const sheet = (system: CanonRecord['data'], items: CanonRecord['data'][]): CanonRecord => ({
  kind: 'sheet',
  id: 'el-gareth-sheet',
  data: {
    element: 'el-gareth',
    documentName: 'Actor',
    doc: { _id: 'actor1', name: 'Gareth', type: 'npc', system, items },
  },
});
const sword = { _id: 'sword', name: 'Sword', type: 'meleeweapon', system: { quantity: 1 } };
const body = { _id: 'body', name: 'Body control', type: 'skill', system: { talentValue: 4 } };
const garethSheet = sheet({ characteristics: { mu: 12 }, status: { wounds: 30 } }, [sword, body]);

const token = (id: string, name: string, x: number, y: number) => ({
  _id: id,
  name,
  actorId: name,
  x,
  y,
  hidden: true,
});
const wall = (id: string) => ({ _id: id, c: [0, 0, 100, 0] });
const scene = (tokens: object[], walls: object[], lights: object[] = []): CanonRecord => ({
  kind: 'eventScene',
  id: 'el-brawl-scene',
  data: {
    element: 'el-brawl',
    scene: { _id: 'sc1', name: 'Brawl', width: 4000, height: 3000, tokens, walls, lights },
  } as CanonRecord['data'],
});
const brawlScene = scene(
  [token('t1', 'Gareth', 100, 100), token('t2', 'Ulf', 200, 100)],
  [wall('w1'), wall('w2')],
);

const set = (record: CanonRecord, data: Record<string, unknown>): CanonRecord => ({
  ...record,
  data: { ...record.data, ...data } as CanonRecord['data'],
});

/** Main has Gareth (with sheet), Ulf and the Brawl (with Scene); Adventure "Ch. 1" is checked out. */
async function onAdventure() {
  const files = createMemoryFiles();
  const w = world(files);
  const { canonId } = await w.history.createCanon({ name: 'Aventurien' });
  await w.workingCopy.set([gareth, ulf, brawl, garethSheet, brawlScene]);
  await w.history.commit({ label: 'Init' });
  const { id: campaignId } = await w.campaigns.create({ name: 'Phileasson' });
  await w.campaigns.startAdventure({ name: 'Ch. 1', campaignId });
  return { ...w, canonId, campaignId };
}

/** Another World edits main in Canon edit mode. */
async function canonEdit(files: MemoryFiles, canonId: string, records: CanonRecord[]) {
  const other = world(files, 'Other GM');
  await other.history.bind({ canonId });
  await other.workingCopy.set(records);
  return other.history.commit({ label: 'Canon edit' });
}

const recordOf = (view: MergeView | null, id: string) =>
  view?.records.find((r) => r.id === id) as RecordView;
const rowsOf = (view: MergeView | null, id: string) =>
  recordOf(view, id).rows.map((r) => ({ section: r.section, label: r.label, kind: r.kind }));

describe('merge rows: sheets (spec §11.4)', () => {
  it('groups sheet fields by the adapter section labels; embedded Items by id', async () => {
    const w = await onAdventure();
    await w.workingCopy.set([
      sheet({ characteristics: { mu: 13 }, status: { wounds: 12 } }, [
        { ...sword, system: { quantity: 2 } },
        body,
        { _id: 'rope', name: 'Rope', type: 'equipment', system: {} },
      ]),
    ]);
    const view = await w.merges.endAdventure();

    expect(recordOf(view, 'el-gareth-sheet').owner).toBe('el-gareth');
    expect(rowsOf(view, 'el-gareth-sheet')).toEqual([
      { section: 'I.equipment', label: 'Rope', kind: 'field' },
      { section: 'I.meleeweapon', label: 'Sword · system · quantity', kind: 'field' },
      { section: 'S.characteristics', label: 'characteristics · mu', kind: 'field' },
      { section: 'S.status', label: 'status · wounds', kind: 'field' },
    ]);
    expect(recordOf(view, 'el-gareth-sheet').rows[1]).toMatchObject({
      field: '/doc/items/sword/system/quantity',
      base: 1,
      ours: 1,
      theirs: 2,
      result: 2,
    });
  });
});

describe('merge rows: Event Scenes (spec §11.4)', () => {
  /** The Canon moved Ulf's token and added a light; the Adventure moved Ulf too, added a wall. */
  async function moved() {
    const w = await onAdventure();
    await w.workingCopy.set([
      scene(
        [token('t1', 'Gareth', 100, 100), token('t2', 'Ulf', 900, 100)],
        [wall('w1'), wall('w2'), wall('w3')],
      ),
    ]);
    await canonEdit(w.files, w.canonId, [
      scene(
        [token('t1', 'Gareth', 100, 100), { ...token('t2', 'Ulf', 300, 700), hidden: false }],
        [wall('w1'), wall('w2')],
        [{ _id: 'l1', x: 5, y: 5 }],
      ),
    ]);
    return w;
  }

  it('one row per token matched by id; walls and lights as count-only rows', async () => {
    const w = await moved();
    const view = await w.merges.endAdventure();
    const record = recordOf(view, 'el-brawl-scene');

    expect(record.owner).toBe('el-brawl');
    expect(rowsOf(view, 'el-brawl-scene')).toEqual([
      { section: 'SILK.Merge.Section.sceneContents', label: 'lights', kind: 'count' },
      { section: 'SILK.Merge.Section.tokens', label: 'Ulf', kind: 'token' },
      { section: 'SILK.Merge.Section.sceneContents', label: 'walls', kind: 'count' },
    ]);
    const [lights, ulfToken, walls] = record.rows;
    expect(ulfToken).toMatchObject({
      field: '/scene/tokens/t2',
      base: { x: 200, y: 100, hidden: true },
      ours: { x: 300, y: 700, hidden: false },
      theirs: { x: 900, y: 100, hidden: true },
      open: true,
      conflict: true,
    });
    expect(lights).toMatchObject({ base: 0, ours: 1, theirs: 0, result: 1, canonOnly: true });
    expect(walls).toMatchObject({ base: 2, ours: 2, theirs: 3, result: 3, open: false });
  });

  it('picking a token row takes that side for each of its fields', async () => {
    const w = await moved();
    await w.merges.endAdventure();
    await w.merges.pick({ recordId: 'el-brawl-scene', field: '/scene/tokens/t2', side: 'ours' });

    const view = await w.merges.view();
    expect(recordOf(view, 'el-brawl-scene').rows[1]).toMatchObject({
      open: false,
      result: { x: 300, y: 700, hidden: false },
    });
    expect(view?.counts.open).toBe(0);
  });
});

describe('layout (spec §11.4)', () => {
  it('counts the Adventure’s Node moves; a conflicting move takes the incoming side, overridable', async () => {
    const w = await onAdventure();
    await w.workingCopy.set([
      set(gareth, { position: { x: 50, y: 50 } }),
      set(ulf, { position: { x: 400, y: 400 } }),
    ]);
    await canonEdit(w.files, w.canonId, [set(ulf, { position: { x: 0, y: 900 } })]);

    const view = await w.merges.endAdventure();
    expect(view.counts.moves).toBe(2);
    expect(view.counts.open).toBe(0);
    const move = recordOf(view, 'el-ulf').rows[0];
    expect(move).toMatchObject({
      section: 'SILK.Merge.Section.layout',
      layout: true,
      conflict: false,
      result: { x: 400, y: 400 },
    });

    await w.merges.pick({ recordId: 'el-ulf', field: '/position', side: 'ours' });
    expect(recordOf(await w.merges.view(), 'el-ulf').rows[0]?.result).toEqual({ x: 0, y: 900 });
  });
});

describe('attribution chips (spec §11.4)', () => {
  it('names the Adventure · Campaign · date, or the Commit, behind every Canon change', async () => {
    const w = await onAdventure();
    // Another World plays "Side quest" on the same base and ends it first.
    const other = world(w.files, 'Other GM');
    await other.history.bind({ canonId: w.canonId });
    await other.campaigns.startAdventure({ name: 'Side quest', campaignId: w.campaignId });
    await other.workingCopy.set([set(ulf, { name: 'Ulf (side)' })]);
    await other.merges.endAdventure();
    const { commit: merged } = await other.merges.confirm();
    const edit = await canonEdit(w.files, w.canonId, [
      sheet({ characteristics: { mu: 14 }, status: { wounds: 30 } }, [sword, body]),
    ]);
    await w.workingCopy.set([set(gareth, { name: 'Gareth (Adventure)' })]);

    const view = await w.merges.endAdventure();
    const ulfName = recordOf(view, 'el-ulf').rows[0];
    expect(ulfName?.by).toMatchObject({
      commit: merged,
      adventure: 'Side quest',
      campaign: 'Phileasson',
    });
    expect(ulfName?.by?.date).toMatch(/^2026-10-\d\dT12:00:00.000Z$/);
    expect(recordOf(view, 'el-gareth-sheet').rows[0]?.by).toEqual({
      commit: edit,
      date: expect.any(String),
      label: 'Canon edit',
    });
    // Adventure-only changes carry no chip.
    expect(recordOf(view, 'el-gareth').rows[0]?.by).toBeUndefined();
  });
});
