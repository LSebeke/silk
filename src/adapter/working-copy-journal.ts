/**
 * Silk Working Copy storage (spec §11.3): a hidden JournalEntry (default NONE) in a
 * "Silk (internal)" folder. One `flags.silk.records.<id>` per record, so updates are
 * diffs. Values are JSON strings so Foundry's update merge replaces them whole.
 */
import { canonicalJson, type CanonRecord, type RecordKind, type JsonObject } from '../core/canon';
import type {
  Binding,
  WorkingCopyBackend,
  WorkingCopyPatch,
  WorkingCopyState,
} from '../core/working-copy';

/** Update options Silk passes on its own writes, so its hooks can ignore them (spec §2). */
export const SILK_WRITE = { silk: { internal: true } } as const;

export function isSilkWrite(options: unknown): boolean {
  return (options as { silk?: { internal?: boolean } } | null)?.silk?.internal === true;
}

/** Hooks fire on every client; Silk's follow-up writes run only here (spec §7). */
export function isActiveGM(game: {
  user: { id: string | null; isGM: boolean } | null | undefined;
  users: { activeGM: { id: string | null } | null | undefined } | undefined;
}): boolean {
  return !!game.user?.isGM && !!game.user.id && game.users?.activeGM?.id === game.user.id;
}

interface SilkFlags {
  workingCopy?: boolean;
  binding?: string | null;
  records?: Record<string, unknown>;
}

export interface JournalLike {
  id: string | null;
  flags: { silk?: SilkFlags } & Record<string, unknown>;
  update(data: object, options: object): Promise<unknown>;
}

export function isWorkingCopyJournal(doc: { flags?: unknown }): boolean {
  return (doc.flags as { silk?: SilkFlags } | undefined)?.silk?.workingCopy === true;
}

const encodeRecord = (r: CanonRecord) => canonicalJson({ kind: r.kind, data: r.data });

function decodeRecord(id: string, text: string): CanonRecord {
  const { kind, data } = JSON.parse(text) as { kind: RecordKind; data: JsonObject };
  return { kind, id, data };
}

const decodeBinding = (value: unknown): Binding | null =>
  typeof value === 'string' && value ? (JSON.parse(value) as Binding) : null;

/** Journal flags → patch. `silk` is either the full flags or an update's diff of them. */
function patchFromFlags(silk: SilkFlags): WorkingCopyPatch {
  const patch: WorkingCopyPatch = {};
  if ('binding' in silk) patch.binding = decodeBinding(silk.binding);
  const set: CanonRecord[] = [];
  const del: string[] = [];
  // Records are always strings. Anything else is a deletion: `-=id` locally, a
  // ForcedDeletion operator in the diff other clients receive (v14).
  for (const [key, value] of Object.entries(silk.records ?? {})) {
    if (key.startsWith('-=')) del.push(key.slice(2));
    else if (typeof value === 'string') set.push(decodeRecord(key, value));
    else del.push(key);
  }
  if (set.length) patch.set = set;
  if (del.length) patch.delete = del;
  return patch;
}

export function journalBackend(entry: () => JournalLike | undefined): WorkingCopyBackend {
  return {
    load(): WorkingCopyState {
      const silk = entry()?.flags.silk;
      if (!silk) return { binding: null, records: [] };
      const patch = patchFromFlags(silk);
      return { binding: patch.binding ?? null, records: patch.set ?? [] };
    },
    async write(patch) {
      const doc = entry();
      if (!doc) throw new Error('Silk: the Silk Working Copy journal is missing');
      const silk: Record<string, unknown> = {};
      if (patch.binding !== undefined)
        silk.binding = patch.binding ? canonicalJson(patch.binding) : null;
      const records: Record<string, string | null> = {};
      for (const r of patch.set ?? []) records[r.id] = encodeRecord(r);
      for (const id of patch.delete ?? []) records[`-=${id}`] = null;
      if (Object.keys(records).length) silk.records = records;
      await doc.update({ flags: { silk } }, SILK_WRITE);
    },
  };
}

/**
 * For `updateJournalEntry`: the patch another client wrote to the working copy, or
 * `null` when it's not the working copy or it's this client's own Silk write (already
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
  if (isSilkWrite(options) && userId === selfId) return null;
  const silk = (changed as { flags?: { silk?: SilkFlags } }).flags?.silk;
  return silk ? patchFromFlags(silk) : null;
}

export const FOLDER_NAME = 'Silk (internal)';
export const JOURNAL_NAME = 'Silk Working Copy';

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
    flags: { silk: { workingCopy: true, records: {} } },
  });
}
