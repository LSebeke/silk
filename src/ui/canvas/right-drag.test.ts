import { describe, expect, it } from 'vitest';
import de from '../../../public/lang/de.json';
import en from '../../../public/lang/en.json';
import { RIGHT_DRAG_GESTURES, rightDragAction } from './right-drag';

const lookup = (lang: object, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], lang);

const mods = (m: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...m,
});
const plain = mods();
const shift = mods({ shiftKey: true });
const ctrl = mods({ ctrlKey: true });
const alt = mods({ altKey: true });

describe('right-click start/end (spec 1.1 §A)', () => {
  it('Node A → Node A opens the Node context menu', () => {
    expect(rightDragAction('a', 'a', plain)).toEqual({ kind: 'nodeMenu', id: 'a' });
  });

  it('Node A → Node B connects A → B', () => {
    expect(rightDragAction('a', 'b', plain)).toEqual({
      kind: 'connect',
      from: 'a',
      to: 'b',
      connection: { direction: 'out' },
    });
  });

  it('Node A → canvas creates at the drop point, connected A → new', () => {
    expect(rightDragAction('a', undefined, plain)).toEqual({
      kind: 'create',
      at: 'end',
      from: 'a',
      connection: { direction: 'out' },
    });
  });

  it('canvas → canvas creates a standalone Node', () => {
    expect(rightDragAction(undefined, undefined, plain)).toEqual({ kind: 'create', at: 'start' });
  });

  it('canvas → Node B creates at the press point, connected new → B', () => {
    // Relative to B, the pipeline's origin: new → B is incoming.
    expect(rightDragAction(undefined, 'b', plain)).toEqual({
      kind: 'create',
      at: 'start',
      from: 'b',
      connection: { direction: 'in' },
    });
  });

  it('modifiers at release match the digit keys: Shift = incoming, Ctrl = mutual, Alt = free-form outgoing', () => {
    expect(rightDragAction('a', 'b', shift)).toMatchObject({ connection: { direction: 'in' } });
    expect(rightDragAction('a', 'b', ctrl)).toMatchObject({ connection: { direction: 'mutual' } });
    expect(rightDragAction('a', 'b', alt)).toMatchObject({
      connection: { type: 'free', direction: 'out' },
    });
    expect(rightDragAction('a', undefined, shift)).toMatchObject({
      connection: { direction: 'in' },
    });
    // Seen from B, the direction flips; mutual stays.
    expect(rightDragAction(undefined, 'b', shift)).toMatchObject({
      from: 'b',
      connection: { direction: 'out' },
    });
    expect(rightDragAction(undefined, 'b', ctrl)).toMatchObject({
      connection: { direction: 'mutual' },
    });
    expect(rightDragAction(undefined, 'b', alt)).toMatchObject({
      connection: { type: 'free', direction: 'in' },
    });
  });

  it('modifiers do not change a menu or a standalone Node', () => {
    expect(rightDragAction('a', 'a', shift)).toEqual({ kind: 'nodeMenu', id: 'a' });
    expect(rightDragAction(undefined, undefined, alt)).toEqual({ kind: 'create', at: 'start' });
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

  it('labels every gesture in EN and DE', () => {
    for (const lang of [en, de])
      for (const g of RIGHT_DRAG_GESTURES)
        expect(lookup(lang, g.label), g.label).toBeTypeOf('string');
  });
});
