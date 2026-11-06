import { describe, expect, it } from 'vitest';
import {
  createNscZucht,
  type CreatedActor,
  type GeneratorApp,
  type NscZuchtDeps,
} from './nsc-zucht';

function fakeApp() {
  const closeListeners: (() => void)[] = [];
  const app = {
    rendered: false,
    closed: 0,
    render() {
      app.rendered = true;
    },
    async close() {
      app.closed++;
      for (const l of closeListeners.splice(0)) l();
    },
    addEventListener(_: 'close', listener: () => void) {
      closeListeners.push(listener);
    },
  };
  return app;
}

function setup(over: Partial<NscZuchtDeps> = {}) {
  const app = fakeApp();
  const listeners = new Set<(actor: CreatedActor, userId: string) => void>();
  const warnings: string[] = [];
  let loads = 0;
  const deps: NscZuchtDeps = {
    active: () => true,
    isGM: () => true,
    load: async () => {
      loads++;
      return app as GeneratorApp;
    },
    onCreateActor(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    userId: () => 'me',
    warn: (m) => warnings.push(m),
    localize: (k) => k,
    ...over,
  };
  const zucht = createNscZucht(deps);
  const create = (actor: Partial<CreatedActor>, userId = 'me') => {
    const full: CreatedActor = { uuid: 'Actor.a1', name: 'Ulf', type: 'npc', ...actor };
    for (const l of [...listeners]) l(full, userId);
  };
  const request = () => {
    const abort = new AbortController();
    return { abort, req: { class: 'person' as const, at: { x: 0, y: 0 }, signal: abort.signal } };
  };
  return { zucht, app, listeners, warnings, create, request, loads: () => loads };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('NSC Zucht Source Step provider (spec 1.1 §B.3)', () => {
  it('available for a GM with dsa5-mastersworkshop active', () => {
    expect(setup().zucht.unavailable('person')).toBeUndefined();
  });

  it('greyed without the module, or for a non-GM', () => {
    expect(setup({ active: () => false }).zucht.unavailable('person')).toBe(
      'SILK.Source.GeneratorMissing',
    );
    expect(setup({ isGM: () => false }).zucht.unavailable('person')).toBe(
      'SILK.Source.GeneratorGMOnly',
    );
  });

  it('the first Actor created while open is the pick; the generator closes', async () => {
    const t = setup();
    const { req } = t.request();
    const picking = t.zucht.pick(req);
    await tick();
    expect(t.app.rendered).toBe(true);
    t.create({ uuid: 'Actor.ulf', name: 'Ulf Hjaldarson' });
    t.create({ uuid: 'Actor.second', name: 'Second' });
    expect(await picking).toEqual({
      source: { kind: 'generator', id: 'nsc-zucht', actorUuid: 'Actor.ulf' },
      name: 'Ulf Hjaldarson',
    });
    expect(t.app.closed).toBe(1);
    expect(t.listeners.size).toBe(0);
  });

  it("ignores other users' Actors, Silk's own and non-NPCs", async () => {
    const t = setup();
    const { req } = t.request();
    const picking = t.zucht.pick(req);
    await tick();
    t.create({ uuid: 'Actor.other' }, 'someone');
    t.create({ uuid: 'Actor.silk', silk: true });
    t.create({ uuid: 'Actor.pc', type: 'character' });
    t.create({ uuid: 'Actor.ok' });
    expect((await picking)?.source).toMatchObject({ actorUuid: 'Actor.ok' });
  });

  it('closed without generating: no pick (back to the Source Step)', async () => {
    const t = setup();
    const { req } = t.request();
    const picking = t.zucht.pick(req);
    await tick();
    await t.app.close();
    expect(await picking).toBeUndefined();
    expect(t.listeners.size).toBe(0);
  });

  it('cancelling the creation closes the generator', async () => {
    const t = setup();
    const { abort, req } = t.request();
    const picking = t.zucht.pick(req);
    await tick();
    abort.abort();
    expect(await picking).toBeUndefined();
    expect(t.app.closed).toBe(1);
    expect(t.listeners.size).toBe(0);
  });

  it('a failed import greys the Generator with a tooltip and warns', async () => {
    const t = setup({
      load: async () => {
        throw new Error('no such module');
      },
    });
    const { req } = t.request();
    expect(await t.zucht.pick(req)).toBeUndefined();
    expect(t.zucht.unavailable('person')).toBe('SILK.Source.GeneratorFailed');
    expect(t.warnings).toEqual(['SILK.Source.GeneratorFailed']);
  });

  it('probe: a module that does not load greys the Generator before any click', async () => {
    const t = setup({
      probe: async () => {
        throw new Error('changed');
      },
    });
    await t.zucht.probe();
    expect(t.zucht.unavailable('person')).toBe('SILK.Source.GeneratorFailed');
    expect(t.warnings).toEqual([]);
  });
});
