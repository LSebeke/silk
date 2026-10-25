import { describe, expect, it } from 'vitest';
import type { CanonRecord, JsonObject } from '../canon';
import { createRegistry } from '../commands/registry';
import { elementCommands, elementRecord } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createCanvasState } from './canvas-state';
import { canvasCoreCommands } from './commands';
import { joinFrameOnCreate, layoutCommands } from './layout-commands';

function setup(records: CanonRecord[] = []) {
  const backend = createMemoryBackend();
  const workingCopy = createWorkingCopy(backend, { canWrite: () => true });
  void workingCopy.set(records);
  const state = createCanvasState();
  const registry = createRegistry(() => ({ isGM: true }));
  let n = 0;
  const deps = { workingCopy: () => workingCopy, state };
  for (const c of canvasCoreCommands(deps)) registry.register(c);
  for (const c of layoutCommands({ ...deps, newId: () => `g${++n}`, groupLabel: () => 'Group' }))
    registry.register(c);
  const data = (id: string) => workingCopy.get(id)?.data;
  return { registry, workingCopy, state, data, backend };
}

const el = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  elementRecord(id, { class: 'person', name: id, position: { x, y }, ...extra });
const group = (id: string, data: JsonObject): CanonRecord => ({ kind: 'layoutGroup', id, data });
const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type: 'free', direction: 'directed', label: '' },
});
const frame = (id: string, parent: string | null, x: number, y: number, w: number, h: number) =>
  group(id, { label: id, parent, position: { x, y }, size: { width: w, height: h } });

