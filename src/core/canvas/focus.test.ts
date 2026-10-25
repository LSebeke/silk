import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../canon';
import { createRegistry } from '../commands/registry';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCanvasState } from './canvas-state';
import { createCanvasFilter, createRevealedSource, filterCommands } from './filter-commands';
import {
  cameraMove,
  createFocus,
  focusCommands,
  sceneSeeds,
  type ActiveScene,
  type CameraInput,
} from './focus';
import { createViewState } from './view-state';

const el = (id: string, extra: Record<string, unknown> = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: 'person', name: id, position: { x: 0, y: 0 }, ...extra },
});
const snap = (...records: CanonRecord[]) => new Map(records.map((r) => [r.id, r]));

describe('Focus View seeds', () => {
  it("are the active Scene's element and its tokens' Materialized elements", () => {
    const records = snap(
      el('ev', { class: 'event', uuid: 'JournalEntry.j1' }),
      el('alrik', { uuid: 'Actor.a1' }),
      el('bosper', { uuid: 'Actor.a2' }),
      el('ghost'),
    );
    expect(
      sceneSeeds(records, { id: 's1', sceneOf: 'ev', actorIds: ['a1', 'a9', null] }).sort(),
    ).toEqual(['alrik', 'ev']);
  });

  it('are empty without an active Scene, and skip a Scene link to a missing element', () => {
    const records = snap(el('alrik', { uuid: 'Actor.a1' }));
    expect(sceneSeeds(records, undefined)).toEqual([]);
    expect(sceneSeeds(records, { id: 's1', sceneOf: 'gone', actorIds: [] })).toEqual([]);
  });
});

describe('Focus View camera', () => {
  // 1000×600 window at zoom 1, origin at 0,0: Nodes at x ≥ 1000 are offscreen.
  const at: Record<string, { x: number; y: number }> = {
    a: { x: 0, y: 0 },
    b: { x: 300, y: 0 },
    far: { x: 2000, y: 0 },
  };
  const input = (patch: Partial<CameraInput>): CameraInput => ({
    reason: 'local',
    shift: false,
    visible: ['a', 'b'],
    added: [],
    selection: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { width: 1000, height: 600 },
    rect: (id) => (at[id] ? { ...at[id], width: 190, height: 80 } : undefined),
    ...patch,
  });

  it('fits the new focus on a Scene change', () => {
    expect(cameraMove(input({ reason: 'scene', added: ['b'] }))).toEqual({ ids: ['a', 'b'] });
  });

  it('stays put when newly shown Nodes are onscreen', () => {
    expect(cameraMove(input({ added: ['b'] }))).toBeUndefined();
  });

  it('moves without zooming in when a newly shown Node is offscreen', () => {
    expect(
      cameraMove(
        input({
          visible: ['a', 'b', 'far'],
          added: ['far'],
          selection: ['a'],
          viewport: { x: 0, y: 0, zoom: 0.8 },
        }),
      ),
    ).toEqual({ ids: ['far', 'a'], maxZoom: 0.8 });
  });

  it('holds while Shift is down: the move is dropped', () => {
    expect(cameraMove(input({ reason: 'scene', shift: true }))).toBeUndefined();
    expect(cameraMove(input({ shift: true, visible: ['far'], added: ['far'] }))).toBeUndefined();
  });

  it('does nothing for an empty focus', () => {
    expect(cameraMove(input({ reason: 'scene', visible: [] }))).toBeUndefined();
  });
});

const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type: 'free', direction: 'directed', label: '' },
});

