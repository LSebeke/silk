/**
 * `CanonFiles` over Foundry's FilePicker (spec §11.1): writes `Data/silk/<path>` with
 * `FilePicker.upload('data')`, reads by HTTP, lists with `FilePicker.browse`.
 */
import type { CanonFiles } from '../core/canon';

/** The slice of Foundry this adapter needs; `foundryFilePicker()` supplies the real one. */
export interface FilePickerApi {
  upload(source: 'data', path: string, file: File): Promise<unknown>;
  createDirectory(source: 'data', target: string): Promise<unknown>;
  browse(source: 'data', target: string): Promise<{ files: string[]; dirs: string[] }>;
  fetch(url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** Data path → URL, honouring Foundry's route prefix. */
  route(path: string): string;
}

const ROOT = 'silk';

export function createFilePickerFiles(api: FilePickerApi): CanonFiles {
  /** Directories known to exist this session. */
  const made = new Set<string>();

  async function ensureDir(dir: string) {
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
  }

  const baseName = (path: string) => decodeURIComponent(path.split('/').pop() ?? '');

  return {
    async read(path) {
      const url = api.route(`${ROOT}/${path}`.split('/').map(encodeURIComponent).join('/'));
      const res = await api.fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Silk: reading ${path} failed (${res.status})`);
      return res.text();
    },
    async write(path, text) {
      const full = `${ROOT}/${path}`;
      const slash = full.lastIndexOf('/');
      const dir = full.slice(0, slash);
      await ensureDir(dir);
      const file = new File([text], full.slice(slash + 1), { type: 'application/json' });
      const result = await api.upload('data', dir, file);
      if (!result || (result as { status?: string }).status === 'error')
        throw new Error(`Silk: upload of ${path} failed`);
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