describe('Visual Groups', () => {
  it('canvas.group frames the Nodes in a new top-level Visual Group', async () => {
    const { registry, data } = setup([el('a', 0, 0), el('b', 300, 100), el('c', 900, 900)]);
    const result = await registry.run('canvas.group', { ids: ['a', 'b'], label: 'Gareth' });
    expect(result).toEqual({ id: 'g1' });
    // Cards are 190×80; 30 px padding, 40 px more on top for the title.
    expect(data('g1')).toEqual({
      label: 'Gareth',
      parent: null,
      position: { x: -30, y: -70 },
      size: { width: 550, height: 280 },
    });
    expect(data('a')?.['group']).toBe('g1');
    expect(data('b')?.['group']).toBe('g1');
    expect(data('c')?.['group']).toBeUndefined();
  });

  it('nests: Nodes already in a group get a sub-group; the outer frame grows to fit', async () => {
    const outer = group('o', {
      label: 'Town',
      parent: null,
      position: { x: -30, y: -70 },
      size: { width: 550, height: 280 },
    });
    const { registry, data } = setup([
      outer,
      el('a', 0, 0, { group: 'o' }),
      el('b', 300, 100, { group: 'o' }),
    ]);
    await registry.run('canvas.group', { ids: ['a', 'b'] });
    expect(data('g1')).toEqual({
      label: 'Group',
      parent: 'o',
      position: { x: -30, y: -70 },
      size: { width: 550, height: 280 },
    });
    expect(data('a')?.['group']).toBe('g1');
    // Outer frame: around g1 plus padding and title.
    expect(data('o')).toMatchObject({
      position: { x: -60, y: -140 },
      size: { width: 610, height: 380 },
    });
  });

  it('groups a frame with a Node into a new parent group', async () => {
    const inner = group('i', {
      label: 'Inn',
      parent: null,
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
    });
    const { registry, data } = setup([inner, el('a', 0, 0, { group: 'i' }), el('b', 500, 0)]);
    const result = await registry.run('canvas.group', { ids: ['i', 'b', 'a'], label: ' Town ' });
    expect(result).toEqual({ id: 'g1' });
    expect(data('i')?.['parent']).toBe('g1');
    expect(data('b')?.['group']).toBe('g1');
    // `a` stays in `i`: an item inside another selected item keeps its frame.
    expect(data('a')?.['group']).toBe('i');
    expect(data('g1')).toMatchObject({ label: 'Town', parent: null });
  });

  it('groups the selection when no ids are given; nothing to group is a no-op', async () => {
    const { registry, state, data, workingCopy } = setup([el('a', 0, 0)]);
    expect(await registry.run('canvas.group', {})).toBeUndefined();
    state.select(['a']);
    await registry.run('canvas.group', {});
    expect(data('a')?.['group']).toBe('g1');
    expect(workingCopy.records().size).toBe(2);
  });

  it('canvas.ungroup moves contents to the parent group and deletes the frame', async () => {
    const { registry, data, workingCopy } = setup([
      group('o', {
        label: 'O',
        parent: null,
        position: { x: 0, y: 0 },
        size: { width: 9, height: 9 },
      }),
      group('i', {
        label: 'I',
        parent: 'o',
        position: { x: 0, y: 0 },
        size: { width: 9, height: 9 },
      }),
      group('j', {
        label: 'J',
        parent: 'i',
        position: { x: 0, y: 0 },
        size: { width: 9, height: 9 },
      }),
      el('a', 0, 0, { group: 'i' }),
      el('b', 0, 0, { group: 'o' }),
    ]);
    await registry.run('canvas.ungroup', { groupId: 'i' });
    expect(workingCopy.get('i')).toBeUndefined();
    expect(data('a')?.['group']).toBe('o');
    expect(data('j')?.['parent']).toBe('o');
    await registry.run('canvas.ungroup', { groupId: 'o' });
    expect(data('a')).not.toHaveProperty('group');
    expect(data('b')).not.toHaveProperty('group');
    expect(data('j')?.['parent']).toBeNull();
  });

  it('canvas.renameGroup sets the label', async () => {
    const { registry, data } = setup([
      group('o', {
        label: 'O',
        parent: null,
        position: { x: 0, y: 0 },
        size: { width: 9, height: 9 },
      }),
    ]);
    await registry.run('canvas.renameGroup', { groupId: 'o', label: ' Gareth ' });
    expect(data('o')?.['label']).toBe('Gareth');
    await expect(
      registry.run('canvas.renameGroup', { groupId: 'x', label: 'y' }),
    ).rejects.toThrow();
  });

  it('a dropped Node joins the innermost frame under its centre, or leaves all frames', async () => {
    const { registry, data } = setup([
      frame('o', null, 0, 0, 1000, 1000),
      frame('i', 'o', 100, 100, 400, 400),
      frame('j', null, 2000, 0, 500, 500),
      el('a', 5000, 5000),
    ]);
    const drop = (x: number, y: number) =>
      registry.run('canvas.moveNodes', { moves: [{ id: 'a', x, y }] });
    await drop(200, 200);
    expect(data('a')?.['group']).toBe('i');
    // Card top-left inside `i`, but its centre (+95, +40) outside: joins `o`.
    await drop(450, 200);
    expect(data('a')?.['group']).toBe('o');
    await drop(2100, 100);
    expect(data('a')?.['group']).toBe('j');
    await drop(-500, -500);
    expect(data('a')).not.toHaveProperty('group');
    expect(data('a')?.['position']).toEqual({ x: -500, y: -500 });
  });

  it('moving a frame moves everything inside it and keeps memberships', async () => {
    const { registry, data } = setup([
      frame('o', null, 0, 0, 1000, 1000),
      frame('i', 'o', 100, 100, 400, 400),
      el('a', 200, 200, { group: 'i' }),
      el('b', 600, 600, { group: 'o' }),
      el('c', 5000, 5000),
    ]);
    await registry.run('canvas.moveNodes', { moves: [{ id: 'o', x: 10, y: -20 }] });
    expect(data('o')?.['position']).toEqual({ x: 10, y: -20 });
    expect(data('i')?.['position']).toEqual({ x: 110, y: 80 });
    expect(data('a')).toMatchObject({ position: { x: 210, y: 180 }, group: 'i' });
    expect(data('b')).toMatchObject({ position: { x: 610, y: 580 }, group: 'o' });
    expect(data('c')?.['position']).toEqual({ x: 5000, y: 5000 });
  });
});

describe('creating inside a frame', () => {
  it('a Node created inside a frame joins the innermost one', async () => {
    const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    await workingCopy.set([frame('o', null, 0, 0, 1000, 1000)]);
    const registry = createRegistry(() => ({ isGM: true }));
    let n = 0;
    for (const c of elementCommands({
      workingCopy: () => workingCopy,
      newId: () => `el-${++n}`,
      afterCreate: [joinFrameOnCreate(() => workingCopy)],
    }))
      registry.register(c);
    await registry.run('element.create', { class: 'note', name: 'In', at: { x: 10, y: 10 } });
    await registry.run('element.create', { class: 'note', name: 'Out', at: { x: -900, y: 0 } });
    expect(workingCopy.get('el-1')?.data['group']).toBe('o');
    expect(workingCopy.get('el-2')?.data).not.toHaveProperty('group');
  });
});

