import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import { elementRecord } from '../../core/elements';
import { facingAnchor, toFlowEdges } from './flow-edges';
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

  it('a Ghost restored by reconcile carries the Commit it came from', () => {
    const restored = elementRecord('el-r', {
      class: 'person',
      name: 'R',
      position: { x: 0, y: 0 },
      restoredFrom: 'abcdef0123',
    });
    expect(toFlowNodes(records(restored), [], [])[0]?.data).toEqual({
      class: 'person',
      name: 'R',
      ghost: true,
      restoredFrom: 'abcdef0123',
    });
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

  it('carries a non-default Status (the card chip shows it) and updates the Node when it changes', () => {
    const dead = elementRecord('el-a', {
      class: 'person',
      name: 'Alrik',
      position: { x: 1, y: 2 },
      status: 'dead',
    });
    const first = toFlowNodes(records(alrik), [], []);
    const next = toFlowNodes(records(dead), [], first);
    expect(first[0]?.data.status).toBeUndefined();
    expect(next[0]?.data.status).toBe('dead');
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

const rondra = elementRecord('el-r', { class: 'person', name: 'Rondra', position: { x: 0, y: 0 } });
const connection = (id: string, data: Record<string, string>): CanonRecord => ({
  kind: 'connection',
  id,
  data: { type: 'free', direction: 'directed', label: '', ...data },
});

describe('flow edges', () => {
  it('maps Connections to edges; directed ones get an arrowhead, mutual ones none', () => {
    const edges = toFlowEdges(
      records(
        alrik,
        rondra,
        connection('c1', { from: 'el-a', to: 'el-r', label: 'loves' }),
        connection('c2', { from: 'el-a', to: 'el-r', direction: 'mutual', label: 'are kin' }),
      ),
      [],
    );
    expect(edges.map((e) => [e.id, e.source, e.target, !!e.markerEnd, e.data?.label])).toEqual([
      ['c1', 'el-a', 'el-r', true, 'loves'],
      ['c2', 'el-a', 'el-r', false, 'are kin'],
    ]);
  });

  it('fans parallel Connections between one pair out to separate curves', () => {
    const edges = toFlowEdges(
      records(
        alrik,
        rondra,
        gareth,
        connection('c1', { from: 'el-a', to: 'el-r' }),
        connection('c2', { from: 'el-r', to: 'el-a' }),
        connection('c3', { from: 'el-a', to: 'el-r', direction: 'mutual' }),
        connection('c4', { from: 'el-a', to: 'el-g' }),
      ),
      [],
    );
    expect(edges[3]?.data?.offset).toBe(0);
    // Measured in one frame (lower id → higher id): three distinct, centred curves.
    const signed = edges
      .slice(0, 3)
      .map((e) => (e.source < e.target ? 1 : -1) * (e.data?.offset ?? 0));
    expect(new Set(signed).size).toBe(3);
    expect(signed.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('skips Connections with a missing endpoint and reuses unchanged edges', () => {
    const c1 = connection('c1', { from: 'el-a', to: 'el-r' });
    const first = toFlowEdges(
      records(alrik, rondra, c1, connection('c9', { from: 'el-a', to: 'gone' })),
      [],
    );
    expect(first.map((e) => e.id)).toEqual(['c1']);
    const selected = first.map((e) => ({ ...e, selected: true }));
    expect(toFlowEdges(records(alrik, rondra, c1), selected)[0]).toBe(selected[0]);
    const mutual = connection('c1', { from: 'el-a', to: 'el-r', direction: 'mutual' });
    const [changed] = toFlowEdges(records(alrik, rondra, mutual), selected);
    expect(changed).toMatchObject({ selected: true, data: { direction: 'mutual' } });
    expect(changed?.markerEnd).toBeUndefined();
  });
});

describe('facing anchors', () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 });
  it('attaches on the side facing the other Node', () => {
    expect(facingAnchor(box(0, 0), box(400, 10))).toEqual({ x: 100, y: 25, side: 'right' });
    expect(facingAnchor(box(400, 10), box(0, 0))).toEqual({ x: 400, y: 35, side: 'left' });
    expect(facingAnchor(box(0, 0), box(20, 300))).toEqual({ x: 50, y: 50, side: 'bottom' });
    expect(facingAnchor(box(0, 300), box(20, 0))).toEqual({ x: 50, y: 300, side: 'top' });
  });
});
