import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import { elementRecord } from '../../core/elements';
import { lodForZoom, toFlowNodes, toGroupNodes } from './flow-model';

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

  const frame = (id: string, parent: string | null, x: number, y: number): CanonRecord => ({
    kind: 'layoutGroup',
    id,
    data: {
      label: id.toUpperCase(),
      parent,
      position: { x, y },
      size: { width: 500, height: 400 },
    },
  });

  it('Visual Groups become frame Nodes, parents first, positioned relative to their parent', () => {
    const inner = frame('g-i', 'g-o', 150, 120);
    const outer = frame('g-o', null, 100, 100);
    const nodes = toGroupNodes(records(inner, outer, alrik), ['g-i'], []);
    expect(nodes).toEqual([
      {
        id: 'g-o',
        type: 'frame',
        position: { x: 100, y: 100 },
        width: 500,
        height: 400,
        zIndex: -1000,
        selected: false,
        data: { label: 'G-O' },
      },
      {
        id: 'g-i',
        type: 'frame',
        parentId: 'g-o',
        position: { x: 50, y: 20 },
        width: 500,
        height: 400,
        zIndex: -1000,
        selected: true,
        data: { label: 'G-I' },
      },
    ]);
  });

  it('a Node in a Visual Group is its child, positioned relative to the frame', () => {
    const inFrame = elementRecord('el-a', {
      class: 'person',
      name: 'Alrik',
      position: { x: 130, y: 150 },
      group: 'g-o',
    });
    const [node] = toFlowNodes(records(frame('g-o', null, 100, 100), inFrame), [], []);
    expect(node).toMatchObject({ id: 'el-a', parentId: 'g-o', position: { x: 30, y: 50 } });
    // Leaving the frame drops the parent from the reused Node.
    const [out] = toFlowNodes(records(alrik), [], node ? [node] : []);
    expect(out?.parentId).toBeUndefined();
    expect(out?.position).toEqual({ x: 1, y: 2 });
  });

  it('a position override (Untangle tween) replaces the record position', () => {
    const [node] = toFlowNodes(records(alrik), [], [], (id) =>
      id === 'el-a' ? { x: 50, y: 60 } : undefined,
    );
    expect(node?.position).toEqual({ x: 50, y: 60 });
  });

  it('three zoom levels: full card, big title, coloured block', () => {
    expect(lodForZoom(1)).toBe('full');
    expect(lodForZoom(0.76)).toBe('full');
    expect(lodForZoom(0.5)).toBe('title');
    expect(lodForZoom(0.2)).toBe('block');
  });
});
