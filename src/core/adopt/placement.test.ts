import { describe, expect, it } from 'vitest';
import { NODE_SIZE, type Rect } from '../canvas/groups';
import { folderLayout, gridLayout } from './placement';

const inside = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const card = (p: { x: number; y: number }): Rect => ({ ...p, ...NODE_SIZE });

describe('bulk placement (spec §6 Placement)', () => {
  it('lays bulk Adopts out as a grid centred on the point, cards not overlapping', () => {
    const positions = gridLayout(['a', 'b', 'c', 'd', 'e'], { x: 1000, y: 500 });
    const rects = [...positions.values()].map(card);
    expect(rects).toHaveLength(5);
    for (const [i, a] of rects.entries())
      for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    const xs = rects.flatMap((r) => [r.x, r.x + r.width]);
    const ys = rects.flatMap((r) => [r.y, r.y + r.height]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(1000, -1);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(500, -1);
  });

  it('turns a folder tree into the same tree of nested frames holding their docs', () => {
    const layout = folderLayout(
      {
        key: 'root',
        label: 'Villains',
        items: ['a', 'b'],
        children: [
          { key: 'sub1', label: 'Orks', items: ['c', 'd', 'e'], children: [] },
          {
            key: 'sub2',
            label: 'Cultists',
            items: [],
            children: [{ key: 'deep', label: 'Inner circle', items: ['f'], children: [] }],
          },
        ],
      },
      { x: 0, y: 0 },
    );
    const group = (key: string) => {
      const g = layout.groups.find((x) => x.key === key);
      if (!g) throw new Error(key);
      return g;
    };
    expect(layout.groups.map((g) => [g.key, g.label, g.parent])).toEqual([
      ['root', 'Villains', null],
      ['sub1', 'Orks', 'root'],
      ['sub2', 'Cultists', 'root'],
      ['deep', 'Inner circle', 'sub2'],
    ]);
    const rect = (key: string): Rect => ({ ...group(key).position, ...group(key).size });
    const at = (id: string) => card(layout.positions.get(id) ?? { x: NaN, y: NaN });
    expect(layout.items.get('a')).toBe('root');
    expect(layout.items.get('f')).toBe('deep');
    for (const id of ['a', 'b']) expect(inside(rect('root'), at(id))).toBe(true);
    for (const id of ['c', 'd', 'e']) expect(inside(rect('sub1'), at(id))).toBe(true);
    expect(inside(rect('deep'), at('f'))).toBe(true);
    expect(inside(rect('sub2'), rect('deep'))).toBe(true);
    expect(inside(rect('root'), rect('sub1'))).toBe(true);
    expect(overlaps(rect('sub1'), rect('sub2'))).toBe(false);
    for (const id of ['a', 'b']) expect(overlaps(at(id), rect('sub1'))).toBe(false);
  });
});
