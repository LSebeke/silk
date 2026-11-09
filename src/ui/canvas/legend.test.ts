import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/commands/registry';
import { createLegendState, legendCommands, legendGroups } from './legend';

const group = (id: string, foundry = []) => legendGroups(foundry).find((g) => g.id === id);

describe('canvas legend (spec 1.1 §E.3)', () => {
  it('has the three groups: Keys, Mouse, Foundry keybindings', () => {
    expect(legendGroups([]).map((g) => [g.id, g.title])).toEqual([
      ['keys', 'GARN.Legend.Keys'],
      ['mouse', 'GARN.Legend.Mouse'],
      ['foundry', 'GARN.Legend.Foundry'],
    ]);
  });

  it('Keys: one row per digit class, named by class, Numpad folded into the digit', () => {
    const rows = group('keys')?.rows ?? [];
    expect(rows[0]).toEqual({
      keys: ['1'],
      label: 'GARN.Canvas.Key.create',
      args: { class: 'GARN.Class.person' },
    });
    expect(rows.filter((r) => r.label === 'GARN.Canvas.Key.create')).toHaveLength(8);
    expect(rows.some((r) => r.keys.includes('3'))).toBe(false);
  });

  it('Keys: modifiers and conditions show, e.g. Ctrl+F, Del on a Node or Connection, ?', () => {
    const rows = group('keys')?.rows ?? [];
    expect(rows).toContainEqual({ keys: ['Ctrl+F'], label: 'GARN.Canvas.Key.search' });
    expect(rows).toContainEqual({
      keys: ['Del', 'Backspace'],
      label: 'GARN.Canvas.Key.delete',
      when: 'GARN.Canvas.KeyWhen.nodeOrEdge',
    });
    expect(rows).toContainEqual({
      keys: ['Tab'],
      label: 'GARN.Canvas.Key.toggleDirection',
      when: 'GARN.Canvas.KeyWhen.edge',
    });
    expect(rows).toContainEqual({
      keys: ['Shift+Tab'],
      label: 'GARN.Canvas.Key.flip',
      when: 'GARN.Canvas.KeyWhen.edge',
    });
    expect(rows).toContainEqual({ keys: ['?'], label: 'GARN.Canvas.Key.legend' });
  });

  it('Mouse: every pointer gesture: drags, double-clicks, the §A right-drag rows, then the modifiers', () => {
    expect(group('mouse')?.rows.map((r) => r.label)).toEqual([
      'GARN.Canvas.Gesture.leftDrag-node',
      'GARN.Canvas.Gesture.drag-canvas',
      'GARN.Canvas.Gesture.doubleClick-node',
      'GARN.Canvas.Gesture.doubleClick-edge',
      'GARN.Canvas.Gesture.node-sameNode',
      'GARN.Canvas.Gesture.node-otherNode',
      'GARN.Canvas.Gesture.node-canvas',
      'GARN.Canvas.Gesture.canvas-canvas',
      'GARN.Canvas.Gesture.canvas-node',
      'GARN.Canvas.Gesture.edge-anywhere',
      'GARN.Legend.Modifiers',
      'GARN.Canvas.Modifier.shift',
      'GARN.Canvas.Modifier.ctrl',
      'GARN.Canvas.Modifier.alt',
    ]);
    expect(group('mouse')?.rows[10]).toMatchObject({ heading: true });
  });

  it('Foundry keybindings: the live bindings as given', () => {
    const live = [{ title: 'GARN.Commands.canvas.open', keys: ['Shift+S'] }];
    expect(legendGroups(live).find((g) => g.id === 'foundry')?.rows).toEqual([
      { keys: ['Shift+S'], label: 'GARN.Commands.canvas.open' },
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
