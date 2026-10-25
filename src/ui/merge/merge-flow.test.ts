import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import type { FieldView, MergeView, RecordView } from '../../core/merge';
import {
  combinedText,
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
});
