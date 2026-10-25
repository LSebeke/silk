import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { connectionCommands, connectOnCreate, readConnection } from '../connections';
import { elementCommands, readElement } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCreationPipeline, type CreationPipeline, type PipelineStep } from './pipeline';

const LABELS: Record<string, string> = {
  person: 'Person',
  creature: 'Creature',
  playerCharacter: 'Player Character',
  location: 'Location',
  faction: 'Faction',
  item: 'Item',
  event: 'Event',
  quest: 'Quest',
  note: 'Note',
};

function setup() {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const registry = createRegistry(() => ({ isGM: true }));
  let n = 0;
  for (const c of elementCommands({ workingCopy: () => workingCopy, newId: () => `el-${++n}` }))
    registry.register(c);
  const commands: string[] = [];
  const pipeline = createCreationPipeline({
    run: (name, args) => {
      commands.push(name);
      return registry.run(name, args);
    },
    label: (id) => LABELS[id] ?? id,
  });
  const steps: PipelineStep['step'][] = [];
  pipeline.subscribe((s) => steps.push(s.step));
  const element = (id: string) => readElement(workingCopy.get(id));
  return { pipeline, workingCopy, commands, steps, element };
}

describe('Creation Pipeline', () => {
  it('right-click: class box, then name field, then done', async () => {
    const { pipeline, commands, steps, element } = setup();
    pipeline.open({ at: { x: 10, y: 20 } });
    expect(pipeline.get()).toMatchObject({ step: 'classBox', at: { x: 10, y: 20 }, query: '' });

    const id = await pipeline.pickClass('location');
    expect(element(id)).toMatchObject({
      class: 'location',
      name: 'Location',
      position: { x: 10, y: 20 },
    });
    expect(pipeline.get()).toEqual({ step: 'name', id });

    await pipeline.submitName('Gareth');
    expect(element(id)?.name).toBe('Gareth');
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(steps).toEqual(['idle', 'classBox', 'name', 'idle']);
    // The element exists after one command (§14: ≤ 2 interactions).
    expect(commands).toEqual(['element.create', 'element.rename']);
  });

  it('an empty or unchanged name keeps the default name without a rename', async () => {
    const { pipeline, commands, element } = setup();
    pipeline.open({ at: { x: 0, y: 0 } });
    const id = await pipeline.pickClass('note');
    await pipeline.submitName('   ');
    expect(element(id)?.name).toBe('Note');
    expect(commands).toEqual(['element.create']);
    expect(pipeline.get().step).toBe('idle');
  });

  it('the class box lists creatable classes, filtered by name or digit', () => {
    const { pipeline } = setup();
    pipeline.open({ at: { x: 0, y: 0 } });
    expect(pipeline.options().map((c) => c.id)).toEqual([
      'person',
      'creature',
      'location',
      'faction',
      'item',
      'event',
      'quest',
      'note',
    ]);
    pipeline.setQuery('ON');
    expect(pipeline.options().map((c) => c.id)).toEqual(['person', 'location', 'faction']);
    pipeline.setQuery('7');
    expect(pipeline.options().map((c) => c.id)).toEqual(['event']);
    pipeline.setQuery('character');
    expect(pipeline.options()).toEqual([]);
  });

  it('pickFirst takes the first filtered class; nothing happens when none match', async () => {
    const { pipeline, element } = setup();
    pipeline.open({ at: { x: 0, y: 0 } });
    pipeline.setQuery('que');
    const id = await pipeline.pickFirst();
    expect(id && element(id)?.class).toBe('quest');
    await pipeline.submitName('Find the heir');

    pipeline.open({ at: { x: 0, y: 0 } });
    pipeline.setQuery('zzz');
    expect(await pipeline.pickFirst()).toBeUndefined();
    expect(pipeline.get().step).toBe('classBox');
  });

  it('cancel closes the class box without creating anything', () => {
    const { pipeline, workingCopy } = setup();
    pipeline.open({ at: { x: 0, y: 0 } });
    pipeline.cancel();
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(workingCopy.records().size).toBe(0);
  });

  it('passes origin and connection through to element.create', async () => {
    const calls: unknown[] = [];
    const pipeline = createCreationPipeline({
      run: async (name, args) => {
        calls.push([name, args]);
        return { id: 'el-new' };
      },
      label: (id) => id,
    });
    pipeline.open({ at: { x: 1, y: 2 }, from: 'el-origin', connection: { direction: 'in' } });
    await pipeline.pickClass('item');
    expect(calls).toEqual([
      [
        'element.create',
        {
          class: 'item',
          name: 'item',
          at: { x: 1, y: 2 },
          from: 'el-origin',
          connection: { direction: 'in' },
        },
      ],
    ]);
  });

  it('notifies completion listeners after the name step', async () => {
    const { pipeline } = setup();
    const done: string[] = [];
    pipeline.onComplete(({ id }) => done.push(id));
    pipeline.open({ at: { x: 0, y: 0 } });
    const id = await pipeline.pickClass('person');
    expect(done).toEqual([]);
    await pipeline.submitName('Alrik');
    expect(done).toEqual([id]);
  });
});

