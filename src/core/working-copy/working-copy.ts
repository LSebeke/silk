/**
 * Silk Working Copy (spec §11.3): the World's uncommitted records (non-Materialized
 * elements, Connections, Tags, layout) plus the Canon binding. Pure core over an
 * injected backend; the Foundry adapter stores it in a hidden JournalEntry,
 * one `flags.silk.records.<id>` per record. Only the active GM writes.
 */
import { canonicalJson, type CanonRecord, type JsonValue, type Snapshot } from '../canon';

/** Which Canon this World is bound to (for life) and what it has checked out. */
export interface Binding {
  canonId: string;
  checkout: { main: true } | { adventure: string };
  /** Commit the working copy was last committed at or reset to; `null` before the first Commit. */
  head: string | null;
}

/** A diff to persist or to apply. Omitted fields are unchanged. */
export interface WorkingCopyPatch {
  binding?: Binding | null;
  set?: CanonRecord[];
  delete?: string[];
  /** World-only values (merge draft, ignored ad-hoc docs), never committed. `null` removes. */
  meta?: Record<string, JsonValue | null>;
}

export interface WorkingCopyState {
  binding: Binding | null;
  records: CanonRecord[];
  meta?: Record<string, JsonValue>;
}

export interface WorkingCopyBackend {
  load(): WorkingCopyState;
  write(patch: WorkingCopyPatch): Promise<void>;
}

/** What changed, by id. `binding` is true when the binding changed. */
export interface WorkingCopyChange {
  set: string[];
  deleted: string[];
  binding: boolean;
  /** Meta keys set or removed. */
  meta?: string[];
}

export interface WorkingCopy {
  readonly binding: Binding | null;
  get(id: string): CanonRecord | undefined;
  /** Current records. Do not mutate. */
  records(): Snapshot;
  /** Create or replace records. Active GM only. */
  set(records: CanonRecord[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
  /** Make the records equal `snapshot`, writing only the difference. */
  replaceAll(snapshot: Snapshot): Promise<void>;
  setBinding(binding: Binding): Promise<void>;
  /** World-only value under `key` (spec §11.3: the merge draft lives here). */
  meta(key: string): JsonValue | undefined;
  /** Set (or with `null` remove) a World-only value. Active GM only. */
  setMeta(key: string, value: JsonValue | null): Promise<void>;
  /** Fine-grained change notifications. Returns an unsubscribe function. */
  watch(listener: (change: WorkingCopyChange) => void): () => void;
  /** Svelte store contract: called now and after every change with the records. */
  subscribe(run: (records: Snapshot) => void): () => void;
  /** Apply a patch another client wrote (no write back). */
  applyRemote(patch: WorkingCopyPatch): void;
  /** Replace everything from a fresh load (e.g. the journal appeared). */
  reload(): void;
}

export interface WorkingCopyOptions {
  /** True only on `game.users.activeGM` (spec §7). */
  canWrite(): boolean;
}

/** Ids become flag keys: no dots, no `-=` prefix, no prototype keys. */
const RECORD_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function createWorkingCopy(
  backend: WorkingCopyBackend,
  options: WorkingCopyOptions,
): WorkingCopy {
  let records = new Map<string, CanonRecord>();
  let binding: Binding | null = null;
  let meta = new Map<string, JsonValue>();
  const watchers = new Set<(change: WorkingCopyChange) => void>();
  const subscribers = new Set<(records: Snapshot) => void>();
  /** Writes are serialised so the backend sees them in order. */
  let queue: Promise<void> = Promise.resolve();

  function load() {
    const state = backend.load();
    records = new Map(state.records.map((r) => [r.id, r]));
    binding = state.binding;
    meta = new Map(Object.entries(state.meta ?? {}));
  }
  load();

  function apply(patch: WorkingCopyPatch): WorkingCopyChange {
    const change: WorkingCopyChange = { set: [], deleted: [], binding: false };
    if (patch.binding !== undefined) {
      binding = patch.binding;
      change.binding = true;
    }
    for (const record of patch.set ?? []) {
      records.set(record.id, record);
      change.set.push(record.id);
    }
    for (const id of patch.delete ?? []) if (records.delete(id)) change.deleted.push(id);
    for (const [key, value] of Object.entries(patch.meta ?? {})) {
      if (value === null) meta.delete(key);
      else meta.set(key, value);
      (change.meta ??= []).push(key);
    }
    return change;
  }

  function notify(change: WorkingCopyChange) {
    for (const w of watchers) w(change);
    for (const s of subscribers) s(records);
  }

  async function write(patch: WorkingCopyPatch) {
    if (!options.canWrite())
      throw new Error('Silk: only the active GM writes the Silk Working Copy');
    for (const record of patch.set ?? [])
      if (!RECORD_ID.test(record.id) || RESERVED.has(record.id))
        throw new Error(`Silk: invalid record id "${record.id}"`);
    const empty =
      !patch.set?.length &&
      !patch.delete?.length &&
      patch.binding === undefined &&
      !Object.keys(patch.meta ?? {}).length;
    if (empty) return;
    notify(apply(patch));
    const pending = queue.then(() => backend.write(patch));
    queue = pending.catch(() => {});
    await pending;
  }

  return {
    get binding() {
      return binding;
    },
    get: (id) => records.get(id),
    records: () => records,
    set: (rs) => write({ set: rs }),
    delete: (ids) => write({ delete: ids.filter((id) => records.has(id)) }),
    async replaceAll(snapshot) {
      const set = [...snapshot.values()].filter((r) => {
        const current = records.get(r.id);
        return !current || canonicalJson(current) !== canonicalJson(r);
      });
      const del = [...records.keys()].filter((id) => !snapshot.has(id));
      const patch: WorkingCopyPatch = {};
      if (set.length) patch.set = set;
      if (del.length) patch.delete = del;
      await write(patch);
    },
    setBinding: (b) => write({ binding: b }),
    meta: (key) => meta.get(key),
    setMeta: (key, value) => write({ meta: { [key]: value } }),
    watch(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    subscribe(run) {
      subscribers.add(run);
      run(records);
      return () => subscribers.delete(run);
    },
    applyRemote(patch) {
      notify(apply(patch));
    },
    reload() {
      const before = new Set(records.keys());
      load();
      notify({
        set: [...records.keys()],
        deleted: [...before].filter((id) => !records.has(id)),
        binding: true,
      });
    },
  };
}
