/**
 * Canon Backup / Share / import (spec §11.6). Pure core: Canon files, Data assets and
 * the archive (zip path → bytes) are injected; the adapter does zip, FilePicker and download.
 *
 * Archive layout:
 *   silk-export.json      `ExportManifest` (kind, Canon id, assets with SHA-256)
 *   canon/<path>          Canon files, relative to `Data/silk/<canon-id>/`
 *   assets/<data path>    referenced `Data/` files
 */
import type { CanonFiles } from './files';
import { createMemoryFiles } from './memory-files';
import { canonicalJson, createCanon, newCanonId, openCanon, type Manifest } from './store';

/** `Data/` files outside the Canon, as bytes. Paths are Data-relative, e.g. `worlds/x/a.webp`. */
export interface AssetFiles {
  /** File bytes, or `null` if missing. */
  read(path: string): Promise<Uint8Array | null>;
  /** Create or overwrite. */
  write(path: string, bytes: Uint8Array): Promise<void>;
}

/** Zip contents, path → bytes. */
export type ArchiveEntries = Map<string, Uint8Array>;

export const EXPORT_FORMAT = 1;
export const MANIFEST_PATH = 'silk-export.json';

export interface ExportManifest {
  exportFormat: number;
  kind: 'backup' | 'share';
  canonId: string;
  name: string;
  /** ISO 8601. */
  exportedAt: string;
  /** Bundled `Data/` files with their SHA-256 (hex). */
  assets: { path: string; sha256: string }[];
  /** Referenced files the exporting server did not have. */
  missingAssets: string[];
}

export interface ExportResult {
  entries: ArchiveEntries;
  manifest: ExportManifest;
  /** Objects and commits in the Canon folder that the export leaves out (spec §11.6 GC). */
  orphanCount: number;
}

