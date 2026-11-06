import { describe, expect, it } from 'vitest';
import { rightDragAction } from './right-drag';

const plain = { shiftKey: false, altKey: false };
const shift = { shiftKey: true, altKey: false };
const alt = { shiftKey: false, altKey: true };

describe('right-click start/end (spec 1.1 §A)', () => {
  it('Node A → Node A opens the Node context menu', () => {
    expect(rightDragAction('a', 'a', plain)).toEqual({ kind: 'nodeMenu', id: 'a' });
  });

  it('Node A → Node B connects A → B', () => {
    expect(rightDragAction('a', 'b', plain)).toEqual({
      kind: 'connect',
      from: 'a',
      to: 'b',
      direction: 'out',
    });
  });

  it('Node A → canvas creates at the drop point, connected A → new', () => {
    expect(rightDragAction('a', undefined, plain)).toEqual({
      kind: 'create',
      at: 'end',
      from: 'a',
      direction: 'out',
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
      direction: 'in',
    });
  });

  it('Shift at release = incoming, Alt = mutual, relative to the start of the drag', () => {
    expect(rightDragAction('a', 'b', shift)).toMatchObject({ from: 'a', direction: 'in' });
    expect(rightDragAction('a', 'b', alt)).toMatchObject({ direction: 'mutual' });
    expect(rightDragAction('a', undefined, shift)).toMatchObject({ direction: 'in' });
    expect(rightDragAction(undefined, 'b', shift)).toMatchObject({ from: 'b', direction: 'out' });
    expect(rightDragAction(undefined, 'b', alt)).toMatchObject({ direction: 'mutual' });
  });

  it('modifiers do not change a menu or a standalone Node', () => {
    expect(rightDragAction('a', 'a', shift)).toEqual({ kind: 'nodeMenu', id: 'a' });
    expect(rightDragAction(undefined, undefined, alt)).toEqual({ kind: 'create', at: 'start' });
  });
});
