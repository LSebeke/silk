/**
 * Garn Working Copy storage (spec §11.3): a hidden JournalEntry (default NONE) in a
 * "Garn (internal)" folder. One `flags.garn.records.<id>` per record, so updates are
 * diffs. Values are JSON strings so Foundry's update merge replaces them whole.
 */
import {
  canonicalJson,
  type CanonRecord,
  type JsonObject,
  type JsonValue,
  type RecordKind,
} from '../core/canon';
import type {
  Binding,
  WorkingCopyBackend,
  WorkingCopyPatch,
  WorkingCopyState,
} from '../core/working-copy';

/**
 * Update options Garn passes on its own writes, so its hooks can ignore them (spec §2).
 * Foundry mutates the options object it is given: always pass a copy (`{ ...GARN_WRITE }`).
 */
export const GARN_WRITE = { garn: { internal: true } } as const;

export function isGarnWrite(options: unknown): boolean {
  return (options as { garn?: { internal?: boolean } } | null)?.garn?.internal === true;
}

/** Hooks fire on every client; Garn's follow-up writes run only here (spec §7). */
export function isActiveGM(game: {
  user: { id: string | null; isGM: boolean } | null | undefined;
  users: { activeGM: { id: string | null } | null | undefined } | undefined;
}): boolean {
  return !!game.user?.isGM && !!game.user.id && game.users?.activeGM?.id === game.user.id;
}

interface GarnFlags {
  workingCopy?: boolean;
  binding?: string | null;
  records?: Record<string, unknown>;
  /** World-only values (merge draft …), JSON strings like records. */
  meta?: Record<string, unknown>;
}

export interface JournalLike {
  id: string | null;
  flags: { garn?: GarnFlags } & Record<string, unknown>;
  update(data: object, options: object): Promise<unknown>;
}

export function isWorkingCopyJournal(doc: { flags?: unknown }): boolean {
  return (doc.flags as { garn?: GarnFlags } | undefined)?.garn?.workingCopy === true;
}

const encodeRecord = (r: CanonRecord) => canonicalJson({ kind: r.kind, data: r.data });

function decodeRecord(id: string, text: string): CanonRecord {
  const { kind, data } = JSON.parse(text) as { kind: RecordKind; data: JsonObject };
  return { kind, id, data };
}

const decodeBinding = (value: unknown): Binding | null =>
  typeof value === 'string' && value ? (JSON.parse(value) as Binding) : null;

/** Journal flags → patch. `garn` is either the full flags or an update's diff of them. */
function patchFromFlags(garn: GarnFlags): WorkingCopyPatch {
  const patch: WorkingCopyPatch = {};
  if ('binding' in garn) patch.binding = decodeBinding(garn.binding);
  const set: CanonRecord[] = [];
  const del: string[] = [];
  // Records are always strings. Anything else is a deletion: `-=id` locally, a
  // ForcedDeletion operator in the diff other clients receive (v14).
  for (const [key, value] of Object.entries(garn.records ?? {})) {
    if (key.startsWith('-=')) del.push(key.slice(2));
    else if (typeof value === 'string') set.push(decodeRecord(key, value));
    else del.push(key);
  }
  if (set.length) patch.set = set;
  if (del.length) patch.delete = del;
  const meta: Record<string, JsonValue | null> = {};
  for (const [key, value] of Object.entries(garn.meta ?? {})) {
    if (key.startsWith('-=')) meta[key.slice(2)] = null;
    else meta[key] = typeof value === 'string' ? (JSON.parse(value) as JsonValue) : null;
  }
  if (Object.keys(meta).length) patch.meta = meta;
  return patch;
}

export function journalBackend(entry: () => JournalLike | undefined): WorkingCopyBackend {
  return {
    load(): WorkingCopyState {
      const garn = entry()?.flags.garn;
      if (!garn) return { binding: null, records: [] };
      const patch = patchFromFlags(garn);
      const meta = Object.entries(patch.meta ?? {}).filter(
        (entry): entry is [string, JsonValue] => entry[1] !== null,
      );
      return {
        binding: patch.binding ?? null,
        records: patch.set ?? [],
        meta: Object.fromEntries(meta),
      };
    },
    async write(patch) {
      const doc = entry();
      if (!doc) throw new Error('Garn: the Garn Working Copy journal is missing');
      const garn: Record<string, unknown> = {};
      if (patch.binding !== undefined)
        garn.binding = patch.binding ? canonicalJson(patch.binding) : null;
      const records: Record<string, string | null> = {};
      for (const r of patch.set ?? []) records[r.id] = encodeRecord(r);
      for (const id of patch.delete ?? []) records[`-=${id}`] = null;
      if (Object.keys(records).length) garn.records = records;
      const meta: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(patch.meta ?? {}))
        if (value === null) meta[`-=${key}`] = null;
        else meta[key] = canonicalJson(value);
      if (Object.keys(meta).length) garn.meta = meta;
      await doc.update({ flags: { garn } }, { ...GARN_WRITE });
    },
  };
}

/**
 * For `updateJournalEntry`: the patch another client wrote to the working copy, or
 * `null` when it's not the working copy or it's this client's own Garn write (already
 * applied locally).
 */
export function remotePatch(
  doc: { flags?: unknown },
  changed: object,
  options: unknown,
  userId: string,
  selfId: string | null,
): WorkingCopyPatch | null {
  if (!isWorkingCopyJournal(doc)) return null;
  if (isGarnWrite(options) && userId === selfId) return null;
  const garn = (changed as { flags?: { garn?: GarnFlags } }).flags?.garn;
  return garn ? patchFromFlags(garn) : null;
}

export const FOLDER_NAME = 'Garn (internal)';
export const JOURNAL_NAME = 'Garn Working Copy';

export interface EnsureJournalDeps {
  find(): JournalLike | undefined;
  findFolder(): { id: string | null } | undefined;
  createFolder(data: { name: string; type: 'JournalEntry' }): Promise<{ id: string | null }>;
  createEntry(data: object): Promise<unknown>;
}

/** Active GM, on `ready`: create the folder and journal if missing. */
export async function ensureWorkingCopyJournal(deps: EnsureJournalDeps): Promise<void> {
  if (deps.find()) return;
  const folder =
    deps.findFolder() ?? (await deps.createFolder({ name: FOLDER_NAME, type: 'JournalEntry' }));
  await deps.createEntry({
    name: JOURNAL_NAME,
    folder: folder.id,
    ownership: { default: 0 },
    flags: { garn: { workingCopy: true, records: {} } },
  });
}
