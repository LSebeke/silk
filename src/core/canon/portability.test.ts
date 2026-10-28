import { describe, expect, it } from 'vitest';
import { createCanon, createMemoryFiles, openCanon, type CanonRecord } from '.';
import {
  exportBackup,
  exportShare,
  ImportCancelled,
  importArchive,
  ImportRefused,
  type AssetFiles,
} from './portability';

const el = (id: string, data: CanonRecord['data'] = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { name: id, ...data },
});
const snap = (...records: CanonRecord[]) => new Map(records.map((r) => [r.id, r]));
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

function memoryAssets(initial: Record<string, string> = {}) {
  const contents = new Map<string, Uint8Array>(
    Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)] as const),
  );
  const assets: AssetFiles & { contents: Map<string, Uint8Array> } = {
    contents,
    async read(path) {
      return contents.get(path) ?? null;
    },
    async write(path, bytes) {
      contents.set(path, bytes);
    },
  };
  return assets;
}

async function canonWithHistory() {
  const files = createMemoryFiles();
  const store = await createCanon(files, { name: 'Aventurien', createdWith: 'test' });
  const c1 = await store.commit({
    snapshot: snap(el('a')),
    parents: [],
    label: 'one',
    author: 'GM',
    ref: { main: true },
  });
  const c2 = await store.commit({
    snapshot: snap(el('a'), el('b')),
    parents: [c1],
    label: 'two',
    author: 'GM',
    ref: { main: true },
  });
  return { files, store, id: store.manifest.id, c1, c2 };
}

