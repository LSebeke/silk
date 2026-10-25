/**
 * Canon store (spec §11.1): content-addressed JSON blobs, commits and refs
 * under `Data/silk/<canon-id>/`. Pure core over an injected `CanonFiles`.
 */
import type { CanonFiles } from './files';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type RecordKind = 'element' | 'connection' | 'sheet' | 'eventScene' | 'layoutGroup';

/** One versioned record. `id` is stable across commits; `data` is the record's JSON. */
export interface CanonRecord {
  kind: RecordKind;
  id: string;
  data: JsonObject;
}

/** A full Canon state: record id → record. */
export type Snapshot = ReadonlyMap<string, CanonRecord>;

export interface Manifest {
  id: string;
  name: string;
  formatVersion: number;
  createdWith: string;
}

export interface Commit {
  formatVersion: number;
  parents: string[];
  label: string;
  /** ISO 8601. */
  date: string;
  author: string;
  /** Record id → blob hash. */
  tree: Record<string, string>;
}

export interface CommitArgs {
  snapshot: Snapshot;
  parents: string[];
  label: string;
  author: string;
  /** ISO 8601; defaults to now. */
  date?: string;
  /** Which ref moves to the new commit. */
  ref: { main: true } | { adventure: string };
}

/** `refs/adventures/<id>.json` (spec §11.1). */
export interface AdventureRef {
  id: string;
  name: string;
  campaignId: string;
  /** The main commit the Adventure branched from. */
  base: string;
  head: string;
  /** Set when the Adventure ended: its merge Commit on main (spec §11.3). */
  merged?: string;
  /** ISO 8601, when it ended. */
  ended?: string;
}

export interface CanonStore {
  /** Migrated to the current format in memory. */
  readonly manifest: Manifest;
  /** True when any file read so far is from a newer Silk; all writes then throw. */
  readonly readOnly: boolean;
  /**
   * Write `snapshot` as a commit and move `ref` to it. Order: changed blobs,
   * commit, ref last. Returns the commit hash.
   */
  commit(args: CommitArgs): Promise<string>;
  readCommit(hash: string): Promise<Commit>;
  readSnapshot(commitHash: string): Promise<Snapshot>;
  getMain(): Promise<string | null>;
  /** Create or overwrite an Adventure ref. */
  writeAdventure(ref: AdventureRef): Promise<void>;
  getAdventure(id: string): Promise<AdventureRef | null>;
  listAdventures(): Promise<AdventureRef[]>;
  /** Create or overwrite `campaigns/<id>/campaign.json`. Unversioned. */
  writeCampaign(campaign: Campaign): Promise<void>;
  getCampaign(id: string): Promise<Campaign | null>;
  listCampaigns(): Promise<Campaign[]>;
  /** `campaigns/<id>/revelation-map.json`, opaque here (spec §11.5). Unversioned. */
  writeRevelationMap(campaignId: string, map: JsonValue): Promise<void>;
  readRevelationMap(campaignId: string): Promise<JsonValue | null>;
}

/** `campaigns/<id>/campaign.json` (spec §11.1); `formatVersion` is added on disk. */
export interface Campaign {
  id: string;
  name: string;
  closed: boolean;
  /** ISO 8601. */
  createdAt: string;
}

export const FORMAT_VERSION = 1;

/** One format step, `n` → `n + 1`, per file kind. Missing entries pass through unchanged. */
export interface Migration {
  manifest?(doc: JsonObject): JsonObject;
  blob?(doc: JsonObject): JsonObject;
  commit?(doc: JsonObject): JsonObject;
  campaign?(doc: JsonObject): JsonObject;
}

/** Shipped migrations, keyed by the version they migrate from. Empty until the format changes. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export interface FormatOptions {
  /** The version this Silk writes. Default `FORMAT_VERSION`. */
  formatVersion?: number;
  /** Default `MIGRATIONS`. */
  migrations?: Readonly<Record<number, Migration>>;
}

/** Create a Canon and write its manifest. `id` defaults to a fresh random id. */
export async function createCanon(
  files: CanonFiles,
  args: { name: string; createdWith: string; id?: string },
  options: FormatOptions = {},
): Promise<CanonStore> {
  const manifest: Manifest = {
    id: args.id ?? newCanonId(),
    name: args.name,
    formatVersion: options.formatVersion ?? FORMAT_VERSION,
    createdWith: args.createdWith,
  };
  await files.write(`${manifest.id}/canon.json`, canonicalJson(manifest));
  return storeFor(files, manifest, options);
}

/** Open an existing Canon. Throws if `<id>/canon.json` is missing. */
export async function openCanon(
  files: CanonFiles,
  id: string,
  options: FormatOptions = {},
): Promise<CanonStore> {
  const manifest = await readJson<Manifest>(files, `${id}/canon.json`);
  return storeFor(files, manifest, options);
}

/** Random 128-bit id as 32 hex chars (ADR 0002). */
export function newCanonId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

type FileKind = keyof Migration;

