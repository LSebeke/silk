/**
 * Merge sessions (spec §11.3 End Adventure, §11.4 Merge UI). Pure core over history,
 * working copy and Campaigns. The merge window renders `view()`; every UI action is one of
 * `endAdventure / pick / nextConflict / confirm / cancel` (commands in `./commands`).
 *
 * - The draft (which commits, the GM's picks, the cursor) lives in the World's Silk Working
 *   Copy as the meta value `mergeDraft`, so a merge can be resumed after a reload.
 * - `ours` is the side merged into (Canon now), `theirs` the incoming side (the Adventure =
 *   this World). Fields that only make sense in one World (doc uuids) always take the World's
 *   side and are not shown.
 * - Extension points: `MergeDraft.kind` (T21 Canon edit mode dirty load: `ours` = Canon
 *   incoming is swapped, columns via `MergeView.columns`; T22 Join Campaigns: no base column),
 *   `FieldView` grouping/labels (T20 sheets, Event Scenes, attribution chips).
 */
import {
  canonicalJson,
  mergeSnapshots,
  resolveMerge,
  valueAt,
  type AdventureRef,
  type CanonRecord,
  type CanonStore,
  type FieldDiff,
  type JsonValue,
  type MergeResult,
  type Pick,
  type RecordKind,
  type Resolution,
  type Snapshot,
} from '../canon';
import type { Campaigns } from '../campaigns';
import type { History } from '../history';
import type { WorkingCopy } from '../working-copy';
import { attribute, type CanonChange } from './attribution';
import { rowsOf, type Attribution, type MergeRow, type SheetSections } from './rows';

/** Working Copy meta key of the merge draft. */
export const MERGE_DRAFT = 'mergeDraft';

export interface FieldRef {
  recordId: string;
  field: string;
}

export interface MergeDraft {
  /**
   * `'adventure'`: End Adventure. `'canonEdit'`: Canon edit mode, main moved in another World
   * while this World had uncommitted changes (spec §11.3): base = this World's head, ours =
   * main now ("Canon (incoming)"), theirs = this World's working copy as an unreferenced
   * Commit ("This World"); `adventureId` is `''`. T22 adds `'join'`.
   */
  kind: 'adventure' | 'canonEdit';
  adventureId: string;
  /** Commit hashes: Adventure start, main now, Adventure head. `base` `''` = empty. */
  base: string;
  ours: string;
  theirs: string;
  picks: Pick[];
  /** Last conflict `nextConflict` went to. */
  cursor?: FieldRef;
}

/** How a record shows on the canvas diff (spec §11.4 badges). */
export type Badge = 'conflict' | 'added' | 'deleted' | 'changed' | 'layout' | 'canonOnly' | 'same';

export interface FieldView extends FieldDiff {
  /** The GM's pick, if any. */
  pick?: Pick;
  /** Value in the result (with picks). `undefined` = absent. */
  result?: JsonValue;
  /** Open conflict: no pick yet. */
  open: boolean;
  /** Text field (Info Block, Connection label): offers "Write combined text". */
  text: boolean;
  /** Changed on the Canon side only (hidden behind the canon-only toggle). */
  canonOnly: boolean;
  /** The Canon changed it since the Adventure started: by whom (spec §11.4 chip). */
  by?: Attribution;
}

export interface RecordView {
  id: string;
  kind: RecordKind;
  badge: Badge;
  /** Open conflicts in this record. */
  open: number;
  /** Delete vs edit, or added/deleted: the whole-record row (`field === ''`). */
  whole?: FieldView;
  fields: FieldView[];
  /** Drawer rows (spec §11.4): sections, tokens, counts. */
  rows: MergeRow[];
  /** Sheets and Event Scenes: the element they belong to (its Node opens them). */
  owner?: string;
  /** Result record (`undefined` = deleted in the result), else the best side for display. */
  result?: CanonRecord;
  display: CanonRecord;
}

export interface MergeCounts {
  conflicts: number;
  open: number;
  added: number;
  deleted: number;
  changed: number;
  canonOnly: number;
  layout: number;
  /** Layout fields the Adventure changed (Node moves, Visual Groups): shown as a count. */
  moves: number;
}

export interface ReceivedMerge {
  adventure: string;
  campaign: string;
  date: string;
  commit: string;
}

