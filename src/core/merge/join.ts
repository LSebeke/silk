/**
 * Join Campaigns (spec §11.5): review of the target Campaign's Revelation Map plus the
 * source's in the merge window. Pure; `createMerges` runs the session (draft kind `'join'`).
 *
 * - One row per map item (element Reveal, Appearance, Info Block, Connection, Player Note) of
 *   the records in this World's working copy. `ours` = target, `theirs` = source, no base.
 *   Values are `true` (Revealed) or absent.
 * - The default Result is the union: target-only and source-only items are auto-merges,
 *   overridable per row (pick the side without it to drop it). Source items carry
 *   `from` = the source Campaign's name.
 * - Items of records not in this World stay in the union, unshown.
 */
import type { CanonRecord, Pick, Snapshot } from '../canon';
import {
  isRevealed,
  setRevealed,
  unionRevelationMaps,
  type RevealKind,
  type RevelationMap,
} from '../campaigns';
import type { FieldRef, FieldView, RecordView } from './merges';
import type { MergeRow } from './rows';

export interface JoinDraft {
  kind: 'join';
  sourceId: string;
  targetId: string;
  /** "Close source Campaign" (default on). */
  closeSource: boolean;
  picks: Pick[];
  cursor?: FieldRef;
}

interface Item {
  field: string;
  kind: RevealKind;
  id: string;
  label: string;
}

const SECTION: Record<RevealKind, string> = {
  element: 'SILK.Merge.Join.element',
  appearance: 'SILK.Merge.Join.appearance',
  infoBlock: 'SILK.Merge.Join.infoBlock',
  connection: 'SILK.Merge.Join.connection',
  playerNote: 'SILK.Merge.Join.playerNote',
};

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
const entries = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter(
    (x): x is { _id: string; name?: unknown; text?: unknown } =>
      typeof x === 'object' && x !== null && typeof (x as { _id?: unknown })._id === 'string',
  );

/** Every map item a record can have. */
function itemsOf(record: CanonRecord): Item[] {
  const name = str(record.data.name ?? record.data.label, record.id);
  if (record.kind === 'connection')
    return [{ field: '/revealed', kind: 'connection', id: record.id, label: name }];
  if (record.kind !== 'element') return [];
  return [
    { field: '/revealed', kind: 'element', id: record.id, label: name },
    { field: '/appearance', kind: 'appearance', id: record.id, label: name },
    ...entries(record.data.infoBlocks).map((b): Item => ({
      field: `/infoBlocks/${b._id}`,
      kind: 'infoBlock',
      id: b._id,
      label: str(b.name, b._id),
    })),
    ...entries(record.data.playerNotes).map((n): Item => ({
      field: `/playerNotes/${n._id}`,
      kind: 'playerNote',
      id: n._id,
      label: str(n.name, str(n.text, n._id).slice(0, 60)),
    })),
  ];
}

const lastPick = (picks: readonly Pick[], recordId: string, field: string) =>
  picks.findLast((p) => p.recordId === recordId && p.field === field);

function valueOf(pick: Pick | undefined, inTarget: boolean, inSource: boolean): boolean {
  if (!pick || !('side' in pick)) return inTarget || inSource;
  return pick.side === 'ours' ? inTarget : pick.side === 'theirs' ? inSource : false;
}

/** Drawer records: every element, Connection and Visual Group, with its map items as rows. */
export function joinRecords(
  records: Snapshot,
  target: RevelationMap,
  source: RevelationMap,
  picks: readonly Pick[],
  sourceName: string,
): RecordView[] {
  const out: RecordView[] = [];
  for (const record of records.values()) {
    if (!['element', 'connection', 'layoutGroup'].includes(record.kind)) continue;
    const fields: FieldView[] = [];
    const rows: MergeRow[] = [];
    for (const item of itemsOf(record)) {
      const inTarget = isRevealed(target, item.kind, item.id);
      const inSource = isRevealed(source, item.kind, item.id);
      if (!inTarget && !inSource) continue;
      const pick = lastPick(picks, record.id, item.field);
      const result = valueOf(pick, inTarget, inSource) || undefined;
      const field: FieldView = {
        field: item.field,
        ...(inTarget && { ours: true }),
        ...(inSource && { theirs: true }),
        change: inTarget && inSource ? 'both' : inTarget ? 'ours' : 'theirs',
        auto: inTarget ? 'ours' : 'theirs',
        ...(pick && { pick }),
        ...(result && { result }),
        open: false,
        text: false,
        canonOnly: false,
      };
      fields.push(field);
      rows.push({
        recordId: record.id,
        field: item.field,
        kind: 'field',
        section: SECTION[item.kind],
        label: item.label,
        ...(inTarget && { ours: true }),
        ...(inSource && { theirs: true }),
        ...(result && { result }),
        fields: [field],
        open: false,
        conflict: false,
        layout: false,
        canonOnly: false,
        text: false,
        ...(inSource && { from: sourceName }),
      });
    }
    const order = (a: { field: string }, b: { field: string }) => a.field.localeCompare(b.field);
    if (!fields.length) continue;
    fields.sort(order);
    rows.sort(order);
    out.push({
      id: record.id,
      kind: record.kind,
      badge: fields.some((f) => f.change === 'theirs') ? 'added' : 'same',
      open: 0,
      fields,
      rows,
      result: record,
      display: record,
    });
  }
  return out;
}

/** The target's new map: the union, minus what the picks dropped. */
export function joinResult(
  records: Snapshot,
  target: RevelationMap,
  source: RevelationMap,
  picks: readonly Pick[],
): RevelationMap {
  let map = unionRevelationMaps(target, source);
  for (const record of records.values())
    for (const item of itemsOf(record)) {
      const pick = lastPick(picks, record.id, item.field);
      if (!pick) continue;
      const value = valueOf(
        pick,
        isRevealed(target, item.kind, item.id),
        isRevealed(source, item.kind, item.id),
      );
      map = setRevealed(map, item.kind, item.id, value);
    }
  return map;
}
