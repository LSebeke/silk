import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { elementRecord } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCanvasState } from './canvas-state';
import { canvasCoreCommands } from './commands';

function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const state = createCanvasState();
  const registry = createRegistry(() => ({ isGM }));
  for (const command of canvasCoreCommands({ workingCopy: () => workingCopy, state }))
    registry.register(command);
  return { registry, workingCopy, state };
}

const alrik = elementRecord('el-a', { class: 'person', name: 'Alrik', position: { x: 0, y: 0 } });
const gareth = elementRecord('el-g', {
  class: 'location',
  name: 'Gareth',
  position: { x: 5, y: 5 },
});

describe('canvas commands', () => {
  it('canvas.moveNodes writes Node positions in one working copy write', async () => {
    const backend = createMemoryBackend();
    const workingCopy = createWorkingCopy(backend, { canWrite: () => true });
    await workingCopy.set([alrik, gareth]);
    const registry = createRegistry(() => ({ isGM: true }));
    for (const c of canvasCoreCommands({
      workingCopy: () => workingCopy,
      state: createCanvasState(),
    }))
      registry.register(c);

    await registry.run('canvas.moveNodes', {
      moves: [
        { id: 'el-a', x: 100, y: 200 },
        { id: 'el-g', x: -3, y: 4.5 },
        { id: 'unknown', x: 1, y: 1 },
      ],
    });
    expect(workingCopy.get('el-a')?.data).toEqual({
      class: 'person',
      name: 'Alrik',
      position: { x: 100, y: 200 },
    });
    expect(workingCopy.get('el-g')?.data['position']).toEqual({ x: -3, y: 4.5 });
    expect(backend.patches).toHaveLength(2);
  });

  it('canvas.moveNodes skips Nodes already at the spot', async () => {
    const backend = createMemoryBackend();
    const workingCopy = createWorkingCopy(backend, { canWrite: () => true });
    await workingCopy.set([alrik]);
    const registry = createRegistry(() => ({ isGM: true }));
    for (const c of canvasCoreCommands({
      workingCopy: () => workingCopy,
      state: createCanvasState(),
    }))
      registry.register(c);
    await registry.run('canvas.moveNodes', { moves: [{ id: 'el-a', x: 0, y: 0 }] });
    expect(backend.patches).toHaveLength(1);
  });

  it('canvas.select replaces or extends the selection and notifies subscribers', async () => {
    const { registry, state } = setup();
    const seen: string[][] = [];
    state.subscribe((s) => seen.push([...s.selection]));
    await registry.run('canvas.select', { ids: ['el-a'] });
    await registry.run('canvas.select', { ids: ['el-g', 'el-a'], add: true });
    await registry.run('canvas.select', { ids: ['el-a', 'el-g'], add: true });
    await registry.run('canvas.select', { ids: [] });
    expect(seen).toEqual([[], ['el-a'], ['el-a', 'el-g'], []]);
  });

  it('canvas commands are GM-only', () => {
    const { registry } = setup(false);
    for (const name of ['canvas.moveNodes', 'canvas.select'])
      expect(registry.isAvailable(name)).toBe(false);
  });
});
