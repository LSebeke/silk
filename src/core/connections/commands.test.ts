import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { elementRecord, type ElementClassId } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { connectionCommands } from './commands';
import { readConnection } from './connection';
import { typeOptions } from './rules';

function setup(isGM = true) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  let n = 0;
  const registry = createRegistry(() => ({ isGM }));
  for (const c of connectionCommands({
    workingCopy: () => workingCopy,
    newId: () => `cn-${++n}`,
  }))
    registry.register(c);
  const add = (id: string, cls: ElementClassId) =>
    workingCopy.set([elementRecord(id, { class: cls, name: id, position: { x: 0, y: 0 } })]);
  const create = (args: object) =>
    registry.run<{ id: string }>('connection.create', args).then((r) => r.id);
  const connection = (id: string) => readConnection(workingCopy.get(id));
  const connections = () =>
    [...workingCopy.records().values()].filter((r) => r.kind === 'connection').map((r) => r.id);
  return { registry, workingCopy, add, create, connection, connections };
}

describe('connection.create', () => {
  it('stores a free-form directed Connection from → to by default', async () => {
    const { add, create, workingCopy } = setup();
    await add('alrik', 'person');
    await add('rondra', 'person');
    const id = await create({ from: 'alrik', to: 'rondra', label: ' loves ' });
    expect(workingCopy.get(id)).toEqual({
      kind: 'connection',
      id: 'cn-1',
      data: { from: 'alrik', to: 'rondra', type: 'free', direction: 'directed', label: 'loves' },
    });
  });

  it('direction in reverses the endpoints; mutual has no direction', async () => {
    const { add, create, connection } = setup();
    await add('a', 'person');
    await add('b', 'faction');
    const back = await create({ from: 'a', to: 'b', direction: 'in' });
    expect(connection(back)).toMatchObject({ from: 'b', to: 'a', direction: 'directed' });
    const both = await create({ from: 'a', to: 'b', direction: 'mutual', label: 'are allies' });
    expect(connection(both)).toMatchObject({ from: 'a', to: 'b', direction: 'mutual' });
  });

  it('without type: the one valid Behavioural type, swapped if only the reverse is valid (v1.1 §F.3)', async () => {
    const { add, create, connection } = setup();
    await add('alrik', 'person');
    await add('sword', 'item');
    await add('gareth', 'location');
    await add('festum', 'location');
    expect(connection(await create({ from: 'sword', to: 'alrik' }))).toMatchObject({
      type: 'owns',
      from: 'alrik',
      to: 'sword',
    });
    // Shift (in) asks festum → gareth; located in is valid both ways, so as asked.
    expect(
      connection(await create({ from: 'gareth', to: 'festum', direction: 'in' })),
    ).toMatchObject({ type: 'locatedIn', from: 'festum', to: 'gareth' });
  });

  it('an explicit direction is never swapped: no Behavioural type that way is free-form (v1.1 §F.3)', async () => {
    const { add, create, connection } = setup();
    await add('alrik', 'person');
    await add('sword', 'item');
    // Shift on a drag Alrik → sword: sword → Alrik, which owns does not fit.
    expect(
      connection(await create({ from: 'alrik', to: 'sword', direction: 'in' })),
    ).toMatchObject({ type: 'free', from: 'sword', to: 'alrik', direction: 'directed' });
    expect(
      connection(await create({ from: 'alrik', to: 'sword', direction: 'out' })),
    ).toMatchObject({ type: 'owns', from: 'alrik', to: 'sword' });
  });

  it('without type: mutual (Ctrl) and an explicit free type (Alt) stay free-form', async () => {
    const { add, create, connection } = setup();
    await add('alrik', 'person');
    await add('sword', 'item');
    expect(
      connection(await create({ from: 'alrik', to: 'sword', direction: 'mutual' })),
    ).toMatchObject({ type: 'free', direction: 'mutual' });
    expect(
      connection(await create({ from: 'alrik', to: 'sword', type: 'free', label: 'covets' })),
    ).toMatchObject({ type: 'free', direction: 'directed', label: 'covets' });
  });

  it('refuses unknown endpoints and self-connections', async () => {
    const { add, create, connections } = setup();
    await add('a', 'person');
    await expect(create({ from: 'a', to: 'nope' })).rejects.toThrow(/nope/);
    await expect(create({ from: 'a', to: 'a' })).rejects.toThrow(/itself/);
    expect(connections()).toEqual([]);
  });

  it('takes Behavioural types only for a valid class pair', async () => {
    const { add, create, connection } = setup();
    await add('alrik', 'person');
    await add('sword', 'item');
    const owns = await create({ from: 'alrik', to: 'sword', type: 'owns' });
    expect(connection(owns)).toMatchObject({ type: 'owns', direction: 'directed', label: '' });
    await expect(create({ from: 'sword', to: 'alrik', type: 'owns' })).rejects.toThrow(/owns/);
    await expect(create({ from: 'alrik', to: 'sword', type: 'presentAt' })).rejects.toThrow();
    await expect(
      create({ from: 'alrik', to: 'sword', type: 'owns', direction: 'mutual' }),
    ).rejects.toThrow(/mutual/);
  });

  it('owns: at most one owner per Item; the new one replaces the old', async () => {
    const { add, create, connections } = setup();
    await add('alrik', 'person');
    await add('wolf', 'creature');
    await add('sword', 'item');
    await create({ from: 'alrik', to: 'sword', type: 'owns' });
    const second = await create({ from: 'wolf', to: 'sword', type: 'owns' });
    expect(connections()).toEqual([second]);
  });

  it('an Item is owned xor located in: a conflicting Connection replaces the old one', async () => {
    const { add, create, connections } = setup();
    await add('alrik', 'person');
    await add('gareth', 'location');
    await add('sword', 'item');
    await create({ from: 'alrik', to: 'sword', type: 'owns' });
    const inside = await create({ from: 'sword', to: 'gareth', type: 'locatedIn' });
    expect(connections()).toEqual([inside]);
    const owned = await create({ from: 'alrik', to: 'sword', type: 'owns' });
    expect(connections()).toEqual([owned]);
  });

  it('located in / takes place at: at most one per source', async () => {
    const { add, create, connections } = setup();
    await add('gareth', 'location');
    await add('punin', 'location');
    await add('temple', 'location');
    await add('feast', 'event');
    await create({ from: 'temple', to: 'gareth', type: 'locatedIn' });
    const moved = await create({ from: 'temple', to: 'punin', type: 'locatedIn' });
    await create({ from: 'feast', to: 'gareth', type: 'takesPlaceAt' });
    const at = await create({ from: 'feast', to: 'temple', type: 'takesPlaceAt' });
    expect(connections()).toEqual([moved, at]);
  });

  it('located in never forms a cycle', async () => {
    const { add, create } = setup();
    await add('realm', 'location');
    await add('city', 'location');
    await add('inn', 'location');
    await create({ from: 'city', to: 'realm', type: 'locatedIn' });
    await create({ from: 'inn', to: 'city', type: 'locatedIn' });
    await expect(create({ from: 'realm', to: 'inn', type: 'locatedIn' })).rejects.toThrow(/cycle/);
  });

  it('present at is many–many; an identical Behavioural Connection is not duplicated', async () => {
    const { add, create, connections } = setup();
    await add('alrik', 'person');
    await add('wolf', 'creature');
    await add('feast', 'event');
    await add('duel', 'event');
    const a = await create({ from: 'alrik', to: 'feast', type: 'presentAt' });
    await create({ from: 'alrik', to: 'duel', type: 'presentAt' });
    await create({ from: 'wolf', to: 'feast', type: 'presentAt' });
    expect(await create({ from: 'alrik', to: 'feast', type: 'presentAt' })).toBe(a);
    expect(connections()).toHaveLength(3);
  });

  it('several free-form Connections between one pair coexist', async () => {
    const { add, create, connections } = setup();
    await add('a', 'person');
    await add('b', 'person');
    await create({ from: 'a', to: 'b', label: 'loves' });
    await create({ from: 'b', to: 'a', label: 'hates' });
    await create({ from: 'a', to: 'b', direction: 'mutual', label: 'are cousins' });
    expect(connections()).toHaveLength(3);
  });
});