export interface MergeView {
  draft: MergeDraft;
  title: { adventure: string; campaign: string };
  /** i18n keys of the side columns. */
  columns: { base: string; ours: string; theirs: string };
  records: RecordView[];
  counts: MergeCounts;
  /** Merges main received since the Adventure started, oldest first. */
  received: ReceivedMerge[];
  resolution: Resolution;
}

export interface MergesDeps {
  history: History;
  workingCopy: WorkingCopy;
  campaigns: Campaigns;
  author(): string;
  /** ISO 8601; default now. */
  now?(): string;
  /**
   * Make the World match `result`: rewrite Materialized docs and replace the working copy
   * (adapter: `createDocRewriter`). Runs after the merge Commit, with main checked out.
   */
  applyResult(result: Snapshot): Promise<void>;
  /** Sheet section labels (the Game System adapter's, spec §2). */
  sections?: SheetSections;
}

/** Outcome of the Canon edit mode load sync. */
export type SyncResult = 'current' | 'fastForward' | 'merge';

export interface Merges {
  /**
   * On load under main (spec §11.3): main moved in another World → clean: fast-forward (the
   * World is rewritten to main); dirty: open (or resume) a `'canonEdit'` merge. Under an
   * Adventure, or main unchanged: `'current'`.
   */
  syncMain(): Promise<SyncResult>;
  /** `adventure.abandon`: `confirm` must be the Adventure's name. Resets to main's head. */
  abandon(args: { confirm: string }): Promise<void>;
  /** `adventure.end`: Commit, then start (or resume) the merge into main. */
  endAdventure(): Promise<MergeView>;
  /** The open merge, or `null`. */
  view(): Promise<MergeView | null>;
  /** `merge.pick` */
  pick(pick: Pick): Promise<void>;
  /** `merge.nextConflict`: the next open conflict after the cursor (wraps), or `null`. */
  nextConflict(): Promise<FieldRef | null>;
  /** `merge.confirm`: one Commit on main; the World checks out main. No undo. */
  confirm(): Promise<{ commit: string }>;
  /** `merge.cancel`: discard the draft; the Adventure stays checked out. */
  cancel(): Promise<void>;
}

/** Element fields that name this World's docs: never merged, the World keeps its own. */
const WORLD_LOCAL: Partial<Record<RecordKind, readonly string[]>> = {
  element: ['/uuid', '/restoredFrom'],
};

const isWorldLocal = (kind: RecordKind, field: string) =>
  WORLD_LOCAL[kind]?.includes(field) ?? false;

/** Info Block name/text and Connection labels are text (spec §11.4 "Write combined text"). */
export function isTextField(kind: RecordKind, field: string): boolean {
  if (kind === 'connection') return field === '/label';
  if (kind === 'element') return /^\/infoBlocks\/[^/]+\/(name|text)$/.test(field);
  return false;
}

function sameRecords(a: Snapshot, b: Snapshot): boolean {
  if (a.size !== b.size) return false;
  for (const [id, record] of a) {
    const other = b.get(id);
    if (!other || canonicalJson(other) !== canonicalJson(record)) return false;
  }
  return true;
}

const UNBOUND = 'Silk: this World is not bound to a Canon yet';

