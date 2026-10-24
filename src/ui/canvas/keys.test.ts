import { describe, expect, it } from 'vitest';
import { canvasKey } from './keys';

const key = (
  code: string,
  mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => ({
  code,
  key: code.replace(/^Key/, '').toLowerCase(),
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});
const none = { node: false, edge: false };

describe('canvas keys (spec §10.3)', () => {
  it('1–9 create a Node of class #n; Player Characters (3) are never created', () => {
    expect(canvasKey(key('Digit1'), none)).toEqual({ kind: 'create', class: 'person' });
    expect(canvasKey(key('Digit9'), none)).toEqual({ kind: 'create', class: 'note' });
    expect(canvasKey(key('Numpad6'), none)).toEqual({ kind: 'create', class: 'item' });
    expect(canvasKey(key('Digit3'), none)).toBeUndefined();
  });

  it('digits default to the create-from default; Shift/Ctrl/Alt pick incoming/mutual/free-form', () => {
    const sel = { node: true, edge: false };
    expect(canvasKey(key('Digit6'), sel)).toEqual({ kind: 'create', class: 'item' });
    expect(canvasKey(key('Digit6', { shiftKey: true }), sel)).toEqual({
      kind: 'create',
      class: 'item',
      connection: { direction: 'in' },
    });
    expect(canvasKey(key('Digit6', { ctrlKey: true }), sel)).toEqual({
      kind: 'create',
      class: 'item',
      connection: { direction: 'mutual' },
    });
    expect(canvasKey(key('Digit6', { altKey: true }), sel)).toEqual({
      kind: 'create',
      class: 'item',
      connection: { type: 'free', direction: 'out' },
    });
  });

  it('c connects from the selected Node', () => {
    expect(canvasKey(key('KeyC'), { node: true, edge: false })).toEqual({ kind: 'connect' });
    expect(canvasKey(key('KeyC'), none)).toBeUndefined();
    expect(canvasKey(key('KeyC', { ctrlKey: true }), { node: true, edge: false })).toBeUndefined();
  });

  it('Tab / q cycle direction / type of a selected Connection; F2 edits it', () => {
    const edge = { node: false, edge: true };
    expect(canvasKey(key('Tab'), edge)).toEqual({
      kind: 'command',
      name: 'connection.cycleDirection',
    });
    expect(canvasKey(key('KeyQ'), edge)).toEqual({ kind: 'command', name: 'connection.cycleType' });
    expect(canvasKey(key('F2'), edge)).toEqual({ kind: 'editConnection' });
    expect(canvasKey(key('Tab'), none)).toBeUndefined();
  });

  it('F2 renames a selected Node', () => {
    expect(canvasKey(key('F2'), { node: true, edge: false })).toEqual({ kind: 'rename' });
  });
});