describe('editing Connections', () => {
  it('connection.setLabel trims the label', async () => {
    const { add, create, registry, connection } = setup();
    await add('a', 'person');
    await add('b', 'person');
    const id = await create({ from: 'a', to: 'b' });
    await registry.run('connection.setLabel', { id, label: '  serves ' });
    expect(connection(id)?.label).toBe('serves');
    await expect(registry.run('connection.setLabel', { id: 'x', label: '' })).rejects.toThrow(/x/);
  });

  it('connection.cycleDirection is removed (v1.1 §D): Tab runs setDirection, Shift+Tab flip', () => {
    const { registry } = setup();
    expect(registry.get('connection.cycleDirection')).toBeUndefined();
  });

  it('connection.setDirection leaves a Behavioural direction alone', async () => {
    const { add, create, registry, connection } = setup();
    await add('alrik', 'person');
    await add('sword', 'item');
    const id = await create({ from: 'alrik', to: 'sword', type: 'owns' });
    await registry.run('connection.setDirection', { id, direction: 'mutual' });
    expect(connection(id)).toMatchObject({ from: 'alrik', to: 'sword', direction: 'directed' });
  });

  it('connection.toggleDirection: directed ⇄ mutual, never reverses; a no-op on Behavioural', async () => {
    const { add, create, registry, connection } = setup();
    await add('alrik', 'person');
    await add('sword', 'item');
    await add('rondra', 'person');
    const loves = await create({ from: 'rondra', to: 'alrik' });
    await registry.run('connection.toggleDirection', { id: loves });
    expect(connection(loves)).toMatchObject({ direction: 'mutual' });
    await registry.run('connection.toggleDirection', { id: loves });
    // Mutual → directed points in id order (A→B), as `setDirection`.
    expect(connection(loves)).toMatchObject({ direction: 'directed', from: 'alrik' });
    const owns = await create({ from: 'alrik', to: 'sword' });
    await registry.run('connection.toggleDirection', { id: owns });
    expect(connection(owns)).toMatchObject({ type: 'owns', direction: 'directed' });
  });

  it('connection.cycleType steps through the valid types, then free-form', async () => {
    const { add, create, registry, connection } = setup();
    await add('chest', 'item');
    await add('gareth', 'location');
    await add('note', 'note');
    const id = await create({ from: 'chest', to: 'gareth', direction: 'mutual' });
    await registry.run('connection.cycleType', { id });
    expect(connection(id)).toMatchObject({ type: 'locatedIn', direction: 'directed' });
    await registry.run('connection.cycleType', { id });
    expect(connection(id)).toMatchObject({ type: 'free' });
    const other = await create({ from: 'chest', to: 'note' });
    await registry.run('connection.cycleType', { id: other });
    expect(connection(other)).toMatchObject({ type: 'free' });
  });

  it('connection.setType sets one of typeOptions (Connection Detail select)', async () => {
    const { add, create, registry, connection, workingCopy } = setup();
    await add('alrik', 'person');
    await add('fest', 'event');
    const id = await create({ from: 'alrik', to: 'fest', direction: 'mutual', label: 'x' });
    const c = connection(id);
    expect(c && typeOptions(workingCopy.records(), c)).toEqual(['presentAt', 'free']);
    await registry.run('connection.setType', { id, type: 'presentAt' });
    expect(connection(id)).toMatchObject({ type: 'presentAt', direction: 'directed' });
    await registry.run('connection.setType', { id, type: 'presentAt' });
    expect(connection(id)?.type).toBe('presentAt');
    await expect(registry.run('connection.setType', { id, type: 'owns' })).rejects.toThrow(/owns/);
    await registry.run('connection.setType', { id, type: 'free' });
    expect(connection(id)?.type).toBe('free');
  });

  it('connection.setType replaces conflicting Connections like the cycle', async () => {
    const { add, create, registry, connections } = setup();
    await add('realm', 'location');
    await add('city', 'location');
    await add('inn', 'location');
    const up = await create({ from: 'city', to: 'realm', type: 'locatedIn' });
    const free = await create({ from: 'city', to: 'inn' });
    await registry.run('connection.setType', { id: free, type: 'locatedIn' });
    expect(connections()).toEqual([free]);
    expect(connections()).not.toContain(up);
  });

  it('connection.setDirection sets directed or mutual', async () => {
    const { add, create, registry, connection } = setup();
    await add('a', 'person');
    await add('b', 'person');
    const id = await create({ from: 'b', to: 'a' });
    await registry.run('connection.setDirection', { id, direction: 'directed' });
    expect(connection(id)).toMatchObject({ from: 'b', to: 'a', direction: 'directed' });
    await registry.run('connection.setDirection', { id, direction: 'mutual' });
    expect(connection(id)?.direction).toBe('mutual');
    await registry.run('connection.setDirection', { id, direction: 'mutual' });
    expect(connection(id)?.direction).toBe('mutual');
    await registry.run('connection.setDirection', { id, direction: 'directed' });
    expect(connection(id)).toMatchObject({ from: 'a', to: 'b', direction: 'directed' });
  });

  it('connection.cycleType applies cardinality and skips types that would cycle', async () => {
    const { add, create, registry, connection, connections } = setup();
    await add('realm', 'location');
    await add('city', 'location');
    await add('inn', 'location');
    const up = await create({ from: 'city', to: 'realm', type: 'locatedIn' });
    const free = await create({ from: 'city', to: 'inn', type: 'free' });
    await registry.run('connection.cycleType', { id: free });
    expect(connection(free)?.type).toBe('locatedIn');
    expect(connections()).toEqual([free]);
    expect(connections()).not.toContain(up);
    // city → realm was replaced, so realm in city is no cycle; inn in realm would be one.
    const loop = await create({ from: 'realm', to: 'city', type: 'free' });
    await registry.run('connection.cycleType', { id: loop });
    expect(connection(loop)?.type).toBe('locatedIn');
    const back = await create({ from: 'inn', to: 'realm', type: 'free' });
    await registry.run('connection.cycleType', { id: back });
    expect(connection(back)?.type).toBe('free');
  });

  it('connection.flip reverses a Behavioural Connection only when the reversed pair is valid', async () => {
    const { add, create, registry, connection } = setup();
    await add('city', 'location');
    await add('inn', 'location');
    await add('alrik', 'person');
    await add('sword', 'item');
    const inside = await create({ from: 'inn', to: 'city', type: 'locatedIn' });
    await registry.run('connection.flip', { id: inside });
    expect(connection(inside)).toMatchObject({ from: 'city', to: 'inn', type: 'locatedIn' });
    const owns = await create({ from: 'alrik', to: 'sword', type: 'owns' });
    await expect(registry.run('connection.flip', { id: owns })).rejects.toThrow(/flip/);
    const free = await create({ from: 'alrik', to: 'city' });
    await registry.run('connection.flip', { id: free });
    expect(connection(free)).toMatchObject({ from: 'city', to: 'alrik' });
  });

  it('connection.delete removes Connections only', async () => {
    const { add, create, registry, workingCopy, connections } = setup();
    await add('a', 'person');
    await add('b', 'person');
    const id = await create({ from: 'a', to: 'b' });
    await registry.run('connection.delete', { ids: [id, 'a'] });
    expect(connections()).toEqual([]);
    expect(workingCopy.get('a')).toBeDefined();
  });

  it('are GM-only', () => {
    const { registry } = setup(false);
    for (const c of registry.list()) expect(registry.isAvailable(c.name)).toBe(false);
  });
});

