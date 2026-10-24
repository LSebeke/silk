import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import { elementRecord } from '../../core/elements';
import { lodForZoom, toFlowNodes } from './flow-model';

const records = (...rs: CanonRecord[]) => new Map(rs.map((r) => [r.id, r]));
const alrik = elementRecord('el-a', { class: 'person', name: 'Alrik', position: { x: 1, y: 2 } });
const gareth = elementRecord('el-g', {
  class: 'location',
  name: 'Gareth',
  position: { x: 3, y: 4 },
  uuid: 'JournalEntry.abc',
});
const link: CanonRecord = { kind: 'connection', id: 'cn-1', data: { from: 'el-a', to: 'el-g' } };

describe('flow model', () => {
  it('maps element records to element Nodes with Ghost and selection flags', () => {
    const nodes = toFlowNodes(records(alrik, gareth, link), ['el-g'], []);
    expect(nodes).toEqual([
      {
        id: 'el-a',
        type: 'element',
        position: { x: 1, y: 2 },
        selected: false,
        data: { class: 'person', name: 'Alrik', ghost: true },
      },
      {
        id: 'el-g',
        type: 'element',
        position: { x: 3, y: 4 },
        selected: true,
        data: { class: 'location', name: 'Gareth', ghost: false },
      },
    ]);
  });

  it('reuses unchanged Node objects so Svelte Flow keeps their measurements', () => {
    const first = toFlowNodes(records(alrik, gareth), [], []);
    const measured = first.map((n) => ({ ...n, measured: { width: 190, height: 78 } }));
    const renamed = elementRecord('el-a', {
      class: 'person',
      name: 'Ulf',
      position: { x: 1, y: 2 },
    });
    const next = toFlowNodes(records(renamed, gareth), [], measured);
    expect(next[1]).toBe(measured[1]);
    expect(next[0]).toMatchObject({ data: { name: 'Ulf' }, measured: { width: 190, height: 78 } });
  });

  it('three zoom levels: full card, big title, coloured block', () => {
    expect(lodForZoom(1)).toBe('full');
    expect(lodForZoom(0.76)).toBe('full');
    expect(lodForZoom(0.5)).toBe('title');
    expect(lodForZoom(0.2)).toBe('block');
  });
});
