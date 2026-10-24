import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMemoryFiles, type MemoryFiles } from './memory-files';
import { createCanon, openCanon, type CanonRecord, type JsonObject } from './store';

const gareth: CanonRecord = { kind: 'element', id: 'el-gareth', data: { name: 'Gareth' } };
const knows: CanonRecord = {
  kind: 'connection',
  id: 'cn-1',
  data: { from: 'el-gareth', to: 'el-ulf', label: 'knows' },
};

function snapshot(...records: CanonRecord[]) {
  return new Map(records.map((r) => [r.id, r]));
}

function fileJson(files: MemoryFiles, path: string) {
  const text = files.contents.get(path);
  if (text === undefined) throw new Error(`no file ${path}`);
  return JSON.parse(text);
}

describe('canon store', () => {
  it('reads back a committed snapshot after reopening the canon', async () => {
    const files = createMemoryFiles();
    const canon = await createCanon(files, { name: 'Aventurien', createdWith: 'silk 0.1.0' });

    const head = await canon.commit({
      snapshot: snapshot(gareth, knows),
      parents: [],
      label: 'First',
      author: 'GM',
      ref: { main: true },
    });

    const reopened = await openCanon(files, canon.manifest.id);
    expect(reopened.manifest.name).toBe('Aventurien');
    expect(await reopened.getMain()).toBe(head);
    expect(await reopened.readSnapshot(head)).toEqual(snapshot(gareth, knows));
    const commit = await reopened.readCommit(head);
    expect(commit).toMatchObject({ parents: [], label: 'First', author: 'GM' });
  });

  it('gives each canon a random 128-bit id and writes its manifest', async () => {
    const files = createMemoryFiles();
    const a = await createCanon(files, { name: 'A', createdWith: 'silk 0.1.0' });
    const b = await createCanon(files, { name: 'B', createdWith: 'silk 0.1.0' });

    expect(a.manifest.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.manifest.id).not.toBe(b.manifest.id);
    expect(fileJson(files, `${a.manifest.id}/canon.json`)).toEqual({
      id: a.manifest.id,
      name: 'A',
      formatVersion: 1,
      createdWith: 'silk 0.1.0',
    });
  });

  it('uploads only changed blobs, then the commit, then the ref last', async () => {
    const files = createMemoryFiles();
    const canon = await createCanon(files, { name: 'A', createdWith: 'silk 0.1.0' });
    const id = canon.manifest.id;
    const first = await canon.commit({
      snapshot: snapshot(gareth, knows),
      parents: [],
      label: 'First',
      author: 'GM',
      ref: { main: true },
    });
    files.writes.length = 0;

    const renamed: CanonRecord = { ...gareth, data: { name: 'Gareth Ulfson' } };
    const second = await canon.commit({
      snapshot: snapshot(renamed, knows),
      parents: [first],
      label: 'Second',
      author: 'GM',
      ref: { main: true },
    });

    expect(files.writes).toHaveLength(3);
    const [blob, commit, ref] = files.writes;
    expect(blob).toMatch(new RegExp(`^${id}/objects/([0-9a-f]{2})/\\1[0-9a-f]{62}\\.json$`));
    expect(commit).toBe(`${id}/commits/${second}.json`);
    expect(ref).toBe(`${id}/refs/main.json`);
    expect(fileJson(files, String(blob))).toEqual({ formatVersion: 1, ...renamed });
  });

  it('keeps Adventures as refs that commits move without touching main', async () => {
    const files = createMemoryFiles();
    const canon = await createCanon(files, { name: 'A', createdWith: 'silk 0.1.0' });
    const base = await canon.commit({
      snapshot: snapshot(gareth),
      parents: [],
      label: 'Base',
      author: 'GM',
      ref: { main: true },
    });
    await canon.writeAdventure({
      id: 'adv-1',
      name: 'Die Verschwörung',
      campaignId: 'cmp-1',
      base,
      head: base,
    });

    const played = await canon.commit({
      snapshot: snapshot(gareth, knows),
      parents: [base],
      label: 'Session 1',
      author: 'GM',
      ref: { adventure: 'adv-1' },
    });

    const reopened = await openCanon(files, canon.manifest.id);
    expect(await reopened.getMain()).toBe(base);
    expect(await reopened.listAdventures()).toEqual([
      { id: 'adv-1', name: 'Die Verschwörung', campaignId: 'cmp-1', base, head: played },
    ]);
    expect(await reopened.getAdventure('adv-1')).toMatchObject({ head: played });
    expect(await reopened.getAdventure('nope')).toBeNull();
    expect(files.contents.has(`${canon.manifest.id}/refs/adventures/adv-1.json`)).toBe(true);
  });

  describe('format versions', () => {
    // A future v2 renamed element `title` to `name` and commit `message` to `label`.
    const v2 = {
      formatVersion: 2,
      migrations: {
        1: {
          blob: ({ data, ...blob }: JsonObject) => {
            const { title, ...rest } = data as JsonObject;
            return { ...blob, data: { ...rest, name: title ?? null } };
          },
          commit: ({ message, ...commit }: JsonObject) => ({ ...commit, label: message ?? '' }),
        },
      },
    };

    async function v1Canon() {
      const files = createMemoryFiles();
      const canon = await createCanon(files, { name: 'Old', createdWith: 'silk 0.1.0' });
      const legacy = { kind: 'element', id: 'el-gareth', data: { title: 'Gareth' } } as const;
      const head = await canon.commit({
        snapshot: snapshot(legacy as unknown as CanonRecord),
        parents: [],
        label: 'unused',
        author: 'GM',
        ref: { main: true },
      });
      // Rewrite the commit as v1 wrote it, keeping its hash (as on a real v1 disk).
      const path = `${canon.manifest.id}/commits/${head}.json`;
      const { label, ...rest } = fileJson(files, path);
      files.contents.set(path, JSON.stringify({ ...rest, message: label }));
      return { files, id: canon.manifest.id, head };
    }

    it('migrates older blobs and commits on read, in memory only', async () => {
      const { files, id, head } = await v1Canon();
      const before = new Map(files.contents);

      const canon = await openCanon(files, id, v2);

      expect(canon.readOnly).toBe(false);
      expect(await canon.readSnapshot(head)).toEqual(snapshot(gareth));
      expect((await canon.readCommit(head)).label).toBe('unused');
      expect(files.contents).toEqual(before);
    });

    it('writes the current version, upgrading the manifest before anything else', async () => {
      const { files, id, head } = await v1Canon();
      const canon = await openCanon(files, id, v2);
      files.writes.length = 0;

      const next = await canon.commit({
        snapshot: snapshot(gareth, knows),
        parents: [head],
        label: 'On v2',
        author: 'GM',
        ref: { main: true },
      });

      expect(files.writes[0]).toBe(`${id}/canon.json`);
      expect(fileJson(files, `${id}/canon.json`).formatVersion).toBe(2);
      expect(fileJson(files, `${id}/commits/${next}.json`).formatVersion).toBe(2);
      expect(canon.manifest.formatVersion).toBe(2);
    });

    it('opens a canon written by a newer Silk read-only', async () => {
      const { files, id, head } = await v1Canon();
      const manifest = fileJson(files, `${id}/canon.json`);
      files.contents.set(`${id}/canon.json`, JSON.stringify({ ...manifest, formatVersion: 3 }));
      files.writes.length = 0;

      const canon = await openCanon(files, id, v2);

      expect(canon.readOnly).toBe(true);
      await expect(
        canon.commit({
          snapshot: snapshot(gareth),
          parents: [head],
          label: 'x',
          author: 'GM',
          ref: { main: true },
        }),
      ).rejects.toThrow(/read-only/);
      await expect(
        canon.writeAdventure({ id: 'a', name: 'a', campaignId: 'c', base: head, head }),
      ).rejects.toThrow(/read-only/);
      expect(files.writes).toEqual([]);
    });

    it('turns read-only when it meets a blob from a newer Silk', async () => {
      const { files, id, head } = await v1Canon();
      const canon = await openCanon(files, id, v2);
      const [blobHash] = Object.values((await canon.readCommit(head)).tree);
      const path = `${id}/objects/${String(blobHash).slice(0, 2)}/${blobHash}.json`;
      files.contents.set(path, JSON.stringify({ ...gareth, formatVersion: 3 }));

      await canon.readSnapshot(head);

      expect(canon.readOnly).toBe(true);
    });
  });

  it('refuses to commit to an Adventure that does not exist', async () => {
    const canon = await createCanon(createMemoryFiles(), { name: 'A', createdWith: 'silk 0.1.0' });
    await expect(
      canon.commit({
        snapshot: snapshot(gareth),
        parents: [],
        label: 'x',
        author: 'GM',
        ref: { adventure: 'nope' },
      }),
    ).rejects.toThrow(/nope/);
  });

  it('round-trips any records, and blob hashes ignore object key order', async () => {
    const kind = fc.constantFrom(
      ...(['element', 'connection', 'sheet', 'eventScene', 'layoutGroup'] as const),
    );
    const record = fc.record({
      kind,
      id: fc.oneof(fc.string({ minLength: 1 }), fc.constant('__proto__')),
      data: fc.dictionary(fc.string(), fc.jsonValue()) as fc.Arbitrary<JsonObject>,
    });
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(record, { selector: (r) => r.id }), async (records) => {
        const files = createMemoryFiles();
        const canon = await createCanon(files, { name: 'P', createdWith: 'test' });
        const commit = (rs: CanonRecord[]) =>
          canon.commit({
            snapshot: snapshot(...rs),
            parents: [],
            label: '',
            author: '',
            date: 'd',
            ref: { main: true },
          });
        const reversed = records.map((r) => ({
          ...r,
          data: Object.fromEntries(Object.entries(r.data).reverse()),
        }));

        const head = await commit(records);

        const back = await canon.readSnapshot(head);
        expect(back).toEqual(snapshot(...(JSON.parse(JSON.stringify(records)) as CanonRecord[])));
        expect(await commit(reversed)).toBe(head);
      }),
      { numRuns: 50 },
    );
  });

  it('stores Campaigns and their Revelation Maps outside the history, overwritten in place', async () => {
    const files = createMemoryFiles();
    const canon = await createCanon(files, { name: 'A', createdWith: 'silk 0.1.0' });
    const id = canon.manifest.id;
    const campaign = { id: 'cmp-1', name: 'Gruppe 1', closed: false, createdAt: '2026-10-01' };

    await canon.writeCampaign(campaign);
    await canon.writeCampaign({ ...campaign, closed: true });
    await canon.writeRevelationMap('cmp-1', { elements: ['el-gareth'] });

    const reopened = await openCanon(files, id);
    expect(await reopened.listCampaigns()).toEqual([{ ...campaign, closed: true }]);
    expect(await reopened.getCampaign('cmp-1')).toEqual({ ...campaign, closed: true });
    expect(await reopened.getCampaign('nope')).toBeNull();
    expect(await reopened.readRevelationMap('cmp-1')).toEqual({ elements: ['el-gareth'] });
    expect(await reopened.readRevelationMap('nope')).toBeNull();
    expect(fileJson(files, `${id}/campaigns/cmp-1/campaign.json`)).toEqual({
      ...campaign,
      closed: true,
      formatVersion: 1,
    });
    expect(files.contents.has(`${id}/campaigns/cmp-1/revelation-map.json`)).toBe(true);
    expect(await reopened.getMain()).toBeNull();
  });
});
