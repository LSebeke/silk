/** In-memory `SceneDocs` for tests: a tiny stand-in for Foundry Scenes. */
import { applyUpdate } from '../materialize/memory-docs';
import type { NewToken, SceneDocs, SceneSnapshot } from './port';

export interface MemoryScenes extends SceneDocs {
  /** All Scenes by id. Mutate to simulate Foundry-side edits. */
  readonly all: Map<string, SceneSnapshot>;
  readonly viewed: string[];
}

const clone = <T>(value: T): T => structuredClone(value);

export function createMemoryScenes(): MemoryScenes {
  const all = new Map<string, SceneSnapshot>();
  const viewed: string[] = [];
  let n = 0;
  const must = (id: string) => {
    const scene = all.get(id);
    if (!scene) throw new Error(`no Scene ${id}`);
    return scene;
  };
  return {
    all,
    viewed,
    ensureFolder: async () => 'sceneFolder',
    scenes: () => [...all.values()].map(clone),
    get: (id) => (all.has(id) ? clone(must(id)) : undefined),
    async create(data) {
      if (all.has(data._id)) throw new Error(`duplicate Scene ${data._id}`);
      all.set(data._id, { tokens: [], ...clone(data), active: false });
      return data._id;
    },
    async delete(id) {
      must(id);
      all.delete(id);
    },
    async update(id, data) {
      applyUpdate(must(id) as unknown as Record<string, unknown>, data);
    },
    async activate(id) {
      must(id);
      for (const scene of all.values()) scene.active = scene._id === id;
    },
    async view(id) {
      must(id);
      viewed.push(id);
    },
    async createTokens(sceneId, tokens: NewToken[]) {
      const scene = must(sceneId);
      scene.tokens.push(...tokens.map((t) => ({ ...t, _id: `token${++n}` })));
    },
    async deleteTokens(sceneId, ids) {
      const scene = must(sceneId);
      scene.tokens = scene.tokens.filter((t) => !ids.includes(t._id));
    },
    async syncEmbedded(sceneId, collection, ops) {
      const scene = must(sceneId) as unknown as Record<string, { _id: string }[] | undefined>;
      const updates = new Map(ops.update.map((u) => [u._id, u]));
      scene[collection] = [
        ...(scene[collection] ?? [])
          .filter((x) => !ops.delete.includes(x._id))
          .map((x) => (updates.has(x._id) ? clone(updates.get(x._id) as typeof x) : x)),
        ...clone(ops.create),
      ];
    },
  };
}
