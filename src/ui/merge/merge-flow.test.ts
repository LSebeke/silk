import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import type { FieldView, MergeRow, MergeView, RecordView } from '../../core/merge';
import {
  chosen,
  combinedText,
  drawerRecords,
  formatRowValue,
  nodeOf,
  sectionsOf,
  fieldLabel,
  formatValue,
  toMergeEdges,
  toMergeNodes,
  type MergeNode,
} from './merge-flow';

const elements = (nodes: ReturnType<typeof toMergeNodes>) =>
  nodes.filter((n): n is MergeNode => n.type === 'element');

const el = (id: string, name: string, x = 0): CanonRecord => ({
  kind: 'element',
  id,
  data: {
    class: 'person',
    name,
    position: { x, y: 0 },
    infoBlocks: [{ _id: 'b1', name: 'Secrets', text: '' }],
  },
});
const field = (f: Partial<FieldView>): FieldView => ({
  field: '/name',
  change: 'theirs',
  auto: 'theirs',
  open: false,
  text: false,
  canonOnly: false,
  ...f,
});
const rec = (r: Partial<RecordView> & { display: CanonRecord }): RecordView => ({
  id: r.display.id,
  kind: r.display.kind,
  badge: 'same',
  open: 0,
  fields: [],
  rows: [],
  result: r.display,
  ...r,
});

function view(records: RecordView[]): MergeView {
  return { records } as unknown as MergeView;
}

describe('merge canvas model', () => {
  it('draws the result with badges; deleted records stay, marked; canon-only badges need the toggle', () => {
    const v = view([
      rec({ display: el('a', 'Gareth'), badge: 'conflict', open: 1 }),
      rec({ display: el('b', 'Ulf'), badge: 'deleted', result: undefined }),
      rec({ display: el('c', 'Hal'), badge: 'canonOnly' }),
    ]);

    const nodes = elements(toMergeNodes(v, { showCanonOnly: false, selected: 'a' }));
    expect(nodes.map((n) => [n.id, n.data.badge, n.data.open, n.data.deleted, n.selected])).toEqual(
      [
        ['a', 'conflict', 1, false, true],
        ['b', 'deleted', 0, true, false],
        ['c', 'same', 0, false, false],
      ],
    );
    expect(elements(toMergeNodes(v, { showCanonOnly: true })).at(-1)?.data.badge).toBe('canonOnly');
  });

  it('a Node carries the conflicts of its sheet and Event Scene', () => {
    const sheet: CanonRecord = { kind: 'sheet', id: 'a-sheet', data: { element: 'a' } };
    const v = view([
      rec({ display: el('a', 'Gareth'), badge: 'same' }),
      rec({ display: sheet, owner: 'a', badge: 'conflict', open: 2 }),
    ]);
    const [node] = elements(toMergeNodes(v, { showCanonOnly: false }));
    expect(node?.data).toMatchObject({ badge: 'conflict', open: 2 });
    expect(nodeOf(v, 'a-sheet')).toBe('a');
    expect(nodeOf(v, 'a')).toBe('a');
    expect(drawerRecords(v, 'a-sheet').map((r) => r.id)).toEqual(['a', 'a-sheet']);
  });

  it('outlines the Canon position of a moved Node', () => {
    const v = view([
      rec({
        display: el('a', 'Gareth', 300),
        badge: 'layout',
        fields: [
          field({
            field: '/position',
            layout: true,
            change: 'conflict',
            ours: { x: 100, y: 0 },
            theirs: { x: 300, y: 0 },
          }),
        ],
      }),
    ]);
    const nodes = toMergeNodes(v, { showCanonOnly: false });
    expect(nodes.find((n) => n.type === 'outline')).toMatchObject({
      id: 'a~outline',
      position: { x: 100, y: 0 },
    });
  });

  it('edges carry the Connection badge and label', () => {
    const knows: CanonRecord = {
      kind: 'connection',
      id: 'k',
      data: { from: 'a', to: 'b', type: 'free', direction: 'directed', label: 'knows' },
    };
    const v = view([
      rec({ display: el('a', 'A') }),
      rec({ display: el('b', 'B') }),
      rec({ display: knows, badge: 'added' }),
    ]);
    expect(toMergeEdges(v, { showCanonOnly: false })).toMatchObject([
      { id: 'k', source: 'a', target: 'b', data: { badge: 'added', label: 'knows' } },
    ]);
  });

  it('labels fields, formats values, combines text', () => {
    const r = el('a', 'Gareth');
    expect(fieldLabel(r, '/name')).toBe('name');
    expect(fieldLabel(r, '/infoBlocks/b1/text')).toBe('Secrets · text');
    expect(fieldLabel(r, '/fields/merchantType')).toBe('fields · merchantType');
    expect(formatValue({ x: 1, y: 2 })).toBe('{"x":1,"y":2}');
    expect(formatValue(undefined)).toBeUndefined();
    expect(combinedText(field({ ours: 'A', theirs: 'B' }))).toBe('A\nB');
    expect(combinedText(field({ ours: 'A', theirs: undefined }))).toBe('A');
  });

  const row = (r: Partial<MergeRow>): MergeRow => ({
    recordId: 'r',
    field: '/name',
    kind: 'field',
    section: 'S.a',
    label: 'name',
    fields: [],
    open: false,
    conflict: false,
    layout: false,
    canonOnly: false,
    text: false,
    ...r,
  });

  it('groups rows into sections in order of appearance', () => {
    const rows = [
      row({ field: '/a', section: 'S.a' }),
      row({ field: '/b', section: 'S.b' }),
      row({ field: '/c', section: 'S.a' }),
    ];
    expect(sectionsOf(rows).map((s) => [s.section, s.rows.map((r) => r.field)])).toEqual([
      ['S.a', ['/a', '/c']],
      ['S.b', ['/b']],
    ]);
  });

  it('formats token and count rows; a row is chosen when all its fields took one side', () => {
    expect(formatRowValue(row({ kind: 'token' }), { x: 10, y: 20, hidden: true })).toBe(
      '(10, 20) hidden',
    );
    expect(formatRowValue(row({ kind: 'token' }), { x: 10, y: 20, hidden: false })).toBe(
      '(10, 20)',
    );
    expect(formatRowValue(row({ kind: 'count' }), 3)).toBe('3');
    const x = field({ field: '/t/x', auto: 'ours' });
    const y = field({ field: '/t/y', pick: { recordId: 'r', field: '/t/y', side: 'ours' } });
    expect(chosen(row({ fields: [x, y] }))).toBe('ours');
    expect(chosen(row({ fields: [x, field({ field: '/t/z', auto: 'theirs' })] }))).toBeNull();
    expect(chosen(row({ fields: [field({ open: true, auto: null })] }))).toBeNull();
  });
});
