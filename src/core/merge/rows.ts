/**
 * Drawer rows of a merge record (spec §11.4): field diffs grouped into labelled sections.
 * Pure.
 *
 * - Sheets: `system` fields by the adapter's section labels (`SheetSections`, DSA5 in
 *   `src/adapter/dsa5.ts`); embedded Items are matched by id and grouped by Item type.
 * - Event Scenes: one row per token (matched by id, all its fields), one count-only row per
 *   other embedded collection (walls, lights, …).
 * - A row covering several fields is picked as a whole: `merge.pick` with the row's `field`
 *   (a prefix) takes that side for each of them.
 */
import { valueAt, type CanonRecord, type JsonObject, type JsonValue } from '../canon';
import type { RecordMerge, Side } from '../canon';
import type { FieldView } from './merges';

/** Sheet section labels (i18n keys); the Game System adapter owns them (spec §2). */
export interface SheetSections {
  /** Section of a `system` field; `path` is below `system`. */
  system(doc: { documentName: string; type?: string }, path: readonly string[]): string;
  /** Section of an embedded Item. */
  item(type: string | undefined): string;
}

export const DEFAULT_SECTIONS: SheetSections = {
  system: () => 'SILK.Merge.Section.system',
  item: () => 'SILK.Merge.Section.items',
};

/** Who changed a field in the Canon since the Adventure started (spec §11.4 chip). */
export interface Attribution {
  commit: string;
  /** ISO 8601. */
  date: string;
  /** Merge commits: the Adventure and its Campaign. */
  adventure?: string;
  campaign?: string;
  /** Other Commits (Canon edit mode): their label. */
  label: string;
}

export interface MergeRow {
  recordId: string;
  /** The field, or the prefix of the fields this row covers. `merge.pick` takes it. */
  field: string;
  /** `token`: one Event Scene token; `count`: an embedded collection, as counts. */
  kind: 'field' | 'token' | 'count';
  /** i18n key. */
  section: string;
  label: string;
  /** Display values; tokens `{x, y, hidden}`, counts a number. `undefined` = absent. */
  base?: JsonValue;
  ours?: JsonValue;
  theirs?: JsonValue;
  result?: JsonValue;
  fields: FieldView[];
  open: boolean;
  /** Needs a decision: a conflict that is not layout. */
  conflict: boolean;
  layout: boolean;
  canonOnly: boolean;
  /** One text field: offers "Write combined text". */
  text: boolean;
  /** Newest Canon change among its fields. */
  by?: Attribution;
  /** Join Campaigns: the item is in the source Campaign's map (its name, "from <source>" chip). */
  from?: string;
}

const unescape = (s: string) => s.replaceAll('~1', '/').replaceAll('~0', '~');
const parts = (field: string) => (field ? field.slice(1).split('/').map(unescape) : []);
const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface Group {
  field: string;
  kind: MergeRow['kind'];
  section: string;
  label: string;
}

type Sides = Pick<RecordMerge, 'base' | 'ours' | 'theirs'> & { result?: CanonRecord };
const SIDES = ['base', 'ours', 'theirs', 'result'] as const;

/** Entry `_id` of an id-keyed array on any side. */
function entry(sides: Sides, path: string, id: string): JsonObject | undefined {
  for (const side of SIDES) {
    const list = valueAt(sides[side]?.data, path);
    const found = Array.isArray(list) && list.find((x) => isObject(x) && x._id === id);
    if (found && isObject(found)) return found;
  }
  return undefined;
}

const nameOf = (o: JsonObject | undefined, id: string) =>
  typeof o?.name === 'string' && o.name ? o.name : id;

function elementGroup(record: Sides, field: string): Group {
  const [top, id, ...rest] = parts(field);
  if (top === 'infoBlocks' && id) {
    const block = entry(record, '/infoBlocks', id);
    return {
      field,
      kind: 'field',
      section: 'SILK.Merge.Section.infoBlocks',
      label: [nameOf(block, id), ...rest].join(' · '),
    };
  }
  if (top === 'position' || top === 'group')
    return {
      field,
      kind: 'field',
      section: 'SILK.Merge.Section.layout',
      label: parts(field).join(' · '),
    };
  return {
    field,
    kind: 'field',
    section: 'SILK.Merge.Section.element',
    label: parts(field).join(' · '),
  };
}

