import { describe, expect, it } from 'vitest';
import type { DeletedDoc, Lifecycle } from '../core/materialize';
import { lifecycleDialogs, registerLifecycleHooks } from './lifecycle';

function setup(activeGM = true) {
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const deleted: DeletedDoc[] = [];
  const lifecycle = {
    docDeleted: async (doc: DeletedDoc) => void deleted.push(doc),
  } as unknown as Lifecycle;
  registerLifecycleHooks(lifecycle, {
    on: (name, fn) => hooks.set(name, fn),
    isActiveGM: () => activeGM,
  });
  const fire = (name: string, ...args: unknown[]) => hooks.get(name)?.(...args);
  return { fire, deleted, hooks };
}

const doc = (uuid: string, extra: object = {}) => ({
  uuid,
  documentName: uuid.split('.')[0],
  toObject: () => ({ _id: uuid.split('.')[1], name: 'X', flags: { silk: { id: 'el' } } }),
  ...extra,
});

const snapshot = (uuid: string) => ({
  _id: uuid.split('.')[1],
  name: 'X',
  flags: { silk: { id: 'el' } },
  uuid,
  documentName: uuid.split('.')[0],
});

describe('Foundry-side deletion hooks (spec §6)', () => {
  it('hands deleted Actors, Items, Journals and Scenes to the lifecycle as snapshots', async () => {
    const { fire, deleted, hooks } = setup();
    expect([...hooks.keys()].sort()).toEqual([
      'deleteActor',
      'deleteItem',
      'deleteJournalEntry',
      'deleteScene',
    ]);
    fire('deleteActor', doc('Actor.a1'), {}, 'user');
    fire('deleteScene', doc('Scene.s1'), {}, 'user');
    await Promise.resolve();
    expect(deleted).toEqual([snapshot('Actor.a1'), snapshot('Scene.s1')]);
  });

  it('ignores Silk’s own deletes, non-active GMs and unlinked token actors', () => {
    const { fire, deleted } = setup();
    fire('deleteActor', doc('Actor.a1'), { silk: { internal: true } }, 'user');
    fire('deleteActor', doc('Actor.a1', { isToken: true }), {}, 'user');
    const other = setup(false);
    other.fire('deleteActor', doc('Actor.a1'), {}, 'user');
    expect([...deleted, ...other.deleted]).toEqual([]);
  });
});

describe('delete / Unmaterialize prompts (spec §6, §13)', () => {
  /** Presses `action`, with "Don't ask again" ticked or not. */
  function dialogs(action: string, dontAsk: boolean) {
    const disabled: string[] = [];
    const seen: string[][] = [];
    const d = lifecycleDialogs({
      localize: (key) => key.split('.').pop() ?? key,
      disable: async (setting) => void disabled.push(setting),
      wait: async ({ buttons }) => {
        seen.push(buttons.map((b) => `${b.action}${b.default ? '*' : ''}`));
        const box = { checked: dontAsk };
        const button = { form: { elements: { namedItem: () => box } } } as never;
        return buttons.find((b) => b.action === action)?.callback?.(new Event('click'), button);
      },
    });
    return { d, disabled, seen };
  }

  it('Adopted elements get Keep Foundry doc (default) / Delete everything', async () => {
    const t = dialogs('everything', false);
    expect(await t.d.confirmDelete({ names: ['A'], adopted: 1, keepFoundryDoc: true })).toEqual({
      keepFoundryDoc: false,
    });
    expect(t.seen).toEqual([['keep*', 'everything', 'cancel']]);
    expect(t.disabled).toEqual([]);
  });

  it('"Don\'t ask again" turns the client setting off; cancel answers no', async () => {
    const del = dialogs('delete', true);
    expect(await del.d.confirmDelete({ names: ['A'], adopted: 0, keepFoundryDoc: true })).toEqual({
      keepFoundryDoc: true,
    });
    expect(del.disabled).toEqual(['confirmDelete']);
    const un = dialogs('unmaterialize', true);
    expect(await un.d.confirmUnmaterialize(['A'])).toBe(true);
    expect(un.disabled).toEqual(['warnUnmaterializeReveal']);
    expect(await dialogs('cancel', true).d.confirmUnmaterialize(['A'])).toBe(false);
    expect(
      await dialogs('cancel', false).d.confirmDelete({
        names: [],
        adopted: 0,
        keepFoundryDoc: true,
      }),
    ).toBeNull();
  });
});
