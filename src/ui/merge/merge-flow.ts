/**
 * Merge view → Svelte Flow Nodes and edges for the canvas diff (spec §11.4). Pure. Reuses the
 * World Canvas models (`toFlowNodes`, `toGroupNodes`, `toFlowEdges`) over the merged result,
 * plus deleted records (struck through), badges and outlines of the Canon-side positions.
 */
import type { Node } from '@xyflow/svelte';
import type { CanonRecord, JsonValue, Side } from '../../core/canon';
import type { Badge, FieldView, MergeRow, MergeView, RecordView } from '../../core/merge';
import type { Point } from '../../core/elements';
import { toFlowEdges, type ConnectionEdge } from '../canvas/flow-edges';
import {
  toFlowNodes,
  toGroupNodes,
  type ElementNodeData,
  type GroupNode,
} from '../canvas/flow-model';

export interface MergeOptions {
  /** Show Canon-only changes (spec §11.4 toggle). */
  showCanonOnly: boolean;
  /** Record whose drawer is open. */
  selected?: string;
}

export interface MergeNodeData extends ElementNodeData {
  badge: Badge;
  /** Open conflicts. */
  open: number;
  /** Absent from the result. */
  deleted: boolean;
}

export type MergeNode = Node<MergeNodeData, 'element'>;
export type OutlineNode = Node<{ label: string; side: 'ours' | 'theirs' }, 'outline'>;
export type MergeEdge = ConnectionEdge & {
  data: ConnectionEdge['data'] & { badge: Badge; deleted: boolean; open: number };
};

const badgeOf = (r: RecordView, opts: MergeOptions): Badge =>
  r.badge === 'canonOnly' && !opts.showCanonOnly ? 'same' : r.badge;

const RANK: Record<Badge, number> = {
  same: 0,
  canonOnly: 1,
  layout: 2,
  changed: 3,
  deleted: 4,
  added: 4,
  conflict: 5,
};

/** Records attached to an element's Node: its sheet and Event Scene. */
const attachedTo = (view: MergeView, id: string) => view.records.filter((r) => r.owner === id);

/** A Node's badge and open conflicts, including its sheet and Event Scene. */
function nodeBadge(view: MergeView, r: RecordView, opts: MergeOptions) {
  let badge = badgeOf(r, opts);
  let open = r.open;
  for (const a of attachedTo(view, r.id)) {
    const b = badgeOf(a, opts);
    if (RANK[b] > RANK[badge]) badge = b === 'added' || b === 'deleted' ? 'changed' : b;
    open += a.open;
  }
  return { badge, open };
}

/** The Node a record shows on (sheets and Event Scenes: their element's). */
export function nodeOf(view: MergeView, recordId: string): string {
  return view.records.find((r) => r.id === recordId)?.owner ?? recordId;
}

/** The drawer's records for a selected record: its Node's record, then attached ones. */
export function drawerRecords(view: MergeView, recordId: string): RecordView[] {
  const id = nodeOf(view, recordId);
  const own = view.records.find((r) => r.id === id);
  return [...(own ? [own] : []), ...attachedTo(view, id)];
}

function displaySnapshot(view: MergeView): Map<string, CanonRecord> {
  return new Map(view.records.map((r) => [r.id, r.display]));
}

export function toMergeNodes(
  view: MergeView,
  opts: MergeOptions,
): (MergeNode | GroupNode | OutlineNode)[] {
  const records = displaySnapshot(view);
  const byId = new Map(view.records.map((r) => [r.id, r]));
  const selection = opts.selected ? [opts.selected] : [];
  const elements = toFlowNodes(records, selection, []).map((n): MergeNode => {
    const r = byId.get(n.id);
    return {
      ...n,
      data: {
        ...n.data,
        ...(r ? nodeBadge(view, r, opts) : { badge: 'same' as const, open: 0 }),
        deleted: !r?.result,
      },
    };
  });
  const outlines: OutlineNode[] = [];
  // Where the side not taken has the Node (spec §11.4 "Layout: outlines").
  for (const r of view.records) {
    const moved = r.fields.find((f) => f.field === '/position');
    if (!moved || (moved.canonOnly && !opts.showCanonOnly)) continue;
    const seen = new Set([JSON.stringify(moved.result)]);
    for (const side of ['ours', 'theirs'] as const) {
      const at = moved[side] as Point | undefined;
      if (!at || seen.has(JSON.stringify(at))) continue;
      seen.add(JSON.stringify(at));
      outlines.push({
        id: side === 'ours' ? `${r.id}~outline` : `${r.id}~outline-${side}`,
        type: 'outline',
        position: { x: at.x, y: at.y },
        selectable: false,
        draggable: false,
        zIndex: -500,
        data: { label: String(r.display.data.name ?? ''), side },
      });
    }
  }
  return [...toGroupNodes(records, selection, []), ...elements, ...outlines];
}

export function toMergeEdges(view: MergeView, opts: MergeOptions): MergeEdge[] {
  const byId = new Map(view.records.map((r) => [r.id, r]));
  return toFlowEdges(displaySnapshot(view), []).map((e) => {
    const r = byId.get(e.id);
    return {
      ...e,
      selected: e.id === opts.selected,
      data: {
        ...(e.data as ConnectionEdge['data'] & object),
        badge: r ? badgeOf(r, opts) : 'same',
        deleted: !r?.result,
        open: r?.open ?? 0,
      },
    } as MergeEdge;
  });
}

const unescape = (s: string) => s.replaceAll('~1', '/').replaceAll('~0', '~');

/** Human label of a field path; Info Blocks by name. T20 adds sheet sections via the adapter. */
export function fieldLabel(record: CanonRecord, field: string): string {
  const parts = field.slice(1).split('/').map(unescape);
  if (parts[0] === 'infoBlocks' && parts[1]) {
    const blocks = (record.data.infoBlocks ?? []) as { _id: string; name: string }[];
    const name = blocks.find((b) => b._id === parts[1])?.name ?? parts[1];
    return [name, ...parts.slice(2)].join(' · ');
  }
  return parts.join(' · ');
}

/** A value for a table cell; `undefined` = absent. */
export function formatValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** A row's cell value: tokens as position, collections as counts. */
export function formatRowValue(row: MergeRow, value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (row.kind === 'token' && value && typeof value === 'object' && !Array.isArray(value)) {
    const t = value as { x?: number; y?: number; hidden?: boolean };
    return `(${t.x ?? 0}, ${t.y ?? 0})${t.hidden ? ' hidden' : ''}`;
  }
  return formatValue(value);
}

/** Which side a field shows as chosen. */
export function chosenField(f: FieldView): Side | 'value' | null {
  if (f.pick) return 'side' in f.pick ? f.pick.side : 'value';
  return f.open ? null : f.auto;
}

/** Which side a row shows as chosen: the one all its fields took, else none. */
export function chosen(row: MergeRow): Side | 'value' | null {
  const sides = new Set(row.fields.map(chosenField));
  return sides.size === 1 ? ([...sides][0] ?? null) : null;
}

/** Rows grouped by section, sections in order of first appearance. */
export function sectionsOf(rows: readonly MergeRow[]): { section: string; rows: MergeRow[] }[] {
  const out = new Map<string, MergeRow[]>();
  for (const row of rows) out.set(row.section, [...(out.get(row.section) ?? []), row]);
  return [...out].map(([section, list]) => ({ section, rows: list }));
}

/** Starting text for "Write combined text": Canon then Adventure. */
export function combinedText(f: Pick<FieldView, 'ours' | 'theirs'>): string {
  return [f.ours, f.theirs]
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .join('\n');
}
