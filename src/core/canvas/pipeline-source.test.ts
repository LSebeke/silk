/** Source Step (spec 1.1 §B.1): class → Source Step (Person, Creature) → name → label. */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { connectionCommands, connectOnCreate, readConnection } from '../connections';
import { elementCommands, readElement } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import {
  createCreationPipeline,
  type CreationPipeline,
  type SourcePick,
  type SourceProvider,
  type SourceProviders,
} from './pipeline';

function setup(sources?: SourceProviders) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const registry = createRegistry(() => ({ isGM: true }));
  let n = 0;
  const newId = () => `id-${++n}`;
  const calls: [string, object][] = [];
  const run = (name: string, args: object) => {
    calls.push([name, args]);
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
  const pipeline = createCreationPipeline({
    run,
    label: (id) => id.charAt(0).toUpperCase() + id.slice(1),
    ...(sources ? { sources } : {}),
  });
  const element = (id: string | undefined) => readElement(id ? workingCopy.get(id) : undefined);
  const commands = () => calls.map(([name]) => name);
  return { pipeline, workingCopy, registry, calls, commands, element };
}

describe('Source Step', () => {
  it('Person and Creature take the Source Step after the class; nothing is created yet', async () => {
    const { pipeline, workingCopy } = setup();
    for (const cls of ['person', 'creature'] as const) {
      pipeline.open({ at: { x: 5, y: 6 }, anchor: { x: 50, y: 60 } });
      expect(await pipeline.pickClass(cls)).toBeUndefined();
      expect(pipeline.get()).toMatchObject({
        step: 'source',
        class: cls,
        at: { x: 5, y: 6 },
        anchor: { x: 50, y: 60 },
      });
      pipeline.cancel();
    }
    expect(workingCopy.records().size).toBe(0);
  });

  it('other classes skip it', async () => {
    const { pipeline } = setup();
    for (const cls of ['location', 'event', 'item', 'note'] as const) {
      const id = await pipeline.create({ at: { x: 0, y: 0 } }, cls);
      expect(pipeline.get()).toEqual({ step: 'name', id });
      await pipeline.submitName('');
    }
  });

  it('Blank creates the element with a blank source, then the name step', async () => {
    const { pipeline, calls, element } = setup();
    expect(await pipeline.create({ at: { x: 1, y: 2 } }, 'person')).toBeUndefined();
    const id = await pipeline.pickSource('blank');
    expect(pipeline.get()).toEqual({ step: 'name', id });
    expect(calls).toEqual([
      [
        'element.create',
        { class: 'person', name: 'Person', at: { x: 1, y: 2 }, source: { kind: 'blank' } },
      ],
    ]);
    await pipeline.submitName('Alrik');
    expect(element(id)).toMatchObject({ class: 'person', name: 'Alrik' });
    expect(element(id)?.source).toBeUndefined();
    expect(pipeline.get()).toEqual({ step: 'idle' });
  });

  it('a second → while the first is creating does nothing', async () => {
    const { pipeline, commands } = setup();
    await pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    const [first, second] = await Promise.all([
      pipeline.pickSource('blank'),
      pipeline.pickSource('blank'),
    ]);
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(commands()).toEqual(['element.create']);
  });

  it('without providers, Compendium and Generator are greyed with a reason; Generator is not for Creatures', () => {
    const { pipeline } = setup();
    void pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    expect(pipeline.get()).toMatchObject({
      choices: [
        { kind: 'compendium', available: false, reason: 'SILK.Source.Unavailable' },
        { kind: 'generator', available: false, reason: 'SILK.Source.Unavailable' },
        { kind: 'blank', available: true },
      ],
    });
    pipeline.cancel();
    void pipeline.create({ at: { x: 0, y: 0 } }, 'creature');
    expect(pipeline.get()).toMatchObject({
      choices: [
        { kind: 'compendium', available: false },
        { kind: 'generator', available: false, reason: 'SILK.Source.NotForClass' },
        { kind: 'blank', available: true },
      ],
    });
  });

  it('a greyed choice is inert', async () => {
    const { pipeline, calls } = setup();
    await pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    expect(await pipeline.pickSource('compendium')).toBeUndefined();
    expect(await pipeline.pickSource('generator')).toBeUndefined();
    expect(pipeline.get().step).toBe('source');
    expect(calls).toEqual([]);
  });

  it('cancel (↓ / Esc) ends the creation without creating anything', async () => {
    const { pipeline, workingCopy } = setup();
    await pipeline.create({ at: { x: 0, y: 0 } }, 'creature');
    pipeline.cancel();
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(workingCopy.records().size).toBe(0);
  });

  it('keeps origin and connection through the Source Step, then the Connection editor', async () => {
    const { pipeline, registry, workingCopy, commands } = setup();
    const { id: origin } = await registry.run<{ id: string }>('element.create', {
      class: 'location',
      name: 'Gareth',
    });
    await pipeline.create({ at: { x: 0, y: 0 }, from: origin }, 'person');
    const id = await pipeline.pickSource('blank');
    await pipeline.submitName('Rondra');
    expect(pipeline.get()).toMatchObject({ step: 'connection', elementId: id });
    await pipeline.submitLabel('lives in');
    const connections = [...workingCopy.records().values()].flatMap((r) => readConnection(r) ?? []);
    expect(connections).toMatchObject([{ from: origin, to: id, label: 'lives in' }]);
    expect(commands()).toEqual([
      'element.create',
      'connection.create',
      'element.rename',
      'connection.setLabel',
    ]);
  });
});

