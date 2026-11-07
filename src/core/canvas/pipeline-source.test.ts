/**
 * Source Step (spec 1.1 §B.1): class → Source Step (Person, Creature, Location, Event) → name
 * → label.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../commands/registry';
import { connectionCommands, connectOnCreate, readConnection } from '../connections';
import { elementCommands, readElement } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import {
  createCreationPipeline,
  pipelineCommands,
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
  it('Person, Creature, Location and Event take the Source Step after the class; nothing is created yet', async () => {
    const { pipeline, workingCopy } = setup();
    for (const cls of ['person', 'creature', 'location', 'event'] as const) {
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
    for (const cls of ['item', 'note', 'faction', 'quest'] as const) {
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

describe('Compendium World pick (spec 1.1 §B.2 Outcome)', () => {
  const world = (uuid: string, name: string): SourceProvider => ({
    unavailable: () => undefined,
    pick: async () => ({ adopt: { uuid }, name }),
  });

  /** A stand-in `adopt.doc` that records its args. */
  function withAdopt(s: ReturnType<typeof setup>, result: object | null) {
    const adopted: object[] = [];
    s.registry.register({
      name: 'adopt.doc',
      title: 'adopt.doc',
      available: () => true,
      run: async (args: object) => {
        adopted.push(args);
        return result;
      },
    });
    return adopted;
  }

  it('Adopts the world actor instead of creating; the name step is prefilled', async () => {
    const s = setup({ compendium: world('Actor.ulf', 'Ulf') });
    const adopted = withAdopt(s, { id: 'el-ulf', name: 'Ulf' });
    await s.pipeline.create({ at: { x: 7, y: 8 } }, 'person');
    expect(await s.pipeline.pickSource('compendium')).toBe('el-ulf');
    expect(adopted).toEqual([{ uuid: 'Actor.ulf', class: 'person', at: { x: 7, y: 8 } }]);
    expect(s.commands()).toEqual(['adopt.doc']);
    expect(s.pipeline.get()).toEqual({ step: 'name', id: 'el-ulf' });
    await s.pipeline.submitName('Ulf');
    expect(s.commands()).toEqual(['adopt.doc']);
  });

  it('from a Node: connects with the drag direction, then the Connection editor', async () => {
    const s = setup({ compendium: world('Actor.ulf', 'Ulf') });
    const adopted = withAdopt(s, { id: 'el-ulf', name: 'Ulf', connectionId: 'c1' });
    await s.pipeline.create(
      { at: { x: 0, y: 0 }, from: 'gareth', connection: { direction: 'in' } },
      'person',
    );
    await s.pipeline.pickSource('compendium');
    expect(adopted).toEqual([
      {
        uuid: 'Actor.ulf',
        class: 'person',
        at: { x: 0, y: 0 },
        connectTo: 'gareth',
        connection: { direction: 'in' },
      },
    ]);
    await s.pipeline.submitName('');
    expect(s.pipeline.get()).toEqual({ step: 'connection', id: 'c1', elementId: 'el-ulf' });
  });

  it('a cancelled Adopt ends the pipeline', async () => {
    const s = setup({ compendium: world('Actor.ulf', 'Ulf') });
    withAdopt(s, null);
    await s.pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    expect(await s.pipeline.pickSource('compendium')).toBeUndefined();
    expect(s.pipeline.get()).toEqual({ step: 'idle' });
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
      'digit + → (Location, Scene picker class)',
      (p, from) => [
        () => p.create({ at: { x: 0, y: 0 }, from }, 'location'),
        () => p.pickSource('blank'),
      ],
    ],
    [
      'digit + → (Event)',
      (p, from) => [
        () => p.create({ at: { x: 0, y: 0 }, from }, 'event'),
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
    // Connected either way: the inferred Connection type decides the direction (§5).
    expect(connections).toHaveLength(1);
    expect([connections[0]?.from, connections[0]?.to].sort()).toEqual([origin, id].sort());
  });
});

describe('pipeline commands (ADR 0003): class box and Source Step through the registry', () => {
  function withCommands(sources?: SourceProviders) {
    const s = setup(sources);
    for (const c of pipelineCommands(s.pipeline)) s.registry.register(c);
    return s;
  }

  it('pipeline.search filters the class box; pipeline.pickClass without a class takes the first', async () => {
    const s = withCommands();
    s.pipeline.open({ at: { x: 0, y: 0 } });
    await s.registry.run('pipeline.search', { query: 'not' });
    expect(s.pipeline.options().map((c) => c.id)).toEqual(['note']);
    const { id } = await s.registry.run<{ id?: string }>('pipeline.pickClass', {});
    expect(s.element(id)).toMatchObject({ class: 'note' });
  });

  it('pipeline.pickClass { class } then pipeline.pickSource { kind: blank } creates', async () => {
    const s = withCommands();
    s.pipeline.open({ at: { x: 1, y: 1 } });
    expect(await s.registry.run('pipeline.pickClass', { class: 'person' })).toEqual({});
    expect(s.pipeline.get()).toMatchObject({ step: 'source', class: 'person' });
    const { id } = await s.registry.run<{ id?: string }>('pipeline.pickSource', { kind: 'blank' });
    expect(s.pipeline.get()).toEqual({ step: 'name', id });
  });

  it('pipeline.pickSource on a provider returns while it is open; its pick finishes later', async () => {
    let pick!: (value: SourcePick) => void;
    const s = withCommands({
      compendium: { unavailable: () => undefined, pick: () => new Promise((r) => (pick = r)) },
    });
    await s.pipeline.create({ at: { x: 0, y: 0 } }, 'person');
    expect(await s.registry.run('pipeline.pickSource', { kind: 'compendium' })).toEqual({
      pending: 'compendium',
    });
    pick({
      source: { kind: 'compendium', uuid: 'Compendium.p.Actor.x' },
      name: 'X',
      img: 'x.webp',
    });
    await vi.waitFor(() => expect(s.pipeline.get().step).toBe('name'));
    // The Ghost shows the entry's portrait before Materialize.
    expect(s.calls[0]?.[1]).toMatchObject({ name: 'X', img: 'x.webp' });
  });

  it('a Scene pick passes its card thumb to element.create (1.1 §B.2.1)', async () => {
    const s = withCommands({
      compendium: {
        unavailable: () => undefined,
        pick: async () => ({
          source: { kind: 'compendium', uuid: 'Compendium.p.Scene.x' },
          name: 'Gareth',
          img: 'gareth.webp',
          thumb: 'gareth-thumb.webp',
        }),
      },
    });
    await s.pipeline.create({ at: { x: 0, y: 0 } }, 'location');
    const id = await s.pipeline.pickSource('compendium');
    expect(s.element(id)).toMatchObject({
      class: 'location',
      img: 'gareth.webp',
      thumb: 'gareth-thumb.webp',
    });
  });

  it('pipeline.cancel ends the creation', async () => {
    const s = withCommands();
    await s.pipeline.create({ at: { x: 0, y: 0 } }, 'creature');
    await s.registry.run('pipeline.cancel', {});
    expect(s.pipeline.get()).toEqual({ step: 'idle' });
  });
});