export function createMerges(deps: MergesDeps): Merges {
  const { history, workingCopy } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const snapshots = new Map<string, Snapshot>();
  let cached: { key: string; merge: MergeResult } | null = null;

  async function requireCanon(): Promise<CanonStore> {
    const canon = await history.canon();
    if (!canon) throw new Error(UNBOUND);
    return canon;
  }

  function draft(): MergeDraft | null {
    return (workingCopy.meta(MERGE_DRAFT) as unknown as MergeDraft | undefined) ?? null;
  }

  function requireDraft(): MergeDraft {
    const d = draft();
    if (!d) throw new Error('Silk: no merge is open');
    return d;
  }

  const saveDraft = (d: MergeDraft | null) =>
    workingCopy.setMeta(MERGE_DRAFT, d as unknown as JsonValue | null);

  async function snapshot(canon: CanonStore, hash: string) {
    if (!hash) return new Map() as Snapshot;
    let s = snapshots.get(hash);
    if (!s) {
      s = await canon.readSnapshot(hash);
      snapshots.set(hash, s);
    }
    return s;
  }

  async function mergeOf(d: MergeDraft): Promise<MergeResult> {
    const key = `${d.base}|${d.ours}|${d.theirs}`;
    if (cached?.key === key) return cached.merge;
    const canon = await requireCanon();
    const [base, ours, theirs] = await Promise.all(
      [d.base, d.ours, d.theirs].map((h) => snapshot(canon, h)),
    );
    const merge = mergeSnapshots(base as Snapshot, ours as Snapshot, theirs as Snapshot);
    // World-local fields take this World's side, silently.
    // Canon edit mode: this World is `theirs`, the incoming side is `ours` (layout: it wins).
    const world = 'theirs';
    const incoming = d.kind === 'canonEdit' ? 'ours' : 'theirs';
    for (const r of merge.records.values())
      for (const f of r.fields)
        if (isWorldLocal(r.kind, f.field)) f.auto = world;
        else if (f.layout && f.change === 'conflict') f.auto = incoming;
    cached = { key, merge };
    return merge;
  }

  /** Sheets of deleted elements go with them. */
  function resolve(merge: MergeResult, picks: readonly Pick[]): Resolution {
    const resolution = resolveMerge(merge, picks);
    const snapshot = new Map(resolution.snapshot);
    for (const [id, record] of snapshot) {
      const element = record.kind === 'sheet' ? record.data.element : undefined;
      if (typeof element === 'string' && !snapshot.has(element)) snapshot.delete(id);
    }
    return { ...resolution, snapshot };
  }

  async function adventureOf(d: MergeDraft): Promise<AdventureRef> {
    const ref = await (await requireCanon()).getAdventure(d.adventureId);
    if (!ref) throw new Error(`Silk: no Adventure "${d.adventureId}" in this Canon`);
    return ref;
  }

  async function campaignName(id: string) {
    return (await (await requireCanon()).getCampaign(id))?.name ?? id;
  }

  /** Main's Commits since the Adventure's base, newest first, attributed. */
  async function mainSince(
    d: MergeDraft,
  ): Promise<{ attribution: Attribution; parent?: string }[]> {
    const canon = await requireCanon();
    const refs = await canon.listAdventures();
    const out: { attribution: Attribution; parent?: string }[] = [];
    for (let hash: string | undefined = d.ours; hash && hash !== d.base;) {
      const commit = await canon.readCommit(hash);
      const ref = refs.find((r) => r.merged === hash);
      const parent = commit.parents[0];
      out.push({
        attribution: {
          commit: hash,
          date: ref?.ended ?? commit.date,
          label: commit.label,
          ...(ref && { adventure: ref.name, campaign: await campaignName(ref.campaignId) }),
        },
        ...(parent && { parent }),
      });
      hash = parent;
    }
    return out;
  }

  function received(since: { attribution: Attribution }[]): ReceivedMerge[] {
    const out: ReceivedMerge[] = [];
    for (const { attribution: a } of since)
      if (a.adventure !== undefined)
        out.push({
          adventure: a.adventure,
          campaign: a.campaign ?? '',
          date: a.date,
          commit: a.commit,
        });
    return out.reverse();
  }

  async function canonChanges(since: { attribution: Attribution; parent?: string }[]) {
    const canon = await requireCanon();
    const empty: Snapshot = new Map();
    return Promise.all(
      since.map(async ({ attribution, parent }): Promise<CanonChange> => ({
        attribution,
        snapshot: await snapshot(canon, attribution.commit),
        parent: parent ? await snapshot(canon, parent) : empty,
      })),
    );
  }

  async function buildView(d: MergeDraft): Promise<MergeView> {
    const merge = await mergeOf(d);
    const since = await mainSince(d);
    const changes = await canonChanges(since);
    const resolution = resolve(merge, d.picks);
    const open = new Set(resolution.unresolved.map((u) => `${u.recordId}\n${u.field}`));
    const counts: MergeCounts = {
      conflicts: 0,
      open: 0,
      added: 0,
      deleted: 0,
      changed: 0,
      canonOnly: 0,
      layout: 0,
      moves: 0,
    };
    const records: RecordView[] = [];
    for (const r of merge.records.values()) {
      const result = resolution.snapshot.get(r.id);
      const fields: FieldView[] = r.fields
        .filter((f) => !isWorldLocal(r.kind, f.field))
        .map((f) => {
          const pick = d.picks.findLast((p) => p.recordId === r.id && p.field === f.field);
          const by = f.change === 'theirs' ? undefined : attribute(changes, r.id, f.field);
          return {
            ...f,
            ...(pick && { pick }),
            result: valueAt(result?.data, f.field),
            open: open.has(`${r.id}\n${f.field}`),
            text: isTextField(r.kind, f.field),
            canonOnly: f.change === 'ours',
            ...(by && { by }),
          };
        });
      const openCount = fields.filter((f) => f.open).length;
      const whole = fields.find((f) => f.field === '');
      const conflict = fields.some((f) => f.change === 'conflict' && !f.layout);
      const adventureSide = fields.filter((f) => f.change !== 'ours');
      let badge: Badge;
      if (!fields.length) badge = 'same';
      else if (conflict) badge = 'conflict';
      else if (!adventureSide.length) badge = 'canonOnly';
      else if (!r.base && r.theirs) badge = 'added';
      else if (r.base && !r.theirs) badge = 'deleted';
      else if (adventureSide.every((f) => f.layout)) badge = 'layout';
      else badge = 'changed';
      if (badge !== 'same') counts[badge === 'conflict' ? 'conflicts' : badge]++;
      counts.open += openCount;
      counts.moves += fields.filter((f) => f.layout && f.change !== 'ours').length;
      const display = (result ?? r.theirs ?? r.ours ?? r.base) as CanonRecord;
      const owner =
        r.kind === 'sheet' || r.kind === 'eventScene' ? display.data.element : undefined;
      records.push({
        id: r.id,
        kind: r.kind,
        badge,
        open: openCount,
        ...(whole && { whole }),
        fields,
        rows: rowsOf(r, result, fields, deps.sections),
        ...(typeof owner === 'string' && { owner }),
        ...(result && { result }),
        display,
      });
    }
    const canonEdit = d.kind === 'canonEdit';
    const adventure = canonEdit ? null : await adventureOf(d);
    return {
      draft: d,
      title: adventure
        ? { adventure: adventure.name, campaign: await campaignName(adventure.campaignId) }
        : { adventure: (await requireCanon()).manifest.name, campaign: '' },
      columns: {
        base: 'SILK.Merge.Base',
        ours: canonEdit ? 'SILK.Merge.CanonIncoming' : 'SILK.Merge.CanonNow',
        theirs: canonEdit ? 'SILK.Merge.ThisWorld' : 'SILK.Merge.Adventure',
      },
      records,
      counts,
      received: received(since),
      resolution,
    };
  }

  async function checkedOutAdventure(): Promise<AdventureRef> {
    const checkout = workingCopy.binding?.checkout;
    if (!checkout) throw new Error(UNBOUND);
    if (!('adventure' in checkout))
      throw new Error('Silk: no Adventure is checked out; there is nothing to end');
    const ref = await (await requireCanon()).getAdventure(checkout.adventure);
    if (!ref) throw new Error(`Silk: no Adventure "${checkout.adventure}" in this Canon`);
    return ref;
  }

  return {
    async endAdventure() {
      const adventure = await checkedOutAdventure();
      const theirs = await history.commit({ label: 'Before merge' });
      const ours = await (await requireCanon()).getMain();
      if (!ours) throw new Error('Silk: main has no Commit');
      const previous = draft();
      const resumed = previous?.adventureId === adventure.id ? previous : null;
      const next: MergeDraft = {
        kind: 'adventure',
        adventureId: adventure.id,
        base: adventure.base,
        ours,
        theirs,
        picks: resumed?.picks ?? [],
        ...(resumed?.cursor && { cursor: resumed.cursor }),
      };
      if (JSON.stringify(next) !== JSON.stringify(previous)) await saveDraft(next);
      return buildView(next);
    },

    async syncMain() {
      const binding = workingCopy.binding;
      if (!binding || !('main' in binding.checkout)) return 'current';
      const canon = await requireCanon();
      const main = await canon.getMain();
      const head = binding.head ?? '';
      if (!main || main === head) {
        if (draft()?.kind === 'canonEdit') await saveDraft(null);
        return 'current';
      }
      if (!(await history.isDirty())) {
        const result = await snapshot(canon, main);
        await workingCopy.setBinding({ ...binding, head: main });
        await deps.applyResult(result);
        if (draft()) await saveDraft(null);
        return 'fastForward';
      }
      const previous = draft();
      const resumed = previous?.kind === 'canonEdit' ? previous : null;
      if (
        resumed?.ours === main &&
        resumed.base === head &&
        sameRecords(workingCopy.records(), await snapshot(canon, resumed.theirs))
      )
        return 'merge';
      const theirs = await history.snapshotCommit({ label: 'This World' });
      await saveDraft({
        kind: 'canonEdit',
        adventureId: '',
        base: head,
        ours: main,
        theirs,
        picks: resumed?.picks ?? [],
        ...(resumed?.cursor && { cursor: resumed.cursor }),
      });
      return 'merge';
    },

    async abandon({ confirm }) {
      const adventure = await checkedOutAdventure();
      if (confirm !== adventure.name)
        throw new Error(`Silk: type the Adventure name "${adventure.name}" to abandon it`);
      const canon = await requireCanon();
      const main = await canon.getMain();
      if (!main) throw new Error('Silk: main has no Commit');
      const binding = workingCopy.binding;
      if (!binding) throw new Error(UNBOUND);
      await canon.writeAdventure({ ...adventure, abandoned: now() });
      await saveDraft(null);
      await workingCopy.setBinding({ ...binding, checkout: { main: true }, head: main });
      await deps.applyResult(await snapshot(canon, main));
    },

    async view() {
      const d = draft();
      return d ? buildView(d) : null;
    },

    async pick(pick) {
      const d = requireDraft();
      const merge = await mergeOf(d);
      if (!merge.records.has(pick.recordId))
        throw new Error(`Silk: no record "${pick.recordId}" in this merge`);
      if (isWorldLocal(merge.records.get(pick.recordId)?.kind ?? 'element', pick.field))
        throw new Error(`Silk: "${pick.field}" belongs to this World and is not merged`);
      // A row covering several fields (an Event Scene token): take the side for each.
      const record = merge.records.get(pick.recordId);
      const covered =
        pick.field !== '' && 'side' in pick && !record?.fields.some((f) => f.field === pick.field)
          ? (record?.fields ?? []).filter((f) => f.field.startsWith(`${pick.field}/`))
          : [];
      const each: Pick[] = covered.length
        ? covered.map((f) => ({ ...pick, field: f.field }))
        : [pick];
      const fields = new Set(each.map((p) => p.field));
      const picks = d.picks.filter((p) => p.recordId !== pick.recordId || !fields.has(p.field));
      await saveDraft({ ...d, picks: [...picks, ...each] });
    },

    async nextConflict() {
      const d = requireDraft();
      const { unresolved } = resolve(await mergeOf(d), d.picks);
      if (!unresolved.length) return null;
      const order = (u: FieldRef) => `${u.recordId}\n${u.field}`;
      const after = d.cursor ? order(d.cursor) : '';
      const next = unresolved.find((u) => order(u) > after) ?? (unresolved[0] as FieldRef);
      await saveDraft({ ...d, cursor: { recordId: next.recordId, field: next.field } });
      return { recordId: next.recordId, field: next.field };
    },

    async confirm() {
      const d = requireDraft();
      const canon = await requireCanon();
      const { snapshot, unresolved } = resolve(await mergeOf(d), d.picks);
      if (unresolved.length)
        throw new Error(`Silk: ${unresolved.length} conflict(s) left; pick a side for each first`);
      if ((await canon.getMain()) !== d.ours)
        throw new Error('Silk: main moved on since this merge started; end the Adventure again');
      const binding = workingCopy.binding;
      if (!binding) throw new Error(UNBOUND);
      const adventure = d.kind === 'canonEdit' ? null : await adventureOf(d);
      const label = adventure
        ? `Merge ${adventure.name} (${await campaignName(adventure.campaignId)})`
        : 'Merge this World';
      const commit = await canon.commit({
        snapshot,
        parents: [d.ours, d.theirs],
        label,
        author: deps.author(),
        ref: { main: true },
      });
      if (adventure) await canon.writeAdventure({ ...adventure, merged: commit, ended: now() });
      await workingCopy.setBinding({ ...binding, checkout: { main: true }, head: commit });
      await deps.applyResult(snapshot);
      await saveDraft(null);
      return { commit };
    },

    async cancel() {
      if (draft()) await saveDraft(null);
    },
  };
}