function sheetGroup(record: Sides, field: string, sections: SheetSections): Group {
  const [root, key, id, ...rest] = parts(field);
  const any = (record.result ?? record.theirs ?? record.ours ?? record.base)?.data;
  const doc = isObject(any?.[root ?? '']) ? (any?.[root ?? ''] as JsonObject) : undefined;
  const label = parts(field).slice(1).join(' · ');
  if (root === 'doc' && key === 'system' && id !== undefined)
    return {
      field,
      kind: 'field',
      section: sections.system(
        {
          documentName: String(any?.documentName ?? ''),
          ...(typeof doc?.type === 'string' && { type: doc.type }),
        },
        [id, ...rest],
      ),
      label: [id, ...rest].join(' · '),
    };
  if (root === 'doc' && key === 'items' && id !== undefined) {
    const item = entry(record, '/doc/items', id);
    return {
      field,
      kind: 'field',
      section: sections.item(typeof item?.type === 'string' ? item.type : undefined),
      label: [nameOf(item, id), ...rest].join(' · '),
    };
  }
  if (root === 'doc' && key === 'effects' && id !== undefined)
    return {
      field,
      kind: 'field',
      section: 'SILK.Merge.Section.effects',
      label: [nameOf(entry(record, '/doc/effects', id), id), ...rest].join(' · '),
    };
  if (root === 'companion')
    return { field, kind: 'field', section: 'SILK.Merge.Section.companion', label };
  return { field, kind: 'field', section: 'SILK.Merge.Section.doc', label: label || field };
}

function sceneGroup(record: Sides, field: string): Group {
  const [root, key, id] = parts(field);
  if (root === 'scene' && key === 'tokens' && id !== undefined)
    return {
      field: `/scene/tokens/${id}`,
      kind: 'token',
      section: 'SILK.Merge.Section.tokens',
      label: nameOf(entry(record, '/scene/tokens', id), id),
    };
  const collection =
    root === 'scene' &&
    key !== undefined &&
    SIDES.some((s) => Array.isArray(valueAt(record[s]?.data, `/scene/${key}`)));
  if (collection)
    return {
      field: `/scene/${key}`,
      kind: 'count',
      section: 'SILK.Merge.Section.sceneContents',
      label: key,
    };
  return {
    field,
    kind: 'field',
    section: 'SILK.Merge.Section.scene',
    label: parts(field).slice(1).join(' · ') || field,
  };
}

function groupOf(kind: CanonRecord['kind'], record: Sides, field: string, sections: SheetSections) {
  if (kind === 'element') return elementGroup(record, field);
  if (kind === 'sheet') return sheetGroup(record, field, sections);
  if (kind === 'eventScene') return sceneGroup(record, field);
  const section =
    kind === 'layoutGroup' ? 'SILK.Merge.Section.layout' : 'SILK.Merge.Section.connection';
  return { field, kind: 'field' as const, section, label: parts(field).join(' · ') };
}

function tokenValue(record: CanonRecord | undefined, field: string): JsonValue | undefined {
  const token = valueAt(record?.data, field);
  if (!isObject(token)) return undefined;
  return { x: token.x ?? 0, y: token.y ?? 0, hidden: !!token.hidden };
}

function countValue(record: CanonRecord | undefined, field: string): JsonValue | undefined {
  const list = valueAt(record?.data, field);
  return Array.isArray(list) ? list.length : undefined;
}

const newest = (a: Attribution | undefined, b: Attribution | undefined) =>
  !a ? b : !b ? a : b.date > a.date ? b : a;

/** The record's rows, in field order. The whole-record field (`''`) is not a row. */
export function rowsOf(
  r: Pick<RecordMerge, 'id' | 'kind' | 'base' | 'ours' | 'theirs'>,
  result: CanonRecord | undefined,
  fields: readonly FieldView[],
  sections: SheetSections = DEFAULT_SECTIONS,
): MergeRow[] {
  const sides: Sides = { base: r.base, ours: r.ours, theirs: r.theirs, result };
  const rows = new Map<string, MergeRow>();
  for (const f of fields) {
    if (f.field === '') continue;
    const g = groupOf(r.kind, sides, f.field, sections);
    let row = rows.get(g.field);
    if (!row) {
      const value = (side: Side | 'result'): JsonValue | undefined => {
        const record = sides[side];
        if (g.kind === 'token') return tokenValue(record, g.field);
        if (g.kind === 'count') return countValue(record, g.field);
        return side === 'result' ? f.result : f[side];
      };
      row = {
        recordId: r.id,
        ...g,
        base: value('base'),
        ours: value('ours'),
        theirs: value('theirs'),
        result: value('result'),
        fields: [],
        open: false,
        conflict: false,
        layout: true,
        canonOnly: true,
        text: false,
      };
      rows.set(g.field, row);
    }
    row.fields.push(f);
    row.open ||= f.open;
    row.conflict ||= f.change === 'conflict' && !f.layout;
    row.layout &&= !!f.layout;
    row.canonOnly &&= f.canonOnly;
    row.text = row.fields.length === 1 && f.text;
    const by = newest(row.by, f.by);
    if (by) row.by = by;
  }
  return [...rows.values()];
}