describe('exportBackup', () => {
  it('holds every file reachable from refs, and counts orphans', async () => {
    const { files, id, c2 } = await canonWithHistory();
    // A crashed commit leaves an orphan blob and commit.
    files.contents.set(`${id}/objects/ff/ff00.json`, '{}');
    files.contents.set(`${id}/commits/dead.json`, '{"parents":[],"tree":{}}');

    const backup = await exportBackup({ files, canonId: id, assets: memoryAssets() });

    expect(backup.orphanCount).toBe(2);
    expect(backup.entries.has('canon/objects/ff/ff00.json')).toBe(false);
    expect(backup.entries.has('canon/commits/dead.json')).toBe(false);
    expect(backup.entries.has(`canon/commits/${c2}.json`)).toBe(true);
    expect(text(backup.entries.get('canon/refs/main.json'))).toContain(c2);
    expect(backup.manifest).toMatchObject({ kind: 'backup', canonId: id, name: 'Aventurien' });
    // Every file in the backup came from the Canon folder unchanged.
    for (const [path, bytes] of backup.entries)
      if (path.startsWith('canon/'))
        expect(text(bytes)).toBe(files.contents.get(`${id}/${path.slice(6)}`));
  });

  it('includes Adventures, Campaigns and Revelation Maps', async () => {
    const { files, store, id, c2 } = await canonWithHistory();
    await store.writeCampaign({ id: 'camp', name: 'C', closed: false, createdAt: '2026-01-01' });
    await store.writeRevelationMap('camp', { elements: ['a'] });
    await store.writeAdventure({ id: 'adv', name: 'A', campaignId: 'camp', base: c2, head: c2 });
    const c3 = await store.commit({
      snapshot: snap(el('a'), el('c')),
      parents: [c2],
      label: 'adv',
      author: 'GM',
      ref: { adventure: 'adv' },
    });

    const backup = await exportBackup({ files, canonId: id, assets: memoryAssets() });

    expect(backup.orphanCount).toBe(0);
    expect(backup.entries.has(`canon/commits/${c3}.json`)).toBe(true);
    expect(backup.entries.has('canon/refs/adventures/adv.json')).toBe(true);
    expect(backup.entries.has('canon/campaigns/camp/campaign.json')).toBe(true);
    expect(backup.entries.has('canon/campaigns/camp/revelation-map.json')).toBe(true);
  });

  it('bundles referenced Data files with SHA-256, skipping core/system/module paths', async () => {
    const files = createMemoryFiles();
    const store = await createCanon(files, { name: 'A', createdWith: 'test' });
    await store.commit({
      snapshot: snap(
        el('a', { img: 'worlds/w/hero.webp', icon: 'icons/svg/mystery-man.svg' }),
        el('b', {
          sheet: { img: 'systems/dsa5/icons/x.png', token: { src: '/modules/m/t.png' } },
          info: '<p>See <img src="silk-art/map%20one.jpg"></p>',
          url: 'https://example.com/a.png',
          lost: 'worlds/w/gone.png',
        }),
      ),
      parents: [],
      label: '',
      author: 'GM',
      ref: { main: true },
    });
    const assets = memoryAssets({ 'worlds/w/hero.webp': 'abc', 'silk-art/map one.jpg': 'map' });

    const { entries, manifest } = await exportBackup({
      files,
      canonId: store.manifest.id,
      assets,
    });

    expect(manifest.assets).toContainEqual({
      path: 'worlds/w/hero.webp',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    expect(manifest.assets.map((a) => a.path).sort()).toEqual([
      'silk-art/map one.jpg',
      'worlds/w/hero.webp',
    ]);
    expect(manifest.missingAssets).toEqual(['worlds/w/gone.png']);
    expect(text(entries.get('assets/worlds/w/hero.webp'))).toBe('abc');
    expect(text(entries.get('assets/silk-art/map one.jpg'))).toBe('map');
  });
});

describe('exportShare', () => {
  it('squashes a Commit into one root Commit, without Adventures or Campaigns', async () => {
    const { files, store, id, c1 } = await canonWithHistory();
    await store.writeCampaign({ id: 'camp', name: 'C', closed: false, createdAt: '2026-01-01' });

    const share = await exportShare({ files, canonId: id, commit: c1, assets: memoryAssets() });

    expect(share.manifest).toMatchObject({ kind: 'share', name: 'Aventurien' });
    const paths = [...share.entries.keys()];
    expect(paths.filter((p) => p.startsWith('canon/commits/'))).toHaveLength(1);
    expect(paths.some((p) => p.includes('campaigns/') || p.includes('adventures/'))).toBe(false);
    const head = (JSON.parse(text(share.entries.get('canon/refs/main.json'))) as { head: string })
      .head;
    const commit = JSON.parse(text(share.entries.get(`canon/commits/${head}.json`))) as {
      parents: string[];
      label: string;
      tree: Record<string, string>;
    };
    expect(commit.parents).toEqual([]);
    expect(commit.label).toBe('one');
    expect(Object.keys(commit.tree)).toEqual(['a']);
  });

  it('shares an Adventure head by Adventure id', async () => {
    const { files, store, id, c2 } = await canonWithHistory();
    await store.writeAdventure({ id: 'adv', name: 'A', campaignId: 'x', base: c2, head: c2 });
    await store.commit({
      snapshot: snap(el('a'), el('b'), el('worldState', { day: 3 })),
      parents: [c2],
      label: 'session 1',
      author: 'GM',
      ref: { adventure: 'adv' },
    });

    const share = await exportShare({ files, canonId: id, commit: 'adv', assets: memoryAssets() });

    const trees = [...share.entries]
      .filter(([p]) => p.startsWith('canon/commits/'))
      .map(([, b]) => Object.keys((JSON.parse(text(b)) as { tree: object }).tree).sort());
    expect(trees).toEqual([['a', 'b', 'worldState']]);
  });
});

describe('importArchive', () => {
  it('restores a Backup on a new server under the same id', async () => {
    const { files, store, id, c2 } = await canonWithHistory();
    await store.writeCampaign({ id: 'camp', name: 'C', closed: true, createdAt: '2026-01-01' });
    await store.writeRevelationMap('camp', { elements: ['a'] });
    await store.writeAdventure({ id: 'adv', name: 'A', campaignId: 'camp', base: c2, head: c2 });
    const backup = await exportBackup({ files, canonId: id, assets: memoryAssets() });

    const target = createMemoryFiles();
    const result = await importArchive({
      files: target,
      assets: memoryAssets(),
      entries: backup.entries,
    });

    expect(result).toMatchObject({ canonId: id, mode: 'new', name: 'Aventurien' });
    const restored = await openCanon(target, id);
    expect(await restored.getMain()).toBe(c2);
    expect([...(await restored.readSnapshot(c2)).keys()]).toEqual(['a', 'b']);
    expect(await restored.getCampaign('camp')).toMatchObject({ name: 'C', closed: true });
    expect(await restored.readRevelationMap('camp')).toMatchObject({ elements: ['a'] });
    expect(await restored.getAdventure('adv')).toMatchObject({ head: c2 });
    // Refs land last, after the objects they point to.
    expect(target.writes.at(-1)).toBe(`${id}/canon.json`);
    expect(target.writes.indexOf(`${id}/refs/main.json`)).toBeGreaterThan(
      target.writes.indexOf(`${id}/commits/${c2}.json`),
    );
  });

  it('fast-forwards when the imported main descends from local main', async () => {
    const { files, id, c1, c2 } = await canonWithHistory();
    const backup = await exportBackup({ files, canonId: id, assets: memoryAssets() });
    // The local copy is still at c1.
    const local = createMemoryFiles();
    for (const [path, text] of files.contents) local.contents.set(path, text);
    local.contents.set(`${id}/refs/main.json`, JSON.stringify({ head: c1 }));

    const result = await importArchive({
      files: local,
      assets: memoryAssets(),
      entries: backup.entries,
    });

    expect(result.mode).toBe('fastForward');
    expect(await (await openCanon(local, id)).getMain()).toBe(c2);
    // Immutable files already present are not rewritten.
    expect(local.writes).not.toContain(`${id}/commits/${c1}.json`);
  });

  it('refuses a diverged Backup unless imported as a copy', async () => {
    const { files, id, c1 } = await canonWithHistory();
    const backup = await exportBackup({ files, canonId: id, assets: memoryAssets() });
    // Local main moved elsewhere from c1.
    const local = createMemoryFiles();
    for (const [path, text] of files.contents) local.contents.set(path, text);
    const localStore = await openCanon(local, id);
    await localStore.commit({
      snapshot: snap(el('z')),
      parents: [c1],
      label: 'other',
      author: 'GM',
      ref: { main: true },
    });
    const localMain = await localStore.getMain();

    await expect(
      importArchive({ files: local, assets: memoryAssets(), entries: backup.entries }),
    ).rejects.toBeInstanceOf(ImportRefused);
    expect(await (await openCanon(local, id)).getMain()).toBe(localMain);

    const copy = await importArchive({
      files: local,
      assets: memoryAssets(),
      entries: backup.entries,
      asCopy: true,
      newId: () => 'copy1',
    });
    expect(copy).toMatchObject({ canonId: 'copy1', mode: 'copy' });
    const copied = await openCanon(local, 'copy1');
    expect(copied.manifest.id).toBe('copy1');
    expect([...(await copied.readSnapshot((await copied.getMain()) ?? '')).keys()]).toEqual([
      'a',
      'b',
    ]);
  });

  it('imports a Share under a new id, as one root Commit', async () => {
    const { files, id, c2 } = await canonWithHistory();
    const share = await exportShare({ files, canonId: id, commit: c2, assets: memoryAssets() });

    const result = await importArchive({
      files,
      assets: memoryAssets(),
      entries: share.entries,
      newId: () => 'shared1',
    });

    expect(result).toMatchObject({ canonId: 'shared1', mode: 'new' });
    const imported = await openCanon(files, 'shared1');
    const head = (await imported.getMain()) ?? '';
    expect((await imported.readCommit(head)).parents).toEqual([]);
    expect([...(await imported.readSnapshot(head)).keys()]).toEqual(['a', 'b']);
  });

  describe('assets', () => {
    async function archiveWithArt(kind: 'backup' | 'share') {
      const files = createMemoryFiles();
      const store = await createCanon(files, { name: 'A', createdWith: 'test' });
      const head = await store.commit({
        snapshot: snap(
          el('a', { img: 'worlds/w/hero.webp', bio: '<img src="/worlds/w/map.png">' }),
          el('b', { img: 'worlds/w/same.png', lost: 'worlds/w/gone.png' }),
        ),
        parents: [],
        label: '',
        author: 'GM',
        ref: { main: true },
      });
      const source = memoryAssets({
        'worlds/w/hero.webp': 'hero',
        'worlds/w/map.png': 'map',
        'worlds/w/same.png': 'same',
      });
      const args = { files, canonId: store.manifest.id, assets: source };
      const out =
        kind === 'backup' ? await exportBackup(args) : await exportShare({ ...args, commit: head });
      return out.entries;
    }

    it('writes new files, skips identical ones and reports missing ones', async () => {
      const entries = await archiveWithArt('backup');
      const target = memoryAssets({ 'worlds/w/same.png': 'same' });

      const result = await importArchive({ files: createMemoryFiles(), assets: target, entries });

      expect(result.assets.written.sort()).toEqual(['worlds/w/hero.webp', 'worlds/w/map.png']);
      expect(result.assets.skipped).toEqual(['worlds/w/same.png']);
      expect(result.assets.missing).toEqual(['worlds/w/gone.png']);
      expect(text(target.contents.get('worlds/w/hero.webp'))).toBe('hero');
    });

    it('Backup: lists conflicting files and overwrites only on confirm', async () => {
      const entries = await archiveWithArt('backup');
      const target = memoryAssets({ 'worlds/w/hero.webp': 'other hero' });
      const files = createMemoryFiles();
      const asked: string[][] = [];

      await expect(
        importArchive({
          files,
          assets: target,
          entries,
          confirmOverwrite: async (paths) => (asked.push(paths), false),
        }),
      ).rejects.toBeInstanceOf(ImportCancelled);
      expect(asked).toEqual([['worlds/w/hero.webp']]);
      expect(files.writes).toEqual([]);
      expect(text(target.contents.get('worlds/w/hero.webp'))).toBe('other hero');

      const result = await importArchive({
        files,
        assets: target,
        entries,
        confirmOverwrite: async () => true,
      });
      expect(result.assets.overwritten).toEqual(['worlds/w/hero.webp']);
      expect(text(target.contents.get('worlds/w/hero.webp'))).toBe('hero');
    });

    it('Share: writes a conflicting file under a hashed name and rewrites references', async () => {
      const entries = await archiveWithArt('share');
      const target = memoryAssets({ 'worlds/w/map.png': 'other map' });
      const files = createMemoryFiles();

      const result = await importArchive({ files, assets: target, entries, newId: () => 's' });

      // SHA-256("map") starts with 60be9861.
      const renamed = 'worlds/w/map.silk-60be9861.png';
      expect(result.assets.renamed).toEqual([{ from: 'worlds/w/map.png', to: renamed }]);
      expect(text(target.contents.get(renamed))).toBe('map');
      expect(text(target.contents.get('worlds/w/map.png'))).toBe('other map');
      const canon = await openCanon(files, 's');
      const a = (await canon.readSnapshot((await canon.getMain()) ?? '')).get('a');
      expect(a?.data.bio).toBe(`<img src="/${renamed}">`);
      expect(a?.data.img).toBe('worlds/w/hero.webp');
    });

    it('rejects an asset whose bytes do not match its SHA-256', async () => {
      const entries = await archiveWithArt('backup');
      entries.set('assets/worlds/w/hero.webp', new TextEncoder().encode('tampered'));

      await expect(
        importArchive({ files: createMemoryFiles(), assets: memoryAssets(), entries }),
      ).rejects.toThrow(/hero\.webp/);
    });

    it('refuses paths that escape the Canon folder or Data', async () => {
      const entries = await archiveWithArt('backup');
      const manifest = JSON.parse(text(entries.get('silk-export.json'))) as {
        assets: { path: string; sha256: string }[];
      };
      manifest.assets.push({ path: '../evil.png', sha256: 'x' });
      entries.set('silk-export.json', new TextEncoder().encode(JSON.stringify(manifest)));
      await expect(
        importArchive({ files: createMemoryFiles(), assets: memoryAssets(), entries }),
      ).rejects.toThrow(/evil/);

      const other = await archiveWithArt('backup');
      other.set('canon/../other/canon.json', new TextEncoder().encode('{}'));
      await expect(
        importArchive({ files: createMemoryFiles(), assets: memoryAssets(), entries: other }),
      ).rejects.toThrow(/other/);
    });
  });
});
