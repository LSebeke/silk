/**
 * Foundry side of Event Scenes (spec §4, §7): `SceneDocs` over real Scenes, the token and
 * activation hooks, and the journal's Scene bar (GM only: Scene link, Activate, or "no
 * Scene" with Create / Restore). Thin: decisions live in `src/core/event-scenes`. Hooks
 * fire on every client; only the active GM reacts, Silk's own writes are skipped.
 */
import type { EventScenes } from '../core/event-scenes';
import type { SceneData, SceneDocs, SceneSnapshot } from '../core/event-scenes';
import { SILK_WRITE, isSilkWrite } from './working-copy-journal';

/** The slice of a Foundry Scene Silk uses. */
export interface FoundryScene {
  id: string | null;
  toObject(): object;
  update(data: object, options?: object): Promise<unknown>;
  delete(options?: object): Promise<unknown>;
  activate(options?: { updateOptions?: object }): Promise<unknown>;
  view(): Promise<unknown>;
  createEmbeddedDocuments(name: string, data: object[], options?: object): Promise<unknown>;
  deleteEmbeddedDocuments(name: string, ids: string[], options?: object): Promise<unknown>;
}

export interface SceneApi {
  scenes(): Iterable<FoundryScene>;
  get(id: string): FoundryScene | undefined;
  /** `CONFIG.Scene.documentClass`. */
  sceneClass(): {
    create(data: object, options?: object): Promise<FoundryScene | undefined>;
    migrateData(data: object): object;
  };
  /** World Actor's token data from its prototype token. */
  tokenData(actorId: string, data: object, scene: FoundryScene): Promise<object | undefined>;
  ensureFolder(name: string): Promise<string>;
}

export function sceneSnapshot(scene: FoundryScene): SceneSnapshot {
  const data = scene.toObject() as SceneSnapshot;
  return {
    ...data,
    flags: { ...data.flags, silk: { ...data.flags?.silk } },
    tokens: data.tokens ?? [],
    active: !!data.active,
  };
}

export function createSceneDocs(api: SceneApi): SceneDocs {
  const must = (id: string) => {
    const scene = api.get(id);
    if (!scene) throw new Error(`Silk: no Scene "${id}"`);
    return scene;
  };
  return {
    ensureFolder: (name) => api.ensureFolder(name),
    scenes: () => [...api.scenes()].map(sceneSnapshot),
    get(id) {
      const scene = api.get(id);
      return scene ? sceneSnapshot(scene) : undefined;
    },
    async create(data: SceneData) {
      const cls = api.sceneClass();
      const source = cls.migrateData(structuredClone(data));
      const scene = await cls.create(source, {
        ...SILK_WRITE,
        keepId: true,
        keepEmbeddedIds: true,
      });
      if (!scene?.id) throw new Error(`Silk: Foundry refused to create Scene "${data.name}"`);
      return scene.id;
    },
    async delete(id) {
      await must(id).delete({ ...SILK_WRITE });
    },
    async update(id, data) {
      await must(id).update(data, { ...SILK_WRITE });
    },
    async activate(id) {
      await must(id).activate({ updateOptions: { ...SILK_WRITE } });
    },
    async view(id) {
      await must(id).view();
    },
    async createTokens(sceneId, tokens) {
      const scene = must(sceneId);
      const data: object[] = [];
      for (const { actorId, ...rest } of tokens) {
        const token = await api.tokenData(actorId, rest, scene);
        if (token) data.push(token);
      }
      if (data.length) await scene.createEmbeddedDocuments('Token', data, { ...SILK_WRITE });
    },
    async deleteTokens(sceneId, ids) {
      await must(sceneId).deleteEmbeddedDocuments('Token', ids, { ...SILK_WRITE });
    },
  };
}

type Token = { actorId?: string | null; parent?: { id: string | null } | null };

