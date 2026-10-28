import { describe, expect, it } from 'vitest';
import { createRegistry } from '../commands/registry';
import { elementCommands, type ElementClassId } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { connectionCommands } from './commands';
import { readConnection } from './connection';
import { connectOnCreate } from './create-from';

function setup() {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const registry = createRegistry(() => ({ isGM: true }));
  let n = 0;
  const newId = () => `id-${++n}`;
  const run = (name: string, args: object) => registry.run(name, args);
  for (const c of [
    ...elementCommands({
      workingCopy: () => workingCopy,
      newId,
      afterCreate: [connectOnCreate({ workingCopy: () => workingCopy, run })],
    }),
    ...connectionCommands({ workingCopy: () => workingCopy, newId }),
  ])
    registry.register(c);
  const make = (cls: ElementClassId, extra: object = {}) =>
    registry.run<{ id: string; connectionId?: string }>('element.create', {
      class: cls,
      name: cls,
      ...extra,
    });
  const connection = (id?: string) => (id ? readConnection(workingCopy.get(id)) : undefined);
  return { make, connection };
}

describe('element.create from a Node', () => {
  it('without `from` creates no Connection', async () => {
    const { make } = setup();
    expect((await make('person')).connectionId).toBeUndefined();
  });

  it.each<[ElementClassId, ElementClassId, string, 'origin→new' | 'new→origin']>([
    ['person', 'item', 'owns', 'origin→new'],
    ['creature', 'item', 'owns', 'origin→new'],
    ['event', 'person', 'presentAt', 'new→origin'],
    ['event', 'creature', 'presentAt', 'new→origin'],
    ['location', 'location', 'locatedIn', 'new→origin'],
    ['location', 'item', 'locatedIn', 'new→origin'],
    ['location', 'event', 'takesPlaceAt', 'new→origin'],
    ['person', 'person', 'free', 'origin→new'],
    ['item', 'person', 'free', 'origin→new'],
    ['faction', 'quest', 'free', 'origin→new'],
  ])('%s → new %s defaults to %s (%s)', async (originClass, newClass, type, way) => {
    const { make, connection } = setup();
    const origin = await make(originClass);
    const created = await make(newClass, { from: origin.id });
    const ends = way === 'origin→new' ? [origin.id, created.id] : [created.id, origin.id];
    expect(connection(created.connectionId)).toMatchObject({
      type,
      direction: 'directed',
      from: ends[0],
      to: ends[1],
    });
  });

  it('an explicit direction keeps the default type only when it points the same way', async () => {
    const { make, connection } = setup();
    const gareth = await make('location');
    const inside = await make('item', { from: gareth.id, connection: { direction: 'in' } });
    expect(connection(inside.connectionId)).toMatchObject({ type: 'locatedIn', from: inside.id });
    const out = await make('item', { from: gareth.id, connection: { direction: 'out' } });
    expect(connection(out.connectionId)).toMatchObject({ type: 'free', from: gareth.id });
    const both = await make('item', { from: gareth.id, connection: { direction: 'mutual' } });
    expect(connection(both.connectionId)).toMatchObject({ type: 'free', direction: 'mutual' });
  });

  it('an explicit type and label win over the default', async () => {
    const { make, connection } = setup();
    const alrik = await make('person');
    const sword = await make('item', {
      from: alrik.id,
      connection: { type: 'free', label: 'covets' },
    });
    expect(connection(sword.connectionId)).toMatchObject({
      type: 'free',
      label: 'covets',
      from: alrik.id,
    });
  });
});