function storeFor(files: CanonFiles, stored: Manifest, options: FormatOptions): CanonStore {
  const current = options.formatVersion ?? FORMAT_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  const root = stored.id;
  const objectPath = (hash: string) => `${root}/objects/${hash.slice(0, 2)}/${hash}.json`;
  const commitPath = (hash: string) => `${root}/commits/${hash}.json`;
  const adventurePath = (id: string) => `${root}/refs/adventures/${id}.json`;
  const campaignPath = (id: string) => `${root}/campaigns/${id}/campaign.json`;
  const revelationMapPath = (id: string) => `${root}/campaigns/${id}/revelation-map.json`;

  let readOnly = false;
  /** Version on disk; lags `current` until the first write upgrades it. */
  let diskVersion = stored.formatVersion;
  let manifest = migrate<Manifest>('manifest', stored);

  /** Bring `doc` up to `current`, in memory. A newer doc can't be read safely: go read-only. */
  function migrate<T>(kind: FileKind, doc: T): T {
    let out = doc as unknown as JsonObject;
    let version = out.formatVersion as number;
    if (version > current) readOnly = true;
    for (; version < current; version++) {
      const step = migrations[version]?.[kind];
      out = { ...(step ? step(out) : out), formatVersion: version + 1 };
    }
    return out as unknown as T;
  }

  /** Guard every write: refuse when read-only, upgrade an older manifest first. */
  async function beginWrite() {
    if (readOnly)
      throw new Error(
        'Silk: this Canon was written by a newer Silk and is read-only. Update Silk.',
      );
    if (diskVersion < current) {
      manifest = { ...manifest, formatVersion: current };
      await files.write(`${root}/canon.json`, canonicalJson(manifest));
      diskVersion = current;
    }
  }

  /** Blobs are immutable (content-addressed): read each once. Merges read 3 similar snapshots. */
  const blobs = new Map<string, Promise<CanonRecord>>();
  function readBlob(hash: string): Promise<CanonRecord> {
    let blob = blobs.get(hash);
    if (!blob) {
      blob = readJson<CanonRecord>(files, objectPath(hash)).then((b) => migrate('blob', b));
      blob.catch(() => blobs.delete(hash));
      blobs.set(hash, blob);
    }
    return blob;
  }

  const store: CanonStore = {
    get manifest() {
      return manifest;
    },
    get readOnly() {
      return readOnly;
    },

    async commit(args) {
      const adventure =
        'adventure' in args.ref ? await store.getAdventure(args.ref.adventure) : null;
      if ('adventure' in args.ref && !adventure)
        throw new Error(`Silk: no Adventure "${args.ref.adventure}" in this Canon`);
      // Blobs already referenced by a parent are on disk; upload only the rest.
      const known = new Set<string>();
      for (const parent of args.parents)
        for (const hash of Object.values((await store.readCommit(parent)).tree)) known.add(hash);
      await beginWrite();

      const entries: [string, string][] = [];
      for (const record of args.snapshot.values()) {
        const text = canonicalJson({ formatVersion: current, ...record });
        const hash = await sha256(text);
        entries.push([record.id, hash]);
        if (!known.has(hash)) await files.write(objectPath(hash), text);
      }
      // fromEntries, not assignment: ids are data and may be `__proto__`.
      const tree = Object.fromEntries(entries);
      const commit: Commit = {
        formatVersion: current,
        parents: args.parents,
        label: args.label,
        date: args.date ?? new Date().toISOString(),
        author: args.author,
        tree,
      };
      const text = canonicalJson(commit);
      const hash = await sha256(text);
      await files.write(commitPath(hash), text);
      // Refs last: a crash before this point leaves only orphans.
      if (adventure) await store.writeAdventure({ ...adventure, head: hash });
      else await files.write(`${root}/refs/main.json`, canonicalJson({ head: hash }));
      return hash;
    },

    async readCommit(hash) {
      return migrate<Commit>('commit', await readJson(files, commitPath(hash)));
    },

    async readSnapshot(commitHash) {
      const commit = await store.readCommit(commitHash);
      const entries = await Promise.all(
        Object.entries(commit.tree).map(async ([id, hash]) => [id, await readBlob(hash)] as const),
      );
      return new Map(
        entries.map(([id, blob]) => [id, { kind: blob.kind, id: blob.id, data: blob.data }]),
      );
    },

    async getMain() {
      const text = await files.read(`${root}/refs/main.json`);
      return text === null ? null : (JSON.parse(text) as { head: string }).head;
    },

    async writeAdventure(ref) {
      await beginWrite();
      await files.write(adventurePath(ref.id), canonicalJson(ref));
    },

    async getAdventure(id) {
      const text = await files.read(adventurePath(id));
      return text === null ? null : (JSON.parse(text) as AdventureRef);
    },

    async listAdventures() {
      const names = await files.list(`${root}/refs/adventures`);
      const refs = await Promise.all(
        names.filter((n) => n.endsWith('.json')).map((n) => store.getAdventure(n.slice(0, -5))),
      );
      return refs.filter((r) => r !== null);
    },

    async writeCampaign(campaign) {
      await beginWrite();
      await files.write(
        campaignPath(campaign.id),
        canonicalJson({ ...campaign, formatVersion: current }),
      );
    },

    async getCampaign(id) {
      const text = await files.read(campaignPath(id));
      if (text === null) return null;
      const {
        id: cid,
        name,
        closed,
        createdAt,
      } = migrate('campaign', JSON.parse(text) as JsonObject);
      return { id: cid, name, closed, createdAt } as Campaign;
    },

    async listCampaigns() {
      const ids = await files.list(`${root}/campaigns`);
      const campaigns = await Promise.all(ids.map((id) => store.getCampaign(id)));
      return campaigns.filter((c) => c !== null);
    },

    async writeRevelationMap(campaignId, map) {
      await beginWrite();
      await files.write(revelationMapPath(campaignId), canonicalJson(map));
    },

    async readRevelationMap(campaignId) {
      const text = await files.read(revelationMapPath(campaignId));
      return text === null ? null : (JSON.parse(text) as JsonValue);
    },
  };
  return store;
}

async function readJson<T>(files: CanonFiles, path: string): Promise<T> {
  const text = await files.read(path);
  if (text === null) throw new Error(`Silk: Canon file missing: ${path}`);
  return JSON.parse(text) as T;
}

/** JSON with object keys sorted, no whitespace: the hashed and stored form. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