interface RawCommit {
  parents: string[];
  tree: Record<string, string>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const objectPath = (hash: string) => `objects/${hash.slice(0, 2)}/${hash}.json`;
const commitPath = (hash: string) => `commits/${hash}.json`;

/** `canon.exportBackup`: everything reachable from refs, Adventures, Campaigns, maps. */
export async function exportBackup(args: {
  files: CanonFiles;
  canonId: string;
  assets: AssetFiles;
  now?: () => string;
}): Promise<ExportResult> {
  const { files, canonId: id } = args;
  const read = async (path: string) => {
    const text = await files.read(`${id}/${path}`);
    if (text === null) throw new Error(`Silk: Canon file missing: ${id}/${path}`);
    return text;
  };
  const out = new Map<string, string>();
  const take = async (path: string) => {
    const text = out.get(path) ?? (await read(path));
    out.set(path, text);
    return text;
  };

  const manifestText = await take('canon.json');
  const heads: string[] = [];
  if ((await files.read(`${id}/refs/main.json`)) !== null)
    heads.push((JSON.parse(await take('refs/main.json')) as { head: string }).head);
  for (const name of await files.list(`${id}/refs/adventures`)) {
    if (!name.endsWith('.json')) continue;
    const ref = JSON.parse(await take(`refs/adventures/${name}`)) as { base: string; head: string };
    heads.push(ref.head, ref.base);
  }
  for (const campaign of await files.list(`${id}/campaigns`))
    for (const name of await files.list(`${id}/campaigns/${campaign}`))
      await take(`campaigns/${campaign}/${name}`);

  // Walk the commit graph from every head.
  const commits = new Set<string>();
  const blobs = new Set<string>();
  const stack = [...heads];
  for (let hash = stack.pop(); hash !== undefined; hash = stack.pop()) {
    if (commits.has(hash)) continue;
    commits.add(hash);
    const commit = JSON.parse(await take(commitPath(hash))) as RawCommit;
    stack.push(...commit.parents);
    for (const blob of Object.values(commit.tree)) blobs.add(blob);
  }
  // Blobs are independent: read them in parallel.
  const blobTexts = await Promise.all(
    [...blobs].map(async (blob) => [objectPath(blob), await read(objectPath(blob))] as const),
  );
  const refs: string[] = [];
  for (const [path, text] of blobTexts) {
    out.set(path, text);
    refs.push(...collectAssetRefs(JSON.parse(text)));
  }

  const onDisk = (await immutableFiles(files, id)).size;

  const { name } = JSON.parse(manifestText) as { name: string };
  const manifest: ExportManifest = {
    exportFormat: EXPORT_FORMAT,
    kind: 'backup',
    canonId: id,
    name,
    exportedAt: (args.now ?? (() => new Date().toISOString()))(),
    assets: [],
    missingAssets: [],
  };
  const entries: ArchiveEntries = new Map();
  for (const [path, text] of out) entries.set(`canon/${path}`, encoder.encode(text));
  await bundleAssets(args.assets, refs, entries, manifest);
  entries.set(MANIFEST_PATH, encoder.encode(JSON.stringify(manifest, null, 2)));
  return { entries, manifest, orphanCount: onDisk - commits.size - blobs.size };
}

/**
 * `canon.exportShare`: one Commit (hash) or Adventure head (Adventure id), squashed into
 * a single root Commit. No Adventures, Campaigns, Revelation Maps or uncommitted work.
 */
export async function exportShare(args: {
  files: CanonFiles;
  canonId: string;
  commit: string;
  assets: AssetFiles;
  now?: () => string;
}): Promise<ExportResult> {
  const source = await openCanon(args.files, args.canonId);
  const adventure = await source.getAdventure(args.commit);
  const hash = adventure?.head ?? args.commit;
  const commit = await source.readCommit(hash);
  const snapshot = await source.readSnapshot(hash);

  const squashed = createMemoryFiles();
  const target = await createCanon(squashed, {
    id: source.manifest.id,
    name: source.manifest.name,
    createdWith: source.manifest.createdWith,
  });
  await target.commit({
    snapshot,
    parents: [],
    label: commit.label,
    author: commit.author,
    date: commit.date,
    ref: { main: true },
  });

  const manifest: ExportManifest = {
    exportFormat: EXPORT_FORMAT,
    kind: 'share',
    canonId: source.manifest.id,
    name: source.manifest.name,
    exportedAt: (args.now ?? (() => new Date().toISOString()))(),
    assets: [],
    missingAssets: [],
  };
  const entries: ArchiveEntries = new Map();
  const prefix = `${source.manifest.id}/`;
  for (const [path, text] of squashed.contents)
    entries.set(`canon/${path.slice(prefix.length)}`, encoder.encode(text));
  const refs: string[] = [];
  for (const record of snapshot.values()) refs.push(...collectAssetRefs(record.data));
  await bundleAssets(args.assets, refs, entries, manifest);
  entries.set(MANIFEST_PATH, encoder.encode(JSON.stringify(manifest, null, 2)));
  return { entries, manifest, orphanCount: 0 };
}

export const decodeText = (bytes: Uint8Array) => decoder.decode(bytes);

/** A Backup whose main does not descend from local main: offer "import as copy". */
export class ImportRefused extends Error {
  readonly reason = 'diverged';
  constructor(readonly canonId: string) {
    super('Silk: this Backup has diverged from the Canon on this server; import it as a copy');
  }
}

/** The GM declined to overwrite conflicting files. Nothing was written. */
export class ImportCancelled extends Error {
  constructor() {
    super('Silk: import cancelled');
  }
}

export interface ImportResult {
  canonId: string;
  name: string;
  /** `new`: a Canon this server did not have; `fastForward`: Backup over the same Canon. */
  mode: 'new' | 'fastForward' | 'copy';
  assets: {
    written: string[];
    /** Identical file already on the server. */
    skipped: string[];
    /** Backup: different file replaced on confirm. */
    overwritten: string[];
    /** Share: different file kept, the import's copy written under a new name. */
    renamed: { from: string; to: string }[];
    /** Referenced, but not in the archive. */
    missing: string[];
  };
}

/** `canon.import`: write a Backup or Share archive into `Data/silk/` and its assets into `Data/`. */
export async function importArchive(args: {
  files: CanonFiles;
  assets: AssetFiles;
  entries: ArchiveEntries;
  /** Backup only: import under a new id instead of over the existing Canon. */
  asCopy?: boolean;
  /** Backup: asked once with every conflicting path; `false` cancels. Default: cancel. */
  confirmOverwrite?: (paths: string[]) => Promise<boolean>;
  newId?: () => string;
}): Promise<ImportResult> {
  const { files, entries } = args;
  const newId = args.newId ?? newCanonId;
  const manifestBytes = entries.get(MANIFEST_PATH);
  if (!manifestBytes) throw new Error('Silk: not a Silk Canon export (no silk-export.json)');
  const manifest = JSON.parse(decodeText(manifestBytes)) as ExportManifest;
  if (manifest.exportFormat > EXPORT_FORMAT)
    throw new Error('Silk: this export was made by a newer Silk. Update Silk.');

  const canon = new Map<string, string>();
  for (const [path, bytes] of entries) {
    if (!path.startsWith('canon/')) continue;
    if (!CANON_PATH.test(path.slice(6)))
      throw new Error(`Silk: unexpected file in this export: ${path}`);
    canon.set(path.slice(6), decodeText(bytes));
  }
  for (const { path } of manifest.assets)
    if (dataPath(path) !== path) throw new Error(`Silk: unsafe asset path in this export: ${path}`);

  // Plan: which Canon id, and is it a fast-forward?
  let mode: ImportResult['mode'] = 'new';
  let canonId = manifest.canonId;
  if (manifest.kind === 'share') canonId = newId();
  else if (args.asCopy) {
    canonId = newId();
    mode = 'copy';
  } else if ((await files.read(`${canonId}/canon.json`)) !== null) {
    mode = 'fastForward';
    const localMain = await readHead(files, `${canonId}/refs/main.json`);
    const importedMain = headOf(canon.get('refs/main.json'));
    if (localMain && !(importedMain && ancestors(canon, importedMain).has(localMain)))
      throw new ImportRefused(canonId);
  }

  // Assets: verify, then classify against the server before writing anything.
  const result: ImportResult = {
    canonId,
    name: manifest.name,
    mode,
    assets: {
      written: [],
      skipped: [],
      overwritten: [],
      renamed: [],
      missing: [...manifest.missingAssets],
    },
  };
  const writes: [string, Uint8Array][] = [];
  const conflicts: [string, Uint8Array][] = [];
  const renames = new Map<string, string>();
  for (const { path, sha256 } of manifest.assets) {
    const bytes = entries.get(`assets/${path}`);
    if (!bytes) {
      result.assets.missing.push(path);
      continue;
    }
    if ((await sha256Hex(bytes)) !== sha256)
      throw new Error(`Silk: ${path} in this export is damaged (SHA-256 mismatch)`);
    const existing = await args.assets.read(path);
    if (existing === null) writes.push([path, bytes]);
    else if ((await sha256Hex(existing)) === sha256) result.assets.skipped.push(path);
    else if (manifest.kind === 'backup') conflicts.push([path, bytes]);
    else {
      const to = hashedName(path, sha256);
      renames.set(path, to);
      result.assets.renamed.push({ from: path, to });
      const there = await args.assets.read(to);
      if (there === null || (await sha256Hex(there)) !== sha256) writes.push([to, bytes]);
    }
  }
  if (conflicts.length) {
    const ok = await (args.confirmOverwrite ?? (async () => false))(conflicts.map(([p]) => p));
    if (!ok) throw new ImportCancelled();
  }

  if (manifest.kind === 'share') await importShare(files, canon, canonId, renames);
  else await writeBackup(files, canon, canonId, mode);

  for (const [path, bytes] of writes) {
    await args.assets.write(path, bytes);
    if (!renames.has(path)) result.assets.written.push(path);
  }
  for (const [path, bytes] of conflicts) {
    await args.assets.write(path, bytes);
    result.assets.overwritten.push(path);
  }
  return result;
}

/** Every file a Canon folder may hold (spec §11.1). Anything else in an archive is refused. */
const CANON_PATH =
  /^(canon\.json|refs\/main\.json|refs\/adventures\/[\w-]+\.json|commits\/[0-9a-f]{64}\.json|objects\/[0-9a-f]{2}\/[0-9a-f]{64}\.json|campaigns\/[\w-]+\/(campaign|revelation-map)\.json)$/;

/** `dir/name.ext` →`dir/name.silk-<hash8>.ext` (spec §11.6). */
function hashedName(path: string, sha256: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const tag = `.silk-${sha256.slice(0, 8)}`;
  return dot > slash ? `${path.slice(0, dot)}${tag}${path.slice(dot)}` : `${path}${tag}`;
}

function headOf(text: string | undefined | null): string | null {
  return text ? (JSON.parse(text) as { head: string }).head : null;
}

async function readHead(files: CanonFiles, path: string) {
  return headOf(await files.read(path));
}

/** Paths of every commit and object in a Canon folder, relative to it. */
async function immutableFiles(files: CanonFiles, id: string): Promise<Set<string>> {
  const json = (names: string[]) => names.filter((n) => n.endsWith('.json'));
  const out = new Set(json(await files.list(`${id}/commits`)).map((n) => `commits/${n}`));
  const dirs = await files.list(`${id}/objects`);
  const lists = await Promise.all(
    dirs.map(async (dir) =>
      json(await files.list(`${id}/objects/${dir}`)).map((n) => `objects/${dir}/${n}`),
    ),
  );
  for (const path of lists.flat()) out.add(path);
  return out;
}

/** `head` and every commit before it, from the archive's commits. */
function ancestors(canon: ReadonlyMap<string, string>, head: string): Set<string> {
  const seen = new Set<string>();
  const stack = [head];
  for (let hash = stack.pop(); hash !== undefined; hash = stack.pop()) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    const text = canon.get(commitPath(hash));
    if (text) stack.push(...(JSON.parse(text) as RawCommit).parents);
  }
  return seen;
}