describe('Source providers (Compendium T33, Generator T34)', () => {
  const provider = (pick: SourceProvider['pick'], unavailable?: string): SourceProvider => ({
    unavailable: () => unavailable,
    pick,
  });

  it('a registered provider makes its choice available; its reason greys it', () => {
    const { pipeline } = setup({
      compendium: provider(async () => undefined),
      generator: provider(async () => undefined, 'SILK.Source.GeneratorMissing'),
    });
    void pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    expect(pipeline.get()).toMatchObject({
      choices: [
        { kind: 'compendium', available: true },
        { kind: 'generator', available: false, reason: 'SILK.Source.GeneratorMissing' },
        { kind: 'blank', available: true },
      ],
    });
  });

  it('a pick creates the element from its source, the name step prefilled with its name', async () => {
    const asked: unknown[] = [];
    const source = { kind: 'compendium', uuid: 'Compendium.dsa5.npcs.Actor.x' } as const;
    const { pipeline, calls, element, commands } = setup({
      compendium: provider(async (req) => {
        asked.push(req);
        return { source, name: 'Wolf' };
      }),
    });
    await pipeline.create({ at: { x: 3, y: 4 } }, 'creature');
    const id = await pipeline.pickSource('compendium');
    expect(asked).toMatchObject([{ class: 'creature', at: { x: 3, y: 4 } }]);
    expect(calls).toEqual([
      ['element.create', { class: 'creature', name: 'Wolf', at: { x: 3, y: 4 }, source }],
    ]);
    expect(pipeline.get()).toEqual({ step: 'name', id });
    expect(element(id)).toMatchObject({ name: 'Wolf', source });
    // Unchanged prefill: no rename.
    await pipeline.submitName('Wolf');
    expect(commands()).toEqual(['element.create']);
  });

  it('while the provider is open the step stays pending; a closed provider returns to the Source Step', async () => {
    let close!: (value: undefined) => void;
    const { pipeline, calls } = setup({
      compendium: provider(() => new Promise((resolve) => (close = resolve))),
    });
    await pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    const picking = pipeline.pickSource('compendium');
    expect(pipeline.get()).toMatchObject({ step: 'source', pending: 'compendium' });
    // The compass is inert while the provider is open.
    expect(await pipeline.pickSource('blank')).toBeUndefined();
    close(undefined);
    expect(await picking).toBeUndefined();
    expect(pipeline.get()).toMatchObject({ step: 'source', class: 'person' });
    expect(pipeline.get()).not.toHaveProperty('pending');
    expect(calls).toEqual([]);
  });

  it('a pick that resolves after cancel creates nothing', async () => {
    let done!: (value: SourcePick) => void;
    let signal: AbortSignal | undefined;
    const { pipeline, calls } = setup({
      generator: provider(
        (req) =>
          new Promise((resolve) => {
            signal = req.signal;
            done = resolve;
          }),
      ),
    });
    await pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    const picking = pipeline.pickSource('generator');
    pipeline.cancel();
    // The provider hears it, to close its window.
    expect(signal?.aborted).toBe(true);
    done({ source: { kind: 'generator', id: 'nsc-zucht', actorUuid: 'Actor.ulf' }, name: 'Ulf' });
    expect(await picking).toBeUndefined();
    expect(pipeline.get()).toEqual({ step: 'idle' });
    expect(calls).toEqual([]);
  });

  it('a provider that failed on open is greyed when the Source Step comes back', async () => {
    let reason: string | undefined;
    const { pipeline } = setup({
      generator: {
        unavailable: () => reason,
        pick: async () => {
          reason = 'SILK.Source.GeneratorFailed';
          return undefined;
        },
      },
    });
    await pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    await pipeline.pickSource('generator');
    expect(pipeline.get()).toMatchObject({
      step: 'source',
      choices: [
        { kind: 'compendium' },
        { kind: 'generator', available: false, reason: 'SILK.Source.GeneratorFailed' },
        { kind: 'blank', available: true },
      ],
    });
  });
});

describe('Interaction budget with a Source Step (spec 1.1 §B.4)', () => {
  /** Each step is one user action; the element is connected once the last one resolves. */
  it.each<[string, (p: CreationPipeline, from: string) => (() => Promise<unknown>)[]]>([
    [
      'digit + →',
      (p, from) => [
        () => p.create({ at: { x: 0, y: 0 }, from }, 'person'),
        () => p.pickSource('blank'),
      ],
    ],
    [
      'palette drop on a Node + →',
      (p, from) => [
        () => p.create({ at: { x: 0, y: 0 }, from }, 'creature'),
        () => p.pickSource('blank'),
      ],
    ],
    [
      // The spec counts the class pick, not opening the box (§B.4 "class pick + →").
      'class pick + →',
      (p, from) => {
        p.open({ at: { x: 300, y: 0 }, from });
        return [() => p.pickClass('creature'), () => p.pickSource('blank')];
      },
    ],
  ])('%s', async (_name, inputs) => {
    const { pipeline, registry, workingCopy } = setup();
    const { id: origin } = await registry.run<{ id: string }>('element.create', {
      class: 'location',
      name: 'Gareth',
    });
    const steps = inputs(pipeline, origin);
    expect(steps.length).toBeLessThanOrEqual(2);
    let id: unknown;
    for (const step of steps) id = await step();
    const connections = [...workingCopy.records().values()].flatMap((r) => readConnection(r) ?? []);
    expect(connections).toMatchObject([{ from: origin, to: id }]);
  });
});
