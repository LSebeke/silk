import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../canon';
import { createRegistry } from '../commands/registry';
import { elementCommands } from '../elements/commands';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCanvasState } from './canvas-state';
import { canvasCoreCommands } from './commands';
import { createCanvasFilter, createRevealedSource, filterCommands } from './filter-commands';
import { createCanvasSearch, searchCommands } from './search-commands';
import { createViewState } from './view-state';

const el = (id: string, cls = 'person', extra: Record<string, unknown> = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: cls, name: id, position: { x: 0, y: 0 }, ...extra },
});

async function setup(records: CanonRecord[]) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  await workingCopy.set(records);
  let stored: unknown = {};
  const viewState = createViewState({ load: () => stored, save: async (v) => void (stored = v) });
  const revealed = createRevealedSource({
    revelationMap: async () => null,
    ownership: () => false,
  });
  const filter = createCanvasFilter({ workingCopy: () => workingCopy, viewState, revealed });
  const state = createCanvasState();
  const search = createCanvasSearch({ workingCopy: () => workingCopy, filter, state });
  const registry = createRegistry(() => ({ isGM: true }));
  let n = 0;
  for (const c of [
    ...filterCommands(filter),
    ...canvasCoreCommands({ workingCopy: () => workingCopy, state }),
    ...searchCommands(search),
    ...elementCommands({
      workingCopy: () => workingCopy,
      newId: () => `new${++n}`,
      afterCreate: [search.afterCreate],
    }),
  ])
    registry.register(c);
  return { registry, filter, state, search, workingCopy };
}

describe('canvas.search / canvas.jumpTo', () => {
  it('canvas.search returns hits; the index follows the working copy', async () => {
    const t = await setup([el('a', 'person', { name: 'Alrik' })]);
    expect(await t.registry.run('canvas.search', { query: 'alr' })).toMatchObject([
      { kind: 'node', id: 'a' },
    ]);
    await t.workingCopy.set([el('b', 'person', { name: 'Alrike' })]);
    expect(await t.registry.run('canvas.search', { query: 'alr' })).toHaveLength(2);
  });

  it('jumping selects the Node and announces the jump', async () => {
    const t = await setup([el('a'), el('b')]);
    const jumps: string[] = [];
    t.search.onJump((id) => jumps.push(id));
    await t.registry.run('canvas.jumpTo', { id: 'b' });
    expect(t.state.get().selection).toEqual(['b']);
    expect(jumps).toEqual(['b']);
  });

  it('a filtered-out Node is shown, marked filtered, until deselected', async () => {
    const t = await setup([el('a'), el('b', 'item')]);
    await t.registry.run('filter.set', { dimension: 'class', values: ['person'] });
    expect(t.filter.visibleIds()).toEqual(['a']);
    await t.registry.run('canvas.jumpTo', { id: 'b' });
    const r = t.filter.result();
    expect([...r.visible].sort()).toEqual(['a', 'b']);
    expect(r.matches('b')).toBe(false);
    await t.registry.run('canvas.select', { ids: ['b', 'a'] });
    expect(t.filter.visibleIds()).toContain('b');
    await t.registry.run('canvas.select', { ids: ['a'] });
    expect(t.filter.visibleIds()).toEqual(['a']);
  });

  it('rejects unknown ids', async () => {
    const t = await setup([el('a')]);
    await expect(t.registry.run('canvas.jumpTo', { id: 'nope' })).rejects.toThrow(/nope/);
  });

  it('a newly created Node that filters would hide is shown the same way', async () => {
    const t = await setup([el('a')]);
    await t.registry.run('filter.set', { dimension: 'class', values: ['item'] });
    await t.registry.run('element.create', { class: 'person', name: 'P' });
    expect(t.filter.visibleIds()).toEqual(['new1']);
    expect(t.filter.result().matches('new1')).toBe(false);
    await t.registry.run('element.create', { class: 'item', name: 'I' });
    expect(t.filter.result().matches('new2')).toBe(true);
    await t.registry.run('canvas.select', { ids: ['new2'] });
    expect(t.filter.visibleIds()).toEqual(['new2']);
  });
});
