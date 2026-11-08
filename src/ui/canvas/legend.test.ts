import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/commands/registry';
import { createLegendState, legendCommands, legendGroups } from './legend';

const group = (id: string, foundry = []) => legendGroups(foundry).find((g) => g.id === id);

describe('canvas legend (spec 1.1 §E.3)', () => {
  it('has the three groups: Keys, Mouse, Foundry keybindings', () => {
    expect(legendGroups([]).map((g) => [g.id, g.title])).toEqual([
      ['keys', 'SILK.Legend.Keys'],
      ['mouse', 'SILK.Legend.Mouse'],
      ['foundry', 'SILK.Legend.Foundry'],
    ]);
  });

  it('Keys: one row per digit class, named by class, Numpad folded into the digit', () => {
    const rows = group('keys')?.rows ?? [];
    expect(rows[0]).toEqual({
      keys: ['1'],
      label: 'SILK.Canvas.Key.create',
      args: { class: 'SILK.Class.person' },
    });
    expect(rows.filter((r) => r.label === 'SILK.Canvas.Key.create')).toHaveLength(8);
    expect(rows.some((r) => r.keys.includes('3'))).toBe(false);
  });

  it('Keys: modifiers and conditions show, e.g. Ctrl+F, Del on a Node or Connection, ?', () => {
    const rows = group('keys')?.rows ?? [];
    expect(rows).toContainEqual({ keys: ['Ctrl+F'], label: 'SILK.Canvas.Key.search' });
    expect(rows).toContainEqual({
      keys: ['Del', 'Backspace'],
      label: 'SILK.Canvas.Key.delete',
      when: 'SILK.Canvas.KeyWhen.nodeOrEdge',
    });
    expect(rows).toContainEqual({
      keys: ['Tab'],
      label: 'SILK.Canvas.Key.toggleDirection',
      when: 'SILK.Canvas.KeyWhen.edge',
    });
    expect(rows).toContainEqual({
      keys: ['Shift+Tab'],
      label: 'SILK.Canvas.Key.flip',
      when: 'SILK.Canvas.KeyWhen.edge',
    });
    expect(rows).toContainEqual({ keys: ['?'], label: 'SILK.Canvas.Key.legend' });
  });

  it('Mouse: every pointer gesture: drags, double-clicks, the §A right-drag rows, then the modifiers', () => {
    expect(group('mouse')?.rows.map((r) => r.label)).toEqual([
      'SILK.Canvas.Gesture.leftDrag-node',
      'SILK.Canvas.Gesture.drag-canvas',
      'SILK.Canvas.Gesture.doubleClick-node',
      'SILK.Canvas.Gesture.doubleClick-edge',
      'SILK.Canvas.Gesture.node-sameNode',
      'SILK.Canvas.Gesture.node-otherNode',
      'SILK.Canvas.Gesture.node-canvas',
      'SILK.Canvas.Gesture.canvas-canvas',
      'SILK.Canvas.Gesture.canvas-node',
      'SILK.Canvas.Gesture.edge-anywhere',
      'SILK.Legend.Modifiers',
      'SILK.Canvas.Modifier.shift',
      'SILK.Canvas.Modifier.ctrl',
      'SILK.Canvas.Modifier.alt',
    ]);
    expect(group('mouse')?.rows[10]).toMatchObject({ heading: true });
  });

  it('Foundry keybindings: the live bindings as given', () => {
    const live = [{ title: 'SILK.Commands.canvas.open', keys: ['Shift+S'] }];
    expect(legendGroups(live).find((g) => g.id === 'foundry')?.rows).toEqual([
      { keys: ['Shift+S'], label: 'SILK.Commands.canvas.open' },
    ]);
  });
});

describe('legend.toggle (spec 1.1 §D, §E.3)', () => {
  function setup(initial = true) {
    let stored = initial;
    const state = createLegendState({
      get: () => stored,
      set: async (open) => void (stored = open),
    });
    const registry = createRegistry(() => ({ isGM: true }));
    for (const c of legendCommands(state)) registry.register(c);
    const seen: boolean[] = [];
    state.subscribe((open) => seen.push(open));
    return { registry, seen, stored: () => stored };
  }

  it('is open by default (the client setting) and flips without args', async () => {
    const { registry, seen, stored } = setup();
    expect(await registry.run('legend.toggle')).toEqual({ open: false });
    expect(stored()).toBe(false);
    expect(await registry.run('legend.toggle')).toEqual({ open: true });
    expect(seen).toEqual([true, false, true]);
  });

  it('takes an explicit state', async () => {
    const { registry, stored } = setup(false);
    expect(await registry.run('legend.toggle', { open: false })).toEqual({ open: false });
    expect(stored()).toBe(false);
  });
});