describe('Connection Notes (v1.1 §F.2)', () => {
  it('connection.setNotes stores HTML notes; empty notes leave no field', async () => {
    const { add, create, registry, workingCopy, connection } = setup();
    await add('a', 'person');
    await add('b', 'person');
    const id = await create({ from: 'a', to: 'b', label: 'knows' });
    await registry.run('connection.setNotes', { id, notes: '<p>Owes <b>money</b></p>' });
    expect(connection(id)?.notes).toBe('<p>Owes <b>money</b></p>');
    await registry.run('connection.setNotes', { id, notes: '' });
    expect(workingCopy.get(id)?.data).not.toHaveProperty('notes');
    expect(connection(id)?.notes).toBeUndefined();
    await expect(registry.run('connection.setNotes', { id: 'x', notes: '' })).rejects.toThrow(/x/);
  });

  it('notes survive every other edit', async () => {
    const { add, create, registry, connection } = setup();
    await add('a', 'person');
    await add('b', 'person');
    const id = await create({ from: 'a', to: 'b', label: 'knows' });
    await registry.run('connection.setNotes', { id, notes: '<p>n</p>' });
    await registry.run('connection.setLabel', { id, label: 'trusts' });
    await registry.run('connection.setDirection', { id, direction: 'mutual' });
    await registry.run('connection.flip', { id });
    await registry.run('connection.cycleType', { id });
    expect(connection(id)?.notes).toBe('<p>n</p>');
  });
});
