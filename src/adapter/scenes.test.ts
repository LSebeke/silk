import { describe, expect, it } from 'vitest';
import type { EventScenes } from '../core/event-scenes';
import { createSceneDocs, registerSceneHooks, sceneBarHtml, type FoundryScene } from './scenes';

function hooks(activeGM = true) {
  const map = new Map<string, (...args: unknown[]) => void>();
  const seen: unknown[][] = [];
  const es = {
    tokenCreated: async (t: unknown) => void seen.push(['created', t]),
    tokenDeleted: async (t: unknown) => void seen.push(['deleted', t]),
    sceneActivated: async (id: string) => void seen.push(['activated', id]),
  } as unknown as EventScenes;
  registerSceneHooks(es, { on: (n, fn) => map.set(n, fn), isActiveGM: () => activeGM });
  return { fire: (n: string, ...a: unknown[]) => map.get(n)?.(...a), seen };
}

describe('Scene hooks (spec §7)', () => {
  const token = { actorId: 'a1', parent: { id: 's1' } };

  it('hands token create/delete and Scene activation to the core', () => {
    const { fire, seen } = hooks();
    fire('createToken', token, {}, 'u');
    fire('deleteToken', token, {}, 'u');
    fire('updateScene', { id: 's1' }, { active: true }, {}, 'u');
    fire('updateScene', { id: 's1' }, { active: false }, {}, 'u');
    fire('updateScene', { id: 's1' }, { name: 'X' }, {}, 'u');
    expect(seen).toEqual([
      ['created', { sceneId: 's1', actorId: 'a1' }],
      ['deleted', { sceneId: 's1', actorId: 'a1' }],
      ['activated', 's1'],
    ]);
  });

  it('ignores Silk’s own writes and runs only on the active GM', () => {
    const { fire, seen } = hooks();
    fire('createToken', token, { silk: { internal: true } }, 'u');
    fire('updateScene', { id: 's1' }, { active: true }, { silk: { internal: true } }, 'u');
    expect(seen).toEqual([]);
    const other = hooks(false);
    other.fire('createToken', token, {}, 'u');
    other.fire('updateScene', { id: 's1' }, { active: true }, {}, 'u');
    expect(other.seen).toEqual([]);
  });
});

describe('SceneDocs adapter', () => {
  it('creates with fixed ids, migrated, as Silk’s write; tokens from the prototype', async () => {
    const calls: unknown[][] = [];
    const scene: FoundryScene = {
      id: 's1',
      toObject: () => ({ _id: 's1', name: 'S', flags: {}, tokens: [], active: false }),
      update: async () => undefined,
      delete: async () => undefined,
      activate: async (o) => void calls.push(['activate', o]),
      view: async () => undefined,
      createEmbeddedDocuments: async (...a) => void calls.push(['tokens', ...a]),
      deleteEmbeddedDocuments: async () => undefined,
      updateEmbeddedDocuments: async () => undefined,
    };
    const docs = createSceneDocs({
      scenes: () => [scene],
      get: () => scene,
      sceneClass: () => ({
        create: async (data, options) => (calls.push(['create', data, options]), scene),
        migrateData: (data) => ({ ...data, migrated: true }),
      }),
      tokenData: async (actorId, data) => ({ actorId, ...data, proto: true }),
      ensureFolder: async () => 'f',
      embeddedName: () => undefined,
    });
    await docs.create({ _id: 's1', name: 'S', flags: {} });
    await docs.activate('s1');
    await docs.createTokens('s1', [{ actorId: 'a1', x: 1, y: 2, hidden: true }]);
    expect(calls).toEqual([
      [
        'create',
        { _id: 's1', name: 'S', flags: {}, migrated: true },
        { silk: { internal: true }, keepId: true, keepEmbeddedIds: true },
      ],
      ['activate', { updateOptions: { silk: { internal: true } } }],
      [
        'tokens',
        'Token',
        [{ actorId: 'a1', x: 1, y: 2, hidden: true, proto: true }],
        { silk: { internal: true } },
      ],
    ]);
    expect(docs.get('s1')?.flags.silk).toEqual({});
  });

  it('syncs an embedded collection by its Document name, keeping ids, as Silk’s write', async () => {
    const calls: unknown[][] = [];
    const scene = {
      id: 's1',
      createEmbeddedDocuments: async (...a: unknown[]) => void calls.push(['create', ...a]),
      updateEmbeddedDocuments: async (...a: unknown[]) => void calls.push(['update', ...a]),
      deleteEmbeddedDocuments: async (...a: unknown[]) => void calls.push(['delete', ...a]),
    } as unknown as FoundryScene;
    const docs = createSceneDocs({
      scenes: () => [scene],
      get: () => scene,
      sceneClass: () => ({ create: async () => scene, migrateData: (d) => d }),
      tokenData: async () => undefined,
      ensureFolder: async () => 'f',
      embeddedName: (c) => ({ walls: 'Wall' })[c],
    });
    await docs.syncEmbedded('s1', 'walls', {
      create: [{ _id: 'w2' }],
      update: [{ _id: 'w1', c: [1] }],
      delete: ['w0'],
    });
    const silk = { silk: { internal: true } };
    expect(calls).toEqual([
      ['delete', 'Wall', ['w0'], silk],
      ['update', 'Wall', [{ _id: 'w1', c: [1] }], { ...silk, recursive: false }],
      ['create', 'Wall', [{ _id: 'w2' }], { ...silk, keepId: true }],
    ]);
    await expect(
      docs.syncEmbedded('s1', 'nope', { create: [], update: [], delete: [] }),
    ).rejects.toThrow(/nope/);
  });
});

describe('journal Scene bar (spec §4, §6)', () => {
  const L = (k: string) => k.split('.').pop() ?? k;
  it('linked: Scene link + Activate; Event without Scene: "no Scene" + Create / Restore', () => {
    const linked = sceneBarHtml({ elementId: 'e', cls: 'event', scene: 'A<b>' }, L);
    expect(linked).toContain('data-silk-scene-link');
    expect(linked).toContain('A&#60;b&#62;');
    expect(linked).toContain('data-silk-activate-scene');
    const none = sceneBarHtml({ elementId: 'e', cls: 'event' }, L);
    expect(none).toContain('data-silk-no-scene');
    expect(none).toContain('data-silk-create-scene');
    expect(none).toContain('data-silk-restore-scene');
    const location = sceneBarHtml({ elementId: 'l', cls: 'location' }, L);
    expect(location).not.toContain('data-silk-no-scene');
    expect(location).toContain('data-silk-create-scene');
  });
});
