import { describe, expect, it } from 'vitest';
import de from '../../../public/lang/de.json';
import en from '../../../public/lang/en.json';
import {
  CANVAS_KEYS,
  KEY_CONDITION_LABELS,
  MODIFIER_CONNECTIONS,
  canvasKey,
  confirmKey,
  sourceKey,
} from './keys';

const lookup = (lang: object, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], lang);

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

  it('Ctrl+F opens Search, with or without a selection', () => {
    expect(canvasKey(key('KeyF', { ctrlKey: true }), none)).toEqual({ kind: 'search' });
    expect(canvasKey(key('KeyF', { ctrlKey: true }), { node: true, edge: false })).toEqual({
      kind: 'search',
    });
    expect(canvasKey(key('KeyF'), none)).toBeUndefined();
  });

  it('Tab toggles directed ⇄ mutual, Shift+Tab reverses, q cycles type; F2 edits it', () => {
    const edge = { node: false, edge: true };
    expect(canvasKey(key('Tab'), edge)).toEqual({
      kind: 'command',
      name: 'connection.toggleDirection',
    });
    expect(canvasKey(key('Tab', { shiftKey: true }), edge)).toEqual({
      kind: 'command',
      name: 'connection.flip',
    });
    expect(canvasKey(key('Tab', { ctrlKey: true }), edge)).toBeUndefined();
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

  it('Delete/Backspace also act on selected Connections only (1.1 §E.4)', () => {
    const edge = { node: false, edge: true };
    expect(canvasKey(key('Delete'), edge)).toEqual({ kind: 'delete' });
    expect(canvasKey(key('Backspace'), edge)).toEqual({ kind: 'delete' });
  });

  it('? toggles the legend on any layout (1.1 §E.3)', () => {
    const question = (shiftKey: boolean) => ({ ...key('Slash', { shiftKey }), key: '?' });
    expect(canvasKey(question(true), none)).toEqual({ kind: 'legend' });
    // German layout: Shift+ß.
    expect(canvasKey({ ...key('Minus', { shiftKey: true }), key: '?' }, none)).toEqual({
      kind: 'legend',
    });
    expect(canvasKey({ ...key('Slash'), key: '/' }, none)).toBeUndefined();
  });
});

describe('Source Step compass keys (spec 1.1 §B.1)', () => {
  it('↑ Compendium, ← Generator, → Blank, ↓ / Esc cancel', () => {
    expect(sourceKey(key('ArrowUp'))).toBe('compendium');
    expect(sourceKey(key('ArrowLeft'))).toBe('generator');
    expect(sourceKey(key('ArrowRight'))).toBe('blank');
    expect(sourceKey(key('ArrowDown'))).toBe('cancel');
    expect(sourceKey(key('Escape'))).toBe('cancel');
  });

  it('other keys and modified arrows do nothing', () => {
    expect(sourceKey(key('KeyA'))).toBeUndefined();
    expect(sourceKey(key('Enter'))).toBeUndefined();
    expect(sourceKey(key('ArrowRight', { ctrlKey: true }))).toBeUndefined();
  });
});

describe('canvas keymap table (spec 1.1 §E.3: the legend reads it)', () => {
  const selections = {
    always: none,
    node: { node: true, edge: false },
    edge: { node: false, edge: true },
    nodeOrEdge: { node: false, edge: true },
  } as const;
  const held = {
    none: {},
    shiftOk: {},
    shift: { shiftKey: true },
    primary: { ctrlKey: true },
    connection: {},
  } as const;

  it('every row is what canvasKey does under its condition, and nothing without it', () => {
    for (const row of CANVAS_KEYS)
      for (const e of [
        ...row.codes.map((code) => key(code, held[row.mods])),
        ...(row.keys ?? []).map((k) => ({ ...key('Unidentified', held[row.mods]), key: k })),
      ]) {
        expect(canvasKey(e, selections[row.when])).toEqual(row.action);
        if (row.when !== 'always') expect(canvasKey(e, none)).toBeUndefined();
      }
  });

  it('lists the §10.3 keys; no digit for Player Characters', () => {
    const codes = CANVAS_KEYS.flatMap((r) => r.codes);
    for (const c of ['Digit1', 'Numpad9', 'KeyC', 'Tab', 'KeyQ', 'F2', 'KeyG', 'KeyS', 'KeyR'])
      expect(codes).toContain(c);
    for (const c of ['KeyP', 'KeyU', 'KeyF', 'KeyZ', 'Delete', 'Backspace'])
      expect(codes).toContain(c);
    expect(codes).not.toContain('Digit3');
  });

  it('labels every key, condition and modifier in EN and DE', () => {
    const labels = [
      ...CANVAS_KEYS.map((r) => r.label),
      ...Object.values(KEY_CONDITION_LABELS),
      ...MODIFIER_CONNECTIONS.map((m) => m.label),
    ];
    for (const lang of [en, de])
      for (const l of labels) expect(lookup(lang, l), l).toBeTypeOf('string');
  });
});
