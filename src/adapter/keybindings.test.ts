import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/commands/registry';
import { registerKeybindings, type KeybindingData } from './keybindings';

function setup(isGM: boolean) {
  const runs: string[] = [];
  const registry = createRegistry(() => ({ isGM }));
  registry.register({
    name: 'canvas.open',
    title: 'SILK.Commands.canvas.open',
    keys: [{ key: 'KeyS', modifiers: ['Shift'] }],
    available: (c) => c.isGM,
    run: async () => void runs.push('canvas.open'),
  });
  registry.register({
    name: 'canvas.search',
    title: 'Search',
    available: () => true,
    run: async () => void runs.push('canvas.search'),
  });
  const bindings = new Map<string, KeybindingData>();
  registerKeybindings(registry, (ns, action, data) => {
    expect(ns).toBe('silk');
    bindings.set(action, data);
  });
  return { runs, bindings };
}

describe('keybindings from command keys', () => {
  it('binds only commands that declare keys, with their title and chords', () => {
    const { bindings } = setup(true);
    expect([...bindings.keys()]).toEqual(['canvas.open']);
    expect(bindings.get('canvas.open')).toMatchObject({
      name: 'SILK.Commands.canvas.open',
      editable: [{ key: 'KeyS', modifiers: ['Shift'] }],
    });
  });

  it('runs the command on key down and consumes the key', () => {
    const { runs, bindings } = setup(true);
    expect(bindings.get('canvas.open')?.onDown()).toBe(true);
    expect(runs).toEqual(['canvas.open']);
  });

  it('leaves the key to Foundry when the command is not available', () => {
    const { runs, bindings } = setup(false);
    expect(bindings.get('canvas.open')?.onDown()).toBe(false);
    expect(runs).toEqual([]);
  });
});
