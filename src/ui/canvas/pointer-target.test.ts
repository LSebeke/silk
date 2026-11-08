import { describe, expect, it } from 'vitest';
import de from '../../../public/lang/de.json';
import en from '../../../public/lang/en.json';
import {
  doubleClickCommand,
  POINTER_GESTURES,
  pointerTarget,
  type TargetElement,
} from './pointer-target';

const lookup = (lang: object, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], lang);

/**
 * A fake DOM chain, innermost first. Each element: a tag, classes, attributes. `closest`
 * matches a selector list of simple selectors (`tag`, `.class`, `[attr]`).
 */
type Fake = { tag?: string; cls?: string[]; attrs?: Record<string, string> };
function chain(...els: Fake[]): TargetElement {
  const matches = (el: Fake, simple: string) => {
    if (simple.startsWith('.')) return el.cls?.includes(simple.slice(1)) ?? false;
    if (simple.startsWith('[')) return el.attrs?.[simple.slice(1, -1)] !== undefined;
    return el.tag === simple;
  };
  const at = (i: number): TargetElement => ({
    getAttribute: (name) => els[i]?.attrs?.[name] ?? null,
    closest(selector) {
      const list = selector.split(',').map((s) => s.trim());
      for (let j = i; j < els.length; j++)
        if (list.some((s) => matches(els[j] as Fake, s))) return at(j);
      return null;
    },
  });
  return at(0);
}

const pane: Fake = { cls: ['svelte-flow__pane'] };
const card = (id: string): Fake => ({ attrs: { 'data-silk-node': id } });
const edgePath: Fake = { tag: 'path', cls: ['svelte-flow__edge-interaction'] };
const edge = (id: string): Fake => ({
  tag: 'g',
  cls: ['svelte-flow__edge'],
  attrs: { 'data-id': id },
});
const label = (id: string): Fake => ({
  cls: ['svelte-flow__edge-label'],
  attrs: { 'data-silk-edge': id },
});
const labels: Fake = { cls: ['svelte-flow__edge-labels'] };

describe('canvas pointer targets (spec 1.1 §F.1, #138)', () => {
  it('a card, or anything inside it, is its Node', () => {
    expect(pointerTarget(chain(card('a'), pane))).toEqual({ kind: 'node', id: 'a' });
    expect(pointerTarget(chain({ tag: 'img' }, card('a'), pane))).toEqual({
      kind: 'node',
      id: 'a',
    });
    expect(pointerTarget(chain({ tag: 'button' }, card('a'), pane))).toEqual({
      kind: 'node',
      id: 'a',
    });
  });

  it('the edge path (its ~16 px hit area) is the edge', () => {
    expect(pointerTarget(chain(edgePath, edge('c1'), pane))).toEqual({ kind: 'edge', id: 'c1' });
  });

  it('the label, in the label portal outside the edge, is the edge label', () => {
    expect(pointerTarget(chain(label('c1'), labels, pane))).toEqual({
      kind: 'edgeLabel',
      id: 'c1',
    });
    expect(pointerTarget(chain({ tag: 'span' }, label('c1'), labels, pane))).toEqual({
      kind: 'edgeLabel',
      id: 'c1',
    });
  });

  it('anything else in the pane is the empty canvas (frames too)', () => {
    expect(pointerTarget(chain(pane))).toEqual({ kind: 'pane' });
    expect(pointerTarget(chain({ attrs: { 'data-silk-group': 'g' } }, pane))).toEqual({
      kind: 'pane',
    });
  });

  it('text fields and the Connection editor keep their own pointer: no target', () => {
    expect(pointerTarget(chain({ tag: 'input' }, card('a'), pane))).toBeUndefined();
    expect(pointerTarget(chain({ tag: 'textarea' }, pane))).toBeUndefined();
    const editor = { attrs: { 'data-silk-connection-editor': '' } };
    expect(
      pointerTarget(chain({ tag: 'button' }, editor, label('c1'), labels, pane)),
    ).toBeUndefined();
  });

  it('outside the pane (toolbar, menus, overlays): no target', () => {
    expect(pointerTarget(chain({ tag: 'div' }))).toBeUndefined();
    expect(pointerTarget(null)).toBeUndefined();
  });
});

describe('double-click (spec 1.1 §F.2, §E.3)', () => {
  it('a Node opens Element Detail; an edge or its label, Connection Detail; the canvas, nothing', () => {
    expect(doubleClickCommand({ kind: 'node', id: 'a' })).toEqual({
      name: 'element.openDetail',
      args: { id: 'a' },
    });
    for (const kind of ['edge', 'edgeLabel'] as const)
      expect(doubleClickCommand({ kind, id: 'c1' })).toEqual({
        name: 'connection.openDetail',
        args: { id: 'c1' },
      });
    expect(doubleClickCommand({ kind: 'pane' })).toBeUndefined();
    expect(doubleClickCommand(undefined)).toBeUndefined();
  });
});

describe('pointer gesture table (spec 1.1 §E.3: the legend reads it)', () => {
  it('lists left-drag move, pan, and the double-clicks', () => {
    expect(POINTER_GESTURES.map((g) => [g.gesture, g.target])).toEqual([
      ['leftDrag', 'node'],
      ['drag', 'canvas'],
      ['doubleClick', 'node'],
      ['doubleClick', 'edge'],
    ]);
  });

  it('labels every gesture in EN and DE', () => {
    for (const lang of [en, de])
      for (const g of POINTER_GESTURES) expect(lookup(lang, g.label), g.label).toBeTypeOf('string');
  });
});
