import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { elementCommands, readElement } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCreationPipeline, type PipelineStep } from './pipeline';

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
