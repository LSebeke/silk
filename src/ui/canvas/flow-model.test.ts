import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import { elementRecord } from '../../core/elements';
import { facingAnchor, toFlowEdges } from './flow-edges';
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