describe('Creation Pipeline with Connections', () => {
  function connected() {
    const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    const registry = createRegistry(() => ({ isGM: true }));
    let n = 0;
    const newId = () => `id-${++n}`;
    const commands: string[] = [];
    const run = (name: string, args: object) => {
      commands.push(name);
      return registry.run(name, args);
    };
    for (const c of [
      ...elementCommands({
        workingCopy: () => workingCopy,
        newId,
        afterCreate: [connectOnCreate({ workingCopy: () => workingCopy, run })],
      }),
      ...connectionCommands({ workingCopy: () => workingCopy, newId }),
    ])
      registry.register(c);
    const pipeline = createCreationPipeline({ run, label: (id) => LABELS[id] ?? id });
    const connectionsOf = (id: string) =>
      [...workingCopy.records().values()]
        .flatMap((r) => readConnection(r) ?? [])
        .filter((c) => c.from === id || c.to === id);
    return { pipeline, workingCopy, commands, connectionsOf, registry };
  }

  /**
   * §14: every entry point reaches a connected Element in ≤ 2 user commands. Each step
   * below is one user input; the element is connected once the last one resolves.
   */
  it.each<[string, (p: CreationPipeline, from: string) => (() => Promise<unknown>)[]]>([
    [
      'drag-out from a Connection Point',
      (p, from) => [
        async () => p.open({ at: { x: 300, y: 0 }, from, connection: { direction: 'out' } }),
        () => p.pickClass('item'),
      ],
    ],
    [
      'Node context menu class box',
      (p, from) => [async () => p.open({ at: { x: 300, y: 0 }, from }), () => p.pickClass('item')],
    ],
    [
      'digit key on a selected Node',
      (p, from) => [() => p.create({ at: { x: 0, y: 0 }, from }, 'item')],
    ],
  ])('%s', async (_name, inputs) => {
    const { pipeline, connectionsOf, registry } = connected();
    const { id: origin } = await registry.run<{ id: string }>('element.create', {
      class: 'person',
      name: 'Alrik',
    });
    const steps = inputs(pipeline, origin);
    expect(steps.length).toBeLessThanOrEqual(2);
    let id: unknown;
    for (const step of steps) id = await step();
    expect(connectionsOf(id as string)).toMatchObject([{ from: origin, to: id, type: 'owns' }]);
  });

  it('after the name, the Connection editor opens on the new Connection', async () => {
    const { pipeline, registry, commands } = connected();
    const { id: origin } = await registry.run<{ id: string }>('element.create', {
      class: 'person',
      name: 'Alrik',
    });
    const done: string[] = [];
    pipeline.onComplete(({ id }) => done.push(id));
    commands.length = 0;
    const id = await pipeline.create({ at: { x: 0, y: 0 }, from: origin }, 'person');
    await pipeline.submitName('Rondra');
    expect(pipeline.get()).toMatchObject({ step: 'connection', elementId: id });
    expect(done).toEqual([]);
    await pipeline.submitLabel(' loves ');
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(done).toEqual([id]);
    expect(commands).toEqual([
      'element.create',
      'connection.create',
      'element.rename',
      'connection.setLabel',
    ]);
  });

  it('a Connection made on its own opens its editor straight away; an empty label writes nothing', async () => {
    const { pipeline, commands } = connected();
    pipeline.editConnection('cn-1');
    expect(pipeline.get()).toEqual({ step: 'connection', id: 'cn-1' });
    await pipeline.submitLabel('  ');
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(commands).toEqual([]);
  });

  it('rename (F2) reuses the name step without completing a creation', async () => {
    const { pipeline, registry, commands } = connected();
    const { id } = await registry.run<{ id: string }>('element.create', {
      class: 'person',
      name: 'Alrik',
    });
    const done: string[] = [];
    pipeline.onComplete(({ id }) => done.push(id));
    commands.length = 0;
    pipeline.rename(id, 'Alrik');
    expect(pipeline.get()).toEqual({ step: 'name', id });
    await pipeline.submitName('Alrik');
    pipeline.rename(id, 'Alrik');
    await pipeline.submitName('Ulf');
    expect(commands).toEqual(['element.rename']);
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(done).toEqual([]);
  });

  it('cancel in the Connection editor completes the element', async () => {
    const { pipeline, registry } = connected();
    const { id: origin } = await registry.run<{ id: string }>('element.create', {
      class: 'event',
      name: 'Feast',
    });
    const done: string[] = [];
    pipeline.onComplete(({ id }) => done.push(id));
    const id = await pipeline.create({ at: { x: 0, y: 0 }, from: origin }, 'person');
    await pipeline.submitName('');
    pipeline.cancel();
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(done).toEqual([id]);
  });
});
