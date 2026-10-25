/**
 * `CanonFiles` over Foundry's FilePicker (spec §11.1): writes `Data/silk/<path>` with
 * `FilePicker.upload('data')`, reads by HTTP, lists with `FilePicker.browse`.
 */
import type { AssetFiles, CanonFiles } from '../core/canon';

/** The slice of Foundry this adapter needs; `foundryFilePicker()` supplies the real one. */
export interface FilePickerApi {
  upload(source: 'data', path: string, file: File): Promise<unknown>;
  createDirectory(source: 'data', target: string): Promise<unknown>;
  browse(source: 'data', target: string): Promise<{ files: string[]; dirs: string[] }>;
  fetch(url: string): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  /** Data path → URL, honouring Foundry's route prefix. */
  route(path: string): string;
}

const ROOT = 'silk';

/** Creates directories on demand, remembering which exist this session. */
function directoryMaker(api: FilePickerApi) {
  const made = new Set<string>();
  return async function ensureDir(dir: string) {
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      if (made.has(path)) continue;
      try {
        await api.createDirectory('data', path);
      } catch {
        // Already exists; a real failure surfaces on upload.
      }
      made.add(path);
    }
  };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

async function upload(
  api: FilePickerApi,
  ensureDir: (dir: string) => Promise<void>,
  path: string,
  file: (name: string) => File,
) {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash);
  await ensureDir(dir);
  const result = await api.upload('data', dir, file(path.slice(slash + 1)));
  if (!result || (result as { status?: string }).status === 'error')
    throw new Error(`Silk: upload of ${path} failed`);
}

export function createFilePickerFiles(api: FilePickerApi): CanonFiles {
  const ensureDir = directoryMaker(api);
  const baseName = (path: string) => decodeURIComponent(path.split('/').pop() ?? '');

  return {
    async read(path) {
      const url = api.route(encodePath(`${ROOT}/${path}`));
      const res = await api.fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Silk: reading ${path} failed (${res.status})`);
      return res.text();
    },
    async write(path, text) {
      await upload(
        api,
        ensureDir,
        `${ROOT}/${path}`,
        (name) => new File([text], name, { type: 'application/json' }),
      );
    },
    async list(dir) {
      try {
        const { files, dirs } = await api.browse('data', `${ROOT}/${dir}`);
        return [...dirs, ...files].map(baseName);
      } catch {
        return [];
      }
    },
  };
}

/** `AssetFiles` over the same FilePicker: any `Data/` file, as bytes (spec §11.6). */
export function createFilePickerAssets(api: FilePickerApi): AssetFiles {
  const ensureDir = directoryMaker(api);
  return {
    async read(path) {
      const res = await api.fetch(api.route(encodePath(path)));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async write(path, bytes) {
      await upload(
        api,
        ensureDir,
        path,
        (name) => new File([bytes as Uint8Array<ArrayBuffer>], name),
      );
    },
  };
}

/** The real FilePicker, quiet (no upload notifications), reads bypassing the HTTP cache. */
export function foundryFilePicker(): FilePickerApi {
  const FP = foundry.applications.apps.FilePicker.implementation;
  return {
    upload: (source, path, file) => FP.upload(source, path, file, {}, { notify: false }),
    createDirectory: (source, target) => FP.createDirectory(source, target),
    browse: async (source, target) => {
      const result = await FP.browse(source, target);
      return { files: result.files, dirs: result.dirs };
    },
    fetch: (url) => fetch(url, { cache: 'no-store' }),
    route: (path) => foundry.utils.getRoute(path),
  };
}
