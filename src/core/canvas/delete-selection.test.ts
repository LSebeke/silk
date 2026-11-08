import { describe, expect, it } from 'vitest';
import { createRegistry, type Command } from '../commands/registry';
import { elementRecord } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCanvasState } from './canvas-state';
import { canvasCoreCommands } from './commands';
import { groupRecord } from './groups';

/** `element.delete` answers like the lifecycle: the ids it deleted (none when declined). */
async function setup(confirm = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  await workingCopy.set([
    elementRecord('a', { class: 'person', name: 'Alrik', position: { x: 0, y: 0 } }),
    elementRecord('b', { class: 'person', name: 'Rondra', position: { x: 0, y: 0 } }),
    groupRecord({
      id: 'g',
      label: 'Frame',
      parent: null,
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
    }),
  ]);
  const state = createCanvasState();
  const registry = createRegistry(() => ({ isGM: true }));
  const runs: [string, unknown][] = [];
  const fake = (name: string, result: (args: { ids: string[] }) => unknown): Command => ({
    name,
    title: name,
    available: () => true,
    async run(args: { ids: string[] }) {
      runs.push([name, args]);
      return result(args);
    },
  });
  registry.register(fake('element.delete', ({ ids }) => ({ ids: confirm ? ids : [] })));
  registry.register(fake('connection.delete', () => undefined));
  for (const c of canvasCoreCommands({
    workingCopy: () => workingCopy,
    state,
    run: (name, args) => registry.run(name, args),
  }))
    registry.register(c);
  const select = (ids: string[], connections: string[]) =>
    registry.run('canvas.select', { ids, connections });
  return { registry, runs, select };
}

describe('canvas.deleteSelection: Del on the selection (spec 1.1 §E.4, §D)', () => {
  it('Connections only: deletes them at once, no element delete flow', async () => {
    const { registry, runs, select } = await setup();
    await select([], ['c1', 'c2']);
    await registry.run('canvas.deleteSelection', {});
    expect(runs).toEqual([['connection.delete', { ids: ['c1', 'c2'] }]]);
  });

  it('Nodes and Connections: the Node delete flow runs, then the Connections go too', async () => {
    const { registry, runs, select } = await setup();
    await select(['a'], ['c1']);
    await registry.run('canvas.deleteSelection', {});
    expect(runs).toEqual([
      ['element.delete', { ids: ['a'] }],
      ['connection.delete', { ids: ['c1'] }],
    ]);
  });

  it('a declined confirmation deletes nothing, the selected Connections stay', async () => {
    const { registry, runs, select } = await setup(false);
    await select(['a'], ['c1']);
    await registry.run('canvas.deleteSelection', {});
    expect(runs).toEqual([['element.delete', { ids: ['a'] }]]);
  });

  it('Nodes only: just the Node delete flow; Visual Group frames are not elements', async () => {
    const { registry, runs, select } = await setup();
    await select(['a', 'g', 'b'], []);
    await registry.run('canvas.deleteSelection', {});
    expect(runs).toEqual([['element.delete', { ids: ['a', 'b'] }]]);
  });

  it('nothing selected: nothing runs', async () => {
    const { registry, runs } = await setup();
    await registry.run('canvas.deleteSelection', {});
    expect(runs).toEqual([]);
  });

  it('canvas.select without `connections` keeps the Connection selection', async () => {
    const { registry, runs, select } = await setup();
    await select([], ['c1']);
    await registry.run('canvas.select', { ids: ['a'], add: true });
    await registry.run('canvas.deleteSelection', {});
    expect(runs).toEqual([
      ['element.delete', { ids: ['a'] }],
      ['connection.delete', { ids: ['c1'] }],
    ]);
  });
});
