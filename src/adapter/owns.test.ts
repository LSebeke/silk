import { describe, expect, it } from 'vitest';
import type { DocSnapshot } from '../core/materialize';
import type { Owns } from '../core/owns';
import { registerOwnsHooks } from './owns';

function setup(activeGM = true) {
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const seen: [string, DocSnapshot][] = [];
  const record = (op: string) => async (doc: DocSnapshot) => void seen.push([op, doc]);
  const owns = {
    itemCreated: record('created'),
    itemDeleted: record('deleted'),
    actorCreated: record('actor'),
  } as unknown as Owns;
  registerOwnsHooks(owns, { on: (name, fn) => hooks.set(name, fn), isActiveGM: () => activeGM });
  const fire = (name: string, ...args: unknown[]) => hooks.get(name)?.(...args);
  return { fire, seen };
}

const item = {
  uuid: 'Actor.a.Item.i',
  documentName: 'Item',
  parent: { uuid: 'Actor.a' },
  toObject: () => ({ _id: 'i', name: 'Sword', flags: { silk: { id: 'el' } } }),
};

describe('owns hooks (spec §7)', () => {
  it('hands created/deleted Items and created Actors to owns as snapshots', () => {
    const { fire, seen } = setup();
    fire('createItem', item, {}, 'user');
    fire('deleteItem', item, {}, 'user');
    fire('createActor', { ...item, uuid: 'Actor.b', documentName: 'Actor', parent: null }, {}, 'u');
    expect(seen.map(([op, doc]) => [op, doc.uuid, doc.parent])).toEqual([
      ['created', 'Actor.a.Item.i', 'Actor.a'],
      ['deleted', 'Actor.a.Item.i', 'Actor.a'],
      ['actor', 'Actor.b', undefined],
    ]);
  });

  it('ignores Silk’s own writes and runs only on the active GM', () => {
    const { fire, seen } = setup();
    fire('createItem', item, { silk: { internal: true } }, 'user');
    fire('deleteItem', item, { silk: { internal: true } }, 'user');
    expect(seen).toEqual([]);
    const other = setup(false);
    other.fire('createItem', item, {}, 'user');
    other.fire('deleteItem', item, {}, 'user');
    expect(other.seen).toEqual([]);
  });
});
