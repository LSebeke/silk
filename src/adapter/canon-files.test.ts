import { describe, expect, it } from 'vitest';
import { createFilePickerAssets, createFilePickerFiles, type FilePickerApi } from './canon-files';

/** Fake Foundry Data folder: FilePicker semantics plus HTTP serving. */
function fakeData() {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['']);
  const uploads: string[] = [];
  const api: FilePickerApi = {
    async upload(source, path, file) {
      expect(source).toBe('data');
      if (!dirs.has(path)) throw new Error(`no dir ${path}`);
      files.set(`${path}/${file.name}`, await file.text());
      uploads.push(`${path}/${file.name}`);
      return { status: 'success', path: `${path}/${file.name}` };
    },
    async createDirectory(source, target) {
      const parent = target.split('/').slice(0, -1).join('/');
      if (!dirs.has(parent)) throw new Error(`no parent ${parent}`);
      if (dirs.has(target)) throw new Error('EEXIST: file already exists');
      dirs.add(target);
    },
    async browse(source, target) {
      if (!dirs.has(target)) throw new Error(`Directory ${target} does not exist`);
      const children = (set: Iterable<string>) =>
        [...set].filter(
          (p) => p.startsWith(`${target}/`) && !p.slice(target.length + 1).includes('/'),
        );
      return { files: children(files.keys()).map(encodeURI), dirs: children(dirs) };
    },
    async fetch(url) {
      const text = files.get(decodeURI(url.replace(/^\/route\//, '')));
      return {
        ok: text !== undefined,
        status: text === undefined ? 404 : 200,
        text: async () => text ?? '',
        arrayBuffer: async () => new TextEncoder().encode(text ?? '').buffer,
      };
    },
    route: (path) => `/route/${path}`,
  };
  return { api, files, dirs, uploads };
}

describe('FilePicker canon files', () => {
  it('writes under Data/silk/, creating directories once', async () => {
    const data = fakeData();
    const files = createFilePickerFiles(data.api);

    await files.write('abc/refs/main.json', '{"head":"1"}');
    await files.write('abc/refs/adventures/a 1.json', '{}');

    expect(data.files.get('silk/abc/refs/main.json')).toBe('{"head":"1"}');
    expect(await files.read('abc/refs/main.json')).toBe('{"head":"1"}');
    expect(await files.read('abc/refs/adventures/a 1.json')).toBe('{}');
    expect(await files.read('abc/missing.json')).toBeNull();
  });

  it('lists names in a directory, empty when missing', async () => {
    const data = fakeData();
    const files = createFilePickerFiles(data.api);
    await files.write('abc/refs/main.json', '{}');
    await files.write('abc/refs/adventures/a 1.json', '{}');

    expect((await files.list('abc/refs')).sort()).toEqual(['adventures', 'main.json']);
    expect(await files.list('abc/refs/adventures')).toEqual(['a 1.json']);
    expect(await files.list('abc/nope')).toEqual([]);
  });

  it('copes with directories that already exist (e.g. after a reload)', async () => {
    const data = fakeData();
    await createFilePickerFiles(data.api).write('abc/canon.json', '1');

    await createFilePickerFiles(data.api).write('abc/canon.json', '2');

    expect(data.files.get('silk/abc/canon.json')).toBe('2');
  });

  it('throws when an upload fails', async () => {
    const data = fakeData();
    data.api.upload = async () => false;
    await expect(createFilePickerFiles(data.api).write('abc/x.json', '1')).rejects.toThrow(
      /upload/,
    );
  });
});

describe('FilePicker asset files', () => {
  it('reads and writes Data files as bytes, outside silk/', async () => {
    const data = fakeData();
    const assets = createFilePickerAssets(data.api);

    await assets.write('worlds/w/art/map one.png', new TextEncoder().encode('map'));

    expect(data.files.get('worlds/w/art/map one.png')).toBe('map');
    expect(
      new TextDecoder().decode((await assets.read('worlds/w/art/map one.png')) ?? undefined),
    ).toBe('map');
    expect(await assets.read('worlds/w/none.png')).toBeNull();
  });
});