describe('Untangle', () => {
  type P = { x: number; y: number };
  const centroid = (ps: P[]) => ({
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  });

  it('lays the selected Nodes out left-to-right along their Connections, around their centroid', async () => {
    const { registry, data } = setup([
      el('a', 500, 500),
      el('b', 0, 0),
      el('c', 100, 900),
      el('d', 3000, 3000),
      link('ab', 'a', 'b'),
      link('bc', 'b', 'c'),
      link('cd', 'c', 'd'),
    ]);
    const pos = (id: string) => data(id)?.['position'] as P;
    const before = centroid(['a', 'b', 'c'].map(pos));
    await registry.run('canvas.untangle', { ids: ['a', 'b', 'c'] });
    const [a, b, c] = ['a', 'b', 'c'].map(pos) as [P, P, P];
    // A chain a → b → c: one row, ranks left to right, no overlap.
    expect(a.x + 190).toBeLessThan(b.x);
    expect(b.x + 190).toBeLessThan(c.x);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    const after = centroid([a, b, c]);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(pos('d')).toEqual({ x: 3000, y: 3000 });
  });

  it('needs ≥ 2 selected Nodes; uses the selection without ids', async () => {
    const { registry, state, data, backend } = setup([el('a', 0, 0), el('b', 0, 0)]);
    await registry.run('canvas.untangle', { ids: ['a'] });
    expect(backend.patches).toHaveLength(1);
    state.select(['a', 'b']);
    await registry.run('canvas.untangle', {});
    expect(data('a')?.['position']).not.toEqual(data('b')?.['position']);
  });

  it('grows every enclosing frame to fit, never moving unselected Nodes', async () => {
    const { registry, data } = setup([
      frame('o', null, -100, -100, 400, 400),
      frame('i', 'o', -50, -50, 300, 300),
      el('a', 0, 0, { group: 'i' }),
      el('b', 0, 100, { group: 'i' }),
      el('c', 0, 200, { group: 'i' }),
      el('x', 50, 50, { group: 'o' }),
      link('ab', 'a', 'b'),
      link('ac', 'a', 'c'),
    ]);
    await registry.run('canvas.untangle', { ids: ['a', 'b', 'c'] });
    type F = { position: P; size: { width: number; height: number } };
    const [i, o] = [data('i') as unknown as F, data('o') as unknown as F];
    for (const id of ['a', 'b', 'c']) {
      const p = data(id)?.['position'] as P;
      expect(p.x).toBeGreaterThanOrEqual(i.position.x + 30);
      expect(p.x + 190).toBeLessThanOrEqual(i.position.x + i.size.width - 30);
      expect(p.y).toBeGreaterThanOrEqual(i.position.y + 70);
      expect(p.y + 80).toBeLessThanOrEqual(i.position.y + i.size.height - 30);
    }
    expect(i.size.width).toBeGreaterThan(300);
    expect(o.position.x).toBeLessThanOrEqual(i.position.x - 30);
    expect(o.position.x + o.size.width).toBeGreaterThanOrEqual(i.position.x + i.size.width + 30);
    expect(data('x')?.['position']).toEqual({ x: 50, y: 50 });
    expect(data('a')?.['group']).toBe('i');
  });

  it('one canvas.undo restores the whole Untangle, frames included', async () => {
    const records = [
      frame('i', null, -50, -50, 300, 300),
      el('a', 0, 0, { group: 'i' }),
      el('b', 0, 100, { group: 'i' }),
      el('c', 0, 200, { group: 'i' }),
      link('ab', 'a', 'b'),
      link('ac', 'a', 'c'),
    ];
    const { registry, workingCopy, backend } = setup(records);
    expect(registry.isAvailable('canvas.undo')).toBe(false);
    await registry.run('canvas.untangle', { ids: ['a', 'b', 'c'] });
    expect(backend.patches).toHaveLength(2);
    expect(registry.isAvailable('canvas.undo')).toBe(true);
    await registry.run('canvas.undo');
    expect(backend.patches).toHaveLength(3);
    expect([...workingCopy.records().values()]).toEqual(records);
    expect(registry.isAvailable('canvas.undo')).toBe(false);
  });

  it('announces the old positions so the canvas can tween to the new ones', async () => {
    const seen: [string, P][][] = [];
    const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    await workingCopy.set([el('a', 0, 0), el('b', 10, 10)]);
    const registry = createRegistry(() => ({ isGM: true }));
    for (const c of layoutCommands({
      workingCopy: () => workingCopy,
      state: createCanvasState(),
      newId: () => 'g',
      groupLabel: () => 'Group',
      tween: (from) => seen.push([...from]),
    }))
      registry.register(c);
    await registry.run('canvas.untangle', { ids: ['a', 'b'] });
    expect(seen).toEqual([
      [
        ['a', { x: 0, y: 0 }],
        ['b', { x: 10, y: 10 }],
      ],
    ]);
  });
});