export function registerSceneHooks(
  es: Pick<EventScenes, 'tokenCreated' | 'tokenDeleted' | 'sceneActivated'>,
  deps: {
    on(hook: string, fn: (...args: unknown[]) => void): void;
    isActiveGM(): boolean;
  },
): void {
  const fail = (error: unknown) => console.error(error);
  const token =
    (handler: (t: { sceneId: string; actorId: string | null }) => Promise<void>) =>
    (doc: unknown, options: unknown) => {
      if (!deps.isActiveGM() || isSilkWrite(options)) return;
      const t = doc as Token;
      const sceneId = t.parent?.id;
      if (sceneId) handler({ sceneId, actorId: t.actorId ?? null }).catch(fail);
    };
  deps.on(
    'createToken',
    token((t) => es.tokenCreated(t)),
  );
  deps.on(
    'deleteToken',
    token((t) => es.tokenDeleted(t)),
  );
  deps.on('updateScene', (scene, changed, options) => {
    if (!deps.isActiveGM() || isSilkWrite(options)) return;
    const id = (scene as { id: string | null }).id;
    if (id && (changed as { active?: boolean }).active === true) es.sceneActivated(id).catch(fail);
  });
}

export interface SceneBarState {
  elementId: string;
  cls: 'event' | 'location';
  /** Linked Scene name, if any. */
  scene?: string;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The journal's Scene bar (§4: Scene link, Activate; §6: "no Scene" + Create / Restore). */
export function sceneBarHtml(state: SceneBarState, localize: (key: string) => string): string {
  const L = (key: string) => escape(localize(`SILK.EventScene.${key}`));
  const button = (attr: string, label: string, icon: string) =>
    `<button type="button" ${attr}><i class="fa-solid ${icon}"></i> ${label}</button>`;
  if (state.scene)
    return (
      `<a data-silk-scene-link><i class="fa-solid fa-map"></i> ${escape(state.scene)}</a>` +
      button('data-silk-activate-scene', L('Activate'), 'fa-bullseye')
    );
  if (state.cls === 'location')
    return button('data-silk-create-scene', L('CreateOverview'), 'fa-map');
  return (
    `<span data-silk-no-scene>${L('None')}</span>` +
    button('data-silk-create-scene', L('Create'), 'fa-plus') +
    button('data-silk-restore-scene', L('Restore'), 'fa-clock-rotate-left')
  );
}

/**
 * Adds the Scene bar to Event / Location journal sheets (GM). The journal re-renders when
 * its `flags.silk.scene` link changes, so the bar follows the Scene.
 */
export function registerSceneBar(deps: {
  on(hook: string, fn: (...args: unknown[]) => void): void;
  isGM(): boolean;
  state(journal: { flags?: unknown }): SceneBarState | undefined;
  run(command: string, args: object): Promise<unknown>;
  localize(key: string): string;
  error(message: string): void;
}): void {
  deps.on('renderJournalEntrySheet', (app, element) => {
    if (!deps.isGM()) return;
    const root = element as HTMLElement;
    root.querySelector('[data-silk-scene-bar]')?.remove();
    const state = deps.state((app as { document?: { flags?: unknown } }).document ?? {});
    if (!state) return;
    const bar = root.ownerDocument.createElement('div');
    bar.className = 'silk-scene-bar';
    bar.dataset['silkSceneBar'] = '';
    bar.innerHTML = sceneBarHtml(state, deps.localize);
    const run = (command: string) => (event: Event) => {
      event.preventDefault();
      deps
        .run(command, { id: state.elementId })
        .catch((error: unknown) =>
          deps.error(error instanceof Error ? error.message : String(error)),
        );
    };
    const on = (selector: string, command: string) =>
      bar.querySelector(selector)?.addEventListener('click', run(command));
    on('[data-silk-scene-link]', 'event.viewScene');
    on('[data-silk-activate-scene]', 'event.activateScene');
    on('[data-silk-create-scene]', 'event.createScene');
    on('[data-silk-restore-scene]', 'event.restoreScene');
    const content = root.querySelector('.window-content') ?? root;
    content.prepend(bar);
  });
}
