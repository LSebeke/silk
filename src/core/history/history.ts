/**
 * Canon binding, Commit and discard (spec §11.3). Ties the World's Silk Working Copy
 * to its Canon store. Pure core: files and the working copy are injected.
 */
import {
  canonicalJson,
  createCanon,
  openCanon,
  type CanonFiles,
  type CanonStore,
  type Commit,
  type Snapshot,
} from '../canon';
import type { WorkingCopy } from '../working-copy';

export interface HistoryDeps {
  files: CanonFiles;
  workingCopy: WorkingCopy;
  /** Commit author, e.g. the GM's user name. */
  author(): string;
  /** Written to a new Canon's manifest, e.g. `silk 1.2.0`. */
  createdWith: string;
}

export interface History {
  /** `canon.create`: create a Canon and bind this World to it (main checked out). */
  createCanon(args: { name: string }): Promise<{ canonId: string }>;
  /** `canon.bind`: bind this World to an existing Canon and check out main. */
  bind(args: { canonId: string }): Promise<void>;
  /** `history.commit`: returns the new head (or the old one when clean). */
  commit(args: { label?: string }): Promise<string>;
  /** `history.discard`: reset the working copy to the last Commit. */
  discard(): Promise<void>;
  /** Working copy differs from the last Commit. */
  isDirty(): Promise<boolean>;
  /** Commits from the head back, newest first (history is linear). */
  log(): Promise<(Commit & { hash: string })[]>;
  /** The bound Canon, or `null` for a fresh World. */
  canon(): Promise<CanonStore | null>;
}

export function createHistory(deps: HistoryDeps): History {
  const { files, workingCopy } = deps;
  let store: CanonStore | null = null;
  /** Snapshot at `binding.head`, cached per head. */
  let headCache: { head: string | null; snapshot: Snapshot } | null = null;

  function requireBinding() {
    const binding = workingCopy.binding;
    if (!binding) throw new Error('Silk: this World is not bound to a Canon yet');
    return binding;
  }

  function requireUnbound() {
    if (workingCopy.binding)
      throw new Error('Silk: this World is already bound to a Canon (bound for life)');
  }

  async function canon(): Promise<CanonStore | null> {
    const binding = workingCopy.binding;
    if (!binding) return null;
    if (store?.manifest.id !== binding.canonId) store = await openCanon(files, binding.canonId);
    return store;
  }

  async function requireCanon(): Promise<CanonStore> {
    const opened = await canon();
    if (!opened) throw new Error('Silk: this World is not bound to a Canon yet');
    return opened;
  }

  async function headSnapshot(): Promise<Snapshot> {
    const { head } = requireBinding();
    if (headCache?.head !== head) {
      const snapshot = head ? await (await requireCanon()).readSnapshot(head) : new Map();
      headCache = { head, snapshot };
    }
    return headCache.snapshot;
  }

  async function isDirty() {
    const base = await headSnapshot();
    const current = workingCopy.records();
    if (base.size !== current.size) return true;
    for (const [id, record] of current) {
      const other = base.get(id);
      if (!other || canonicalJson(other) !== canonicalJson(record)) return true;
    }
    return false;
  }

  return {
    async createCanon({ name }) {
      requireUnbound();
      store = await createCanon(files, { name, createdWith: deps.createdWith });
      const canonId = store.manifest.id;
      await workingCopy.setBinding({ canonId, checkout: { main: true }, head: null });
      return { canonId };
    },

    async bind({ canonId }) {
      requireUnbound();
      const opened = await openCanon(files, canonId);
      const head = await opened.getMain();
      const snapshot = head ? await opened.readSnapshot(head) : new Map();
      store = opened;
      headCache = { head, snapshot };
      await workingCopy.replaceAll(snapshot);
      await workingCopy.setBinding({ canonId, checkout: { main: true }, head });
    },

    async commit({ label }) {
      const binding = requireBinding();
      if (binding.head && !(await isDirty())) return binding.head;
      const snapshot = new Map(workingCopy.records());
      const hash = await (
        await requireCanon()
      ).commit({
        snapshot,
        parents: binding.head ? [binding.head] : [],
        label: label ?? '',
        author: deps.author(),
        ref:
          'adventure' in binding.checkout
            ? { adventure: binding.checkout.adventure }
            : { main: true },
      });
      headCache = { head: hash, snapshot };
      await workingCopy.setBinding({ ...binding, head: hash });
      return hash;
    },

    async discard() {
      await workingCopy.replaceAll(await headSnapshot());
    },

    isDirty,

    async log() {
      const store = await canon();
      const out: (Commit & { hash: string })[] = [];
      for (let hash = requireBinding().head; hash && store;) {
        const commit = await store.readCommit(hash);
        out.push({ ...commit, hash });
        hash = commit.parents[0] ?? null;
      }
      return out;
    },

    canon,
  };
}