/** Raw Backup files. Order: objects, commits, unversioned files, refs, manifest last. */
async function writeBackup(
  files: CanonFiles,
  canon: ReadonlyMap<string, string>,
  canonId: string,
  mode: ImportResult['mode'],
) {
  const rank = (path: string) =>
    path.startsWith('objects/')
      ? 0
      : path.startsWith('commits/')
        ? 1
        : path.startsWith('campaigns/')
          ? 2
          : path.startsWith('refs/')
            ? 3
            : 4;
  const sorted = [...canon].sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const present = mode === 'fastForward' ? await immutableFiles(files, canonId) : new Set();
  for (const [path, raw] of sorted) {
    const target = `${canonId}/${path}`;
    if (mode === 'fastForward') {
      // Immutable and already there.
      if (present.has(path)) continue;
      // An Adventure the server has moved on keeps its local head.
      if (path.startsWith('refs/adventures/')) {
        const local = await readHead(files, target);
        if (local && !ancestors(canon, headOf(raw) ?? '').has(local)) continue;
      }
    }
    const text =
      path === 'canon.json'
        ? canonicalJson({ ...(JSON.parse(raw) as Manifest), id: canonId })
        : raw;
    await files.write(target, text);
  }
}

/** Re-commit the Share's single snapshot under `canonId`, with asset renames applied. */
async function importShare(
  files: CanonFiles,
  canon: ReadonlyMap<string, string>,
  canonId: string,
  renames: ReadonlyMap<string, string>,
) {
  const staged = createMemoryFiles();
  const manifest = canon.get('canon.json');
  if (!manifest) throw new Error('Silk: this Share has no canon.json');
  const sourceId = (JSON.parse(manifest) as Manifest).id;
  for (const [path, text] of canon) staged.contents.set(`${sourceId}/${path}`, text);
  const source = await openCanon(staged, sourceId);
  const head = await source.getMain();
  if (!head) throw new Error('Silk: this Share has no Commit');
  const commit = await source.readCommit(head);
  const snapshot = new Map(
    [...(await source.readSnapshot(head))].map(([id, r]) => [
      id,
      { ...r, data: rewriteAssetRefs(r.data, renames) },
    ]),
  );
  const target = await createCanon(files, {
    id: canonId,
    name: source.manifest.name,
    createdWith: source.manifest.createdWith,
  });
  await target.commit({
    snapshot,
    parents: [],
    label: commit.label,
    author: commit.author,
    date: commit.date,
    ref: { main: true },
  });
}

