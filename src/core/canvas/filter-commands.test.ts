import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../canon';
import { emptyRevelationMap, setRevealed, type RevelationMap } from '../campaigns';
import { createRegistry } from '../commands/registry';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCanvasFilter, createRevealedSource, filterCommands } from './filter-commands';
import { createViewState } from './view-state';

const el = (id: string, cls = 'person', extra: Record<string, unknown> = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: cls, name: id, position: { x: 0, y: 0 }, ...extra },
});
const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type: 'free', direction: 'directed', label: '' },
});

async function setup(records: CanonRecord[], opts: { map?: RevelationMap | null } = {}) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  await workingCopy.set(records);
  let stored: unknown = { viewport: { x: 1, y: 2, zoom: 1 } };
  const viewState = createViewState({
    load: () => stored,
    save: async (v) => void (stored = v),
  });
  const revealed = createRevealedSource({
    revelationMap: async () => opts.map ?? null,
    ownership: (e) => e.uuid === 'Actor.owned',
  });
  const filter = createCanvasFilter({ workingCopy: () => workingCopy, viewState, revealed });
  const registry = createRegistry(() => ({ isGM: true }));
  for (const c of filterCommands(filter)) registry.register(c);
  return { registry, filter, workingCopy, stored: () => stored };
}

describe('filter commands', () => {
  it('filter.set narrows the visible set and persists in the view state', async () => {
    const t = await setup([el('a'), el('b', 'item'), el('c', 'location')]);
    expect([...t.filter.visibleIds()].sort()).toEqual(['a', 'b', 'c']);
    await t.registry.run('filter.set', { dimension: 'class', values: ['item', 'location'] });
    expect([...t.filter.visibleIds()].sort()).toEqual(['b', 'c']);
    expect(t.stored()).toEqual({
      viewport: { x: 1, y: 2, zoom: 1 },
      filters: { class: ['item', 'location'] },
    });
  });

  it('rejects unknown dimensions', async () => {
    const t = await setup([el('a')]);
    await expect(
      t.registry.run('filter.set', { dimension: 'campaign', values: ['x'] }),
    ).rejects.toThrow(/dimension/);
  });

  it('filter.clear clears one dimension, or everything incl. expanded badges', async () => {
    const t = await setup([el('a'), el('b', 'item'), link('ab', 'a', 'b')]);
    await t.registry.run('filter.set', { dimension: 'class', values: ['person'] });
    await t.registry.run('filter.set', { dimension: 'tag', values: ['x'] });
    expect(t.filter.visibleIds()).toEqual([]);
    await t.registry.run('filter.clear', { dimension: 'tag' });
    expect(t.filter.visibleIds()).toEqual(['a']);
    await t.registry.run('filter.expandBadge', { id: 'a' });
    expect([...t.filter.visibleIds()].sort()).toEqual(['a', 'b']);
    await t.registry.run('filter.clear', {});
    expect(t.stored()).toEqual({ viewport: { x: 1, y: 2, zoom: 1 }, filters: {}, expanded: [] });
  });

  it('filter.expandBadge shows the hidden neighbours of a Node', async () => {
    const t = await setup([el('a'), el('b', 'item'), el('c', 'item'), link('ab', 'a', 'b')]);
    await t.registry.run('filter.set', { dimension: 'class', values: ['person'] });
    expect(t.filter.result().badges.get('a')).toBe(1);
    await t.registry.run('filter.expandBadge', { id: 'a' });
    expect([...t.filter.visibleIds()].sort()).toEqual(['a', 'b']);
    expect(t.filter.result().badges.size).toBe(0);
  });

  it('notifies subscribers on filter and working copy changes', async () => {
    const t = await setup([el('a')]);
    const counts: number[] = [];
    t.filter.subscribe((r) => counts.push(r.visible.size));
    await t.registry.run('filter.set', { dimension: 'class', values: ['item'] });
    await t.workingCopy.set([el('b', 'item')]);
    expect(counts).toEqual([1, 0, 1]);
  });

  it('Revealed reads current ownership under main', async () => {
    const t = await setup([el('a', 'person', { uuid: 'Actor.owned' }), el('b')]);
    await t.registry.run('filter.set', { dimension: 'revealed', values: ['revealed'] });
    expect(t.filter.visibleIds()).toEqual(['a']);
  });

  it("Revealed reads the Campaign's Revelation Map under an Adventure", async () => {
    const map = setRevealed(emptyRevelationMap(), 'element', 'b', true);
    const t = await setup([el('a', 'person', { uuid: 'Actor.owned' }), el('b')], { map });
    await t.registry.run('filter.set', { dimension: 'revealed', values: ['revealed'] });
    expect(t.filter.visibleIds()).toEqual(['b']);
  });
});
