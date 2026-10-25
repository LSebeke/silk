/**
 * Merge view → Svelte Flow Nodes and edges for the canvas diff (spec §11.4). Pure. Reuses the
 * World Canvas models (`toFlowNodes`, `toGroupNodes`, `toFlowEdges`) over the merged result,
 * plus deleted records (struck through), badges and outlines of the Canon-side positions.
 */
import type { Node } from '@xyflow/svelte';
import type { CanonRecord, JsonValue } from '../../core/canon';
import type { Badge, FieldView, MergeView, RecordView } from '../../core/merge';
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
export type OutlineNode = Node<{ label: string }, 'outline'>;
export type MergeEdge = ConnectionEdge & {
  data: ConnectionEdge['data'] & { badge: Badge; deleted: boolean; open: number };
};

const badgeOf = (r: RecordView, opts: MergeOptions): Badge =>
  r.badge === 'canonOnly' && !opts.showCanonOnly ? 'same' : r.badge;

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
        badge: r ? badgeOf(r, opts) : 'same',
        open: r?.open ?? 0,
        deleted: !r?.result,
      },
    };
  });
  const outlines: OutlineNode[] = [];
  for (const r of view.records) {
    const moved = r.fields.find((f) => f.field === '/position');
    const canon = moved?.ours as Point | undefined;
    if (!moved || !canon || JSON.stringify(canon) === JSON.stringify(moved.result)) continue;
    if (moved.canonOnly && !opts.showCanonOnly) continue;
    outlines.push({
      id: `${r.id}~outline`,
      type: 'outline',
      position: { x: canon.x, y: canon.y },
      selectable: false,
      draggable: false,
      zIndex: -500,
      data: { label: String(r.display.data.name ?? '') },
    });
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

/** Starting text for "Write combined text": Canon then Adventure. */
export function combinedText(f: FieldView): string {
  return [f.ours, f.theirs]
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .join('\n');
}