// --- Asset references -------------------------------------------------------------

const MEDIA =
  /\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?|ico|mp3|ogg|oga|opus|wav|flac|m4a|aac|webm|mp4|m4v|ogv|pdf)$/i;
/** Shipped with Foundry core, a system or a module: present on every server, never bundled. */
const SKIPPED = /^(icons|ui|sounds|cards|fonts|css|scripts|lang|systems|modules)\//;
const ATTRIBUTE = /\b(src|href)="([^"]+)"/g;

/** A string's Data path if it references a bundleable `Data/` file, else `null`. */
function dataPath(ref: string): string | null {
  if (!MEDIA.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) return null;
  let path = ref.replace(/^\/+/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not URL-encoded.
  }
  if (path.split('/').includes('..') || SKIPPED.test(path)) return null;
  return path;
}

/** Map every string in `value` (whole-string refs and `src`/`href` in HTML) through `fn`. */
function mapRefs(value: unknown, fn: (ref: string, path: string) => string): unknown {
  if (typeof value === 'string') {
    const path = dataPath(value);
    if (path !== null) return fn(value, path);
    return value.includes('="')
      ? value.replace(ATTRIBUTE, (all, attr: string, ref: string) => {
          const inner = dataPath(ref);
          return inner === null ? all : `${attr}="${fn(ref, inner)}"`;
        })
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapRefs(v, fn));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapRefs(v, fn)]));
  return value;
}

/** Data paths of the `Data/` files `value` references (spec §11.6 Assets). */
export function collectAssetRefs(value: unknown): Set<string> {
  const found = new Set<string>();
  mapRefs(value, (ref, path) => {
    found.add(path);
    return ref;
  });
  return found;
}

/** Replace references to the Data paths in `renames` (old path → new path). */
export function rewriteAssetRefs<T>(value: T, renames: ReadonlyMap<string, string>): T {
  return mapRefs(value, (ref, path) => {
    const to = renames.get(path);
    if (to === undefined) return ref;
    const encoded = /%[0-9a-f]{2}/i.test(ref) ? encodeURI(to) : to;
    return ref.startsWith('/') ? `/${encoded}` : encoded;
  }) as T;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read every referenced asset into the archive; record hashes and missing files. */
async function bundleAssets(
  assets: AssetFiles,
  refs: Iterable<string>,
  entries: ArchiveEntries,
  manifest: ExportManifest,
) {
  for (const path of [...new Set(refs)].sort()) {
    const bytes = await assets.read(path);
    if (bytes === null) {
      manifest.missingAssets.push(path);
      continue;
    }
    entries.set(`assets/${path}`, bytes);
    manifest.assets.push({ path, sha256: await sha256Hex(bytes) });
  }
}
