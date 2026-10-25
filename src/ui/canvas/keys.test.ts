import { describe, expect, it } from 'vitest';
import { canvasKey, confirmKey } from './keys';

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
  it('s toggles the selected Node’s Status', () => {
    expect(canvasKey(key('KeyS'), { node: true, edge: false })).toEqual({ kind: 'status' });
    expect(canvasKey(key('KeyS'), none)).toBeUndefined();
  });

  it('p pins/unpins the selected Nodes (Focus Pin)', () => {
    expect(canvasKey(key('KeyP'), { node: true, edge: false })).toEqual({ kind: 'pin' });
    expect(canvasKey(key('KeyP'), none)).toBeUndefined();
  });

  it('r Reveals the selected Node or Connection (y/n confirm)', () => {
    expect(canvasKey(key('KeyR'), { node: true, edge: false })).toEqual({ kind: 'reveal' });
    expect(canvasKey(key('KeyR'), { node: false, edge: true })).toEqual({ kind: 'reveal' });
    expect(canvasKey(key('KeyR'), none)).toBeUndefined();
  });

  it('y/n confirm: y confirms; n, Enter and Escape decline (default n)', () => {
    expect(confirmKey(key('KeyY'))).toBe('yes');
    for (const code of ['KeyN', 'Enter', 'Escape']) expect(confirmKey(key(code))).toBe('no');
    expect(confirmKey(key('KeyX'))).toBeUndefined();
  });

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

  it('g groups and u untangles the selection; Ctrl+Z undoes (§10.4, §10.7)', () => {
    const sel = { node: true, edge: false };
    expect(canvasKey(key('KeyG'), sel)).toEqual({ kind: 'layout', name: 'canvas.group' });
    expect(canvasKey(key('KeyU'), sel)).toEqual({ kind: 'layout', name: 'canvas.untangle' });
    expect(canvasKey(key('KeyG'), none)).toBeUndefined();
    expect(canvasKey(key('KeyU', { shiftKey: true }), sel)).toBeUndefined();
    expect(canvasKey(key('KeyZ', { ctrlKey: true }), none)).toEqual({
      kind: 'layout',
      name: 'canvas.undo',
    });
    expect(canvasKey(key('KeyZ', { ctrlKey: true, shiftKey: true }), none)).toBeUndefined();
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

  it('Delete deletes the selected Nodes (element.delete confirms)', () => {
    const node = { node: true, edge: false };
    expect(canvasKey(key('Delete'), node)).toEqual({ kind: 'delete' });
    expect(canvasKey(key('Backspace'), node)).toEqual({ kind: 'delete' });
    expect(canvasKey(key('Delete'), none)).toBeUndefined();
  });
});
