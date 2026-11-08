import { describe, expect, it } from 'vitest';
import de from '../../../public/lang/de.json';
import en from '../../../public/lang/en.json';
import type { PointerTarget } from './pointer-target';
import { RIGHT_DRAG_GESTURES, rightDragAction } from './right-drag';

const lookup = (lang: object, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], lang);

const mods = (m: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...m,
});
const node = (id: string): PointerTarget => ({ kind: 'node', id });
const canvas: PointerTarget = { kind: 'pane' };
const plain = mods();
const shift = mods({ shiftKey: true });
const ctrl = mods({ ctrlKey: true });
const alt = mods({ altKey: true });

describe('right-click start/end (spec 1.1 §A)', () => {
  it('Node A → Node A opens the Node context menu', () => {
    expect(rightDragAction(node('a'), 'a', plain)).toEqual({ kind: 'nodeMenu', id: 'a' });
  });

  it('Node A → Node B connects A → B', () => {
    expect(rightDragAction(node('a'), 'b', plain)).toEqual({
      kind: 'connect',
      from: 'a',
      to: 'b',
      connection: { direction: 'out' },
    });
  });

  it('Node A → canvas creates at the drop point, connected A → new', () => {
    expect(rightDragAction(node('a'), undefined, plain)).toEqual({
      kind: 'create',
      at: 'end',
      from: 'a',
      connection: { direction: 'out' },
    });
  });

  it('canvas → canvas creates a standalone Node', () => {
    expect(rightDragAction(canvas, undefined, plain)).toEqual({ kind: 'create', at: 'start' });
  });

  it('canvas → Node B creates at the press point, connected new → B', () => {
    // Relative to B, the pipeline's origin: new → B is incoming.
    expect(rightDragAction(canvas, 'b', plain)).toEqual({
      kind: 'create',
      at: 'start',
      from: 'b',
      connection: { direction: 'in' },
    });
  });

  it('modifiers at release match the digit keys: Shift = incoming, Ctrl = mutual, Alt = free-form outgoing', () => {
    expect(rightDragAction(node('a'), 'b', shift)).toMatchObject({
      connection: { direction: 'in' },
    });
    expect(rightDragAction(node('a'), 'b', ctrl)).toMatchObject({
      connection: { direction: 'mutual' },
    });
    expect(rightDragAction(node('a'), 'b', alt)).toMatchObject({
      connection: { type: 'free', direction: 'out' },
    });
    expect(rightDragAction(node('a'), undefined, shift)).toMatchObject({
      connection: { direction: 'in' },
    });
    // Seen from B, the direction flips; mutual stays.
    expect(rightDragAction(canvas, 'b', shift)).toMatchObject({
      from: 'b',
      connection: { direction: 'out' },
    });
    expect(rightDragAction(canvas, 'b', ctrl)).toMatchObject({
      connection: { direction: 'mutual' },
    });
    expect(rightDragAction(canvas, 'b', alt)).toMatchObject({
      connection: { type: 'free', direction: 'in' },
    });
  });

  it('a press on an edge or its label opens the edge menu, wherever it ends (#138)', () => {
    for (const kind of ['edge', 'edgeLabel'] as const)
      for (const end of ['a', undefined])
        for (const m of [plain, shift, ctrl, alt])
          expect(rightDragAction({ kind, id: 'c1' }, end, m)).toEqual({
            kind: 'edgeMenu',
            id: 'c1',
          });
  });

  it('modifiers do not change a menu or a standalone Node', () => {
    expect(rightDragAction(node('a'), 'a', shift)).toEqual({ kind: 'nodeMenu', id: 'a' });
    expect(rightDragAction(canvas, undefined, alt)).toEqual({ kind: 'create', at: 'start' });
  });
});

describe('right-drag gesture table (spec 1.1 §A, §E.3: the legend reads it)', () => {
  it('lists the six §A rows in order, edge menu included', () => {
    expect(RIGHT_DRAG_GESTURES.map((g) => [g.start, g.end])).toEqual([
      ['node', 'sameNode'],
      ['node', 'otherNode'],
      ['node', 'canvas'],
      ['canvas', 'canvas'],
      ['canvas', 'node'],
      ['edge', 'anywhere'],
    ]);
  });

  it('every row is what rightDragAction does, and they cover every press/release', () => {
    // Start and end as rightDragAction sees them: a pointer target, and a Node id or the canvas.
    const starts = {
      node: [node('a')],
      canvas: [canvas],
      edge: [
        { kind: 'edge', id: 'c1' },
        { kind: 'edgeLabel', id: 'c1' },
      ],
    } as const;
    const ends = {
      sameNode: ['a'],
      otherNode: ['b'],
      node: ['b'],
      canvas: [undefined],
      anywhere: ['a', 'b', undefined],
    } as const;
    const covered = new Set<string>();
    for (const g of RIGHT_DRAG_GESTURES)
      for (const start of starts[g.start])
        for (const end of ends[g.end]) {
          expect(rightDragAction(start, end, plain).kind, `${g.start}-${g.end}`).toBe(g.result);
          covered.add(`${start.kind}-${String(end)}`);
        }
    for (const start of ['node', 'pane', 'edge', 'edgeLabel'])
      for (const end of start === 'node' ? ['a', 'b', undefined] : ['b', undefined])
        expect(covered, `${start}-${String(end)}`).toContain(`${start}-${String(end)}`);
  });

  it('labels every gesture in EN and DE', () => {
    for (const lang of [en, de])
      for (const g of RIGHT_DRAG_GESTURES)
        expect(lookup(lang, g.label), g.label).toBeTypeOf('string');
  });
});