/** Chain ev — a — b — c — d, plus x — y apart; Alrik (token) linked to x. */
async function setup(scene: ActiveScene | null = { id: 's1', sceneOf: 'ev', actorIds: [] }) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  await workingCopy.set([
    el('ev', { class: 'event', uuid: 'JournalEntry.j1' }),
    ...['a', 'b', 'c', 'd', 'x', 'y'].map((id) => el(id)),
    el('alrik', { uuid: 'Actor.a1' }),
    link('l1', 'ev', 'a'),
    link('l2', 'a', 'b'),
    link('l3', 'b', 'c'),
    link('l4', 'c', 'd'),
    link('l5', 'x', 'y'),
    link('l6', 'alrik', 'x'),
  ]);
  let stored: unknown = {};
  const viewState = createViewState({ load: () => stored, save: async (v) => void (stored = v) });
  const state = createCanvasState();
  let active = scene ?? undefined;
  const focus = createFocus({
    workingCopy: () => workingCopy,
    viewState,
    state,
    activeScene: () => active,
  });
  const filter = createCanvasFilter({
    workingCopy: () => workingCopy,
    viewState,
    revealed: createRevealedSource({ revelationMap: async () => null, ownership: () => false }),
    focus,
  });
  const registry = createRegistry(() => ({ isGM: true }));
  for (const c of [...filterCommands(filter), ...focusCommands(focus)]) registry.register(c);
  await registry.run('filter.set', { dimension: 'hops', values: ['focus'] });
  const reasons: string[] = [];
  focus.subscribe((reason) => reasons.push(reason));
  return {
    registry,
    focus,
    filter,
    state,
    reasons,
    stored: () => stored as Record<string, unknown>,
    visible: () => filter.visibleIds().sort(),
    setScene(next: ActiveScene | undefined) {
      active = next;
      focus.sceneChanged();
    },
  };
}

describe('Focus View', () => {
  it('shows Nodes within N hops (default 2) of the active Scene; focus.setHops changes N', async () => {
    const t = await setup();
    expect(t.visible()).toEqual(['a', 'b', 'ev']);
    await t.registry.run('focus.setHops', { n: 1 });
    expect(t.visible()).toEqual(['a', 'ev']);
    expect(t.stored()['hops']).toBe(1);
    await expect(t.registry.run('focus.setHops', { n: -1 })).rejects.toThrow(/hops/);
  });

  it("seeds from the Scene's tokens' elements too", async () => {
    const t = await setup({ id: 's1', actorIds: ['a1'] });
    expect(t.visible()).toEqual(['alrik', 'x', 'y']);
  });

  it('adds the selection as a temporary seed; deselecting collapses it', async () => {
    const t = await setup();
    t.state.select(['d']);
    expect(t.visible()).toEqual(['a', 'b', 'c', 'd', 'ev']);
    t.state.select(['x', 'd']);
    expect(t.visible()).toEqual(['a', 'alrik', 'b', 'c', 'd', 'ev', 'x', 'y']);
    t.state.select([]);
    expect(t.visible()).toEqual(['a', 'b', 'ev']);
  });

  it('always shows Focus Pins, which are not seeds; pins persist in the view state', async () => {
    const t = await setup();
    await t.registry.run('focus.pin', { ids: ['x'] });
    expect(t.visible()).toEqual(['a', 'b', 'ev', 'x']);
    expect(t.stored()['pins']).toEqual(['x']);
    await t.registry.run('focus.unpin', { ids: ['x'] });
    expect(t.visible()).toEqual(['a', 'b', 'ev']);
  });

  it('with no Scene and no selection shows only the pins (no seeds: the canvas hints)', async () => {
    const t = await setup(null);
    await t.registry.run('focus.pin', { ids: ['d'] });
    expect(t.focus.seeds()).toEqual([]);
    expect(t.visible()).toEqual(['d']);
  });

  it('a Scene change refocuses and clears "+N" extras; other changes are local', async () => {
    const t = await setup();
    await t.registry.run('filter.expandBadge', { id: 'b' });
    expect(t.visible()).toEqual(['a', 'b', 'c', 'ev']);
    t.state.select(['a']);
    await t.registry.run('focus.pin', { ids: ['y'] });
    expect(t.visible()).toEqual(['a', 'b', 'c', 'ev', 'y']);
    t.state.select([]);
    t.setScene({ id: 's2', actorIds: ['a1'] });
    await Promise.resolve();
    expect(t.visible()).toEqual(['alrik', 'x', 'y']);
    expect(t.filter.expanded()).toEqual([]);
    expect(t.reasons).toEqual(['local', 'local', 'local', 'scene']);
  });

  it('a repeated notice for the same active Scene is no Scene change', async () => {
    const t = await setup();
    t.setScene({ id: 's1', sceneOf: 'ev', actorIds: [] });
    expect(t.reasons).toEqual(['local']);
  });
});
