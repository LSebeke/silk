/**
 * Event Scenes (spec §4 Event Scenes + Presets, §6, §7 present at ↔ tokens, Happened).
 *
 * - Each Event owns one Foundry Scene, generated from its Scene Preset when the Event
 *   Materializes (a Location may own an Overview Scene). The Scene carries
 *   `flags.silk.sceneOf`; the journal mirrors the link in `flags.silk.scene`.
 * - The Scene follows the element lifecycle (`contributor`): Unmaterialize snapshots it into
 *   an `eventScene` record and deletes it, Materialize restores it, a Commit captures it.
 *   Deleted in Foundry → the link is cleared ("no Scene"), **present at** stays.
 * - **present at** ↔ tokens, Event Scenes only. Silk-driven (Connection commands,
 *   Materialize) changes the tokens; Foundry-driven (token hooks, reconcile) the Connections.
 * - Happened: set on the Scene's first activation, once (the GM may undo it).
 *
 * Pure core over the `FoundryDocs` and `SceneDocs` ports.
 */
import type { JsonObject, Snapshot } from '../canon';
import { canonicalJson } from '../canon';
import type { Command } from '../commands/registry';
import { check, connectionRecord, connectionsIn } from '../connections';
import { elementRecord, readElement, type ElementData, type StoryElement } from '../elements';
import type {
  FoundryDocs,
  LifecycleContributor,
  MaterializeMode,
  Materializer,
} from '../materialize';
import type { WorkingCopy } from '../working-copy';
import type { SceneData, SceneDocs, SceneSnapshot } from './port';
import {
  DEFAULT_PRESET,
  isPreset,
  presetOf,
  presetScene,
  tokenSlot,
  type ScenePreset,
} from './presets';

export interface EventScenesDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  scenes: SceneDocs;
  materializer: Pick<Materializer, 'ensureMaterialized' | 'setStatus'>;
  mode(): MaterializeMode;
  /** True while the Creation Pipeline is in its class box: implicit Materialize waits. */
  deferImmediate?(): boolean;
  newId(): string;
  localize(key: string, data?: Record<string, string>): string;
  notify(message: string): void;
  /** The checked-out head Commit, `null` before the first Commit or when unbound. */
  lastCommit(): Promise<{ hash: string; snapshot: Snapshot } | null>;
}

export interface EventScenes {
  /** Follows the element lifecycle (T9 `lifecycle.contribute`). */
  contributor: LifecycleContributor;
  /** Wraps Connection commands: present at changes Materialize implicitly and move tokens. */
  wrap(commands: Command[]): Command[];
  /** Creation Pipeline finished: run the implicit Materialize it held back. */
  afterPipeline(id: string): Promise<void>;
  /** `element.rename` hook: the Scene is named after its element. */
  renamed(id: string): Promise<void>;
  /** The element's Scene, if it has one. */
  sceneOf(id: string): SceneSnapshot | undefined;
  /** Foundry `createToken` (not Silk's own write). */
  tokenCreated(token: { sceneId: string; actorId: string | null }): Promise<void>;
  /** Foundry `deleteToken` (not Silk's own write). */
  tokenDeleted(token: { sceneId: string; actorId: string | null }): Promise<void>;
  /** Foundry `updateScene` with `active: true` (not Silk's own write). */
  sceneActivated(sceneId: string): Promise<void>;
  activateScene(id: string): Promise<void>;
  createScene(id: string, preset?: string): Promise<void>;
  restoreScene(id: string): Promise<void>;
  viewScene(id: string): Promise<void>;
}

/** `eventScene` record data: the Scene as Unmaterialize / Commit captured it. */
export interface EventSceneData {
  element: string;
  scene: SceneData;
}

export const eventSceneId = (elementId: string) => `${elementId}-scene`;

const SCENE_CLASSES = new Set(['event', 'location']);
const PRESENT = new Set(['person', 'creature']);

/** Source data as versioned: no ownership, folder, sort, activation, thumbnail (§11.2). */
function versioned(scene: SceneSnapshot | SceneData): SceneData {
  const skip = new Set(['ownership', 'folder', 'sort', 'active', 'thumb', 'navOrder']);
  return Object.fromEntries(
    Object.entries(structuredClone(scene)).filter(([key]) => !skip.has(key)),
  ) as SceneData;
}

export function createEventScenes(deps: EventScenesDeps): EventScenes {
  const { scenes, docs } = deps;
  const wc = () => deps.workingCopy();
  const element = (id: string | undefined) => (id ? readElement(wc().get(id)) : undefined);
  /** Elements whose implicit Materialize waits for the Creation Pipeline. */
  const held = new Set<string>();
  /** Scenes being marked activated (the command and its hook race). */
  const activating = new Set<string>();
  /** One Scene creation per element at a time. */
  const creating = new Map<string, Promise<void>>();
  /** Hook reactions run one at a time, in hook order. */
  let queue: Promise<void> = Promise.resolve();
  const serial = (job: () => Promise<void>) => {
    const next = queue.then(job);
    queue = next.catch(() => undefined);
    return next;
  };

  function sceneOf(id: string) {
    return scenes.scenes().find((s) => s.flags.silk?.sceneOf === id);
  }

  /** The Event an Event Scene belongs to (Overview Scenes are not Event Scenes, §7). */
  function eventOf(sceneId: string): StoryElement | undefined {
    const el = element(scenes.get(sceneId)?.flags.silk?.sceneOf);
    return el?.class === 'event' && el.uuid ? el : undefined;
  }

  /** World Actor id of a Materialized Person/Creature. */
  function actorIdOf(el: StoryElement | undefined) {
    if (!el?.uuid || !PRESENT.has(el.class)) return undefined;
    const match = /^Actor\.([^.]+)$/.exec(el.uuid);
    return match?.[1];
  }

  function elementOfActor(actorId: string | null) {
    if (!actorId) return undefined;
    for (const record of wc().records().values()) {
      const el = readElement(record);
      if (el && actorIdOf(el) === actorId) return el;
    }
    return undefined;
  }

  const presentAt = () => connectionsIn(wc().records()).filter((c) => c.type === 'presentAt');
  const pairKey = (from: string, to: string) => `${from}>${to}`;

  async function writeElement(el: StoryElement, patch: Partial<ElementData>) {
    const data = Object.fromEntries(
      Object.entries({ ...el, ...patch }).filter(([k, v]) => k !== 'id' && v !== undefined),
    );
    await wc().set([elementRecord(el.id, data as unknown as ElementData)]);
  }

  /** Mirrors the link into the element's journal (`flags.silk.scene`). */
  async function setLink(el: StoryElement, sceneId: string | undefined) {
    const journal = el.uuid ? docs.get(el.uuid) : undefined;
    if (!journal || journal.flags.silk.scene === sceneId) return;
    await docs.update(
      journal.uuid,
      sceneId ? { 'flags.silk.scene': sceneId } : { 'flags.silk.-=scene': null },
    );
  }

  const presetFor = (el: StoryElement, preset?: string): ScenePreset => {
    if (isPreset(preset)) return preset;
    if (isPreset(el.fields?.scenePreset)) return el.fields.scenePreset;
    return el.class === 'location' ? 'overview' : DEFAULT_PRESET;
  };

  async function folder() {
    return scenes.ensureFolder(deps.localize('SILK.Folder.scene'));
  }

  async function createFrom(el: StoryElement, data: SceneData) {
    const id = await scenes.create({ ...data, folder: await folder(), ownership: { default: 0 } });
    await setLink(el, id);
    if (el.class === 'event') await tokensFollowConnections(el);
  }

  async function createFromPreset(el: StoryElement, preset: ScenePreset) {
    await createFrom(
      el,
      presetScene(preset, {
        id: deps.newId(),
        name: el.name,
        elementId: el.id,
        folder: null,
        img: el.img,
        boxId: deps.newId(),
        boxLabel: deps.localize('SILK.EventScene.Box'),
      }),
    );
  }

  function once(id: string, job: () => Promise<void>) {
    const running = creating.get(id);
    if (running) return running;
    const next = job().finally(() => creating.delete(id));
    creating.set(id, next);
    return next;
  }

  const snapshotRecord = (el: StoryElement, scene: SceneSnapshot | SceneData) => ({
    kind: 'eventScene' as const,
    id: eventSceneId(el.id),
    data: { element: el.id, scene: versioned(scene) } as unknown as JsonObject,
  });

  const readSnapshot = (record: { kind: string; data: unknown } | undefined) =>
    record?.kind === 'eventScene' ? (record.data as EventSceneData) : undefined;

  /** Materialize: restore the snapshot, else (Events) a fresh Scene from the Preset. */
  async function ensureScene(el: StoryElement) {
    if (!SCENE_CLASSES.has(el.class)) return;
    await once(el.id, async () => {
      const existing = sceneOf(el.id);
      if (existing) {
        await setLink(el, existing._id);
        if (el.class === 'event') await tokensFollowConnections(el);
        return;
      }
      const snapshot = readSnapshot(wc().get(eventSceneId(el.id)));
      if (snapshot) await createFrom(el, { ...snapshot.scene, name: el.name });
      else if (el.class === 'event') await createFromPreset(el, presetFor(el));
    });
  }

  /** Silk-driven: each present Materialized actor has a token; others' tokens go. */
  async function tokensFollowConnections(event: StoryElement) {
    const scene = sceneOf(event.id);
    if (!scene) return;
    const present = new Set(
      presentAt()
        .filter((c) => c.to === event.id)
        .map((c) => actorIdOf(element(c.from)))
        .filter((id): id is string => !!id),
    );
    const stale = scene.tokens.filter(
      (t) => t.actorId && !present.has(t.actorId) && elementOfActor(t.actorId),
    );
    if (stale.length)
      await scenes.deleteTokens(
        scene._id,
        stale.map((t) => t._id),
      );
    for (const actorId of present) await addToken(scene._id, actorId);
  }

  /** One hidden token for the actor, unless it has one already. */
  async function addToken(sceneId: string, actorId: string) {
    const scene = scenes.get(sceneId);
    if (!scene || scene.tokens.some((t) => t.actorId === actorId)) return;
    const slot = tokenSlot(presetOf(scene), scene.tokens.length);
    await scenes.createTokens(sceneId, [{ actorId, ...slot, hidden: true }]);
  }

  async function removeTokens(sceneId: string, actorId: string) {
    const scene = scenes.get(sceneId);
    const ids = scene?.tokens.filter((t) => t.actorId === actorId).map((t) => t._id) ?? [];
    if (ids.length) await scenes.deleteTokens(sceneId, ids);
  }

  /** A present at pair changed by a Silk command: implicit Materialize, then tokens. */
  async function settle(from: string, to: string, present: boolean) {
    const actor = element(from);
    const event = element(to);
    if (!actor || !event) return;
    if (present && deps.mode() === 'onDemand') {
      const ghost =
        !actor.uuid && event.uuid ? actor : !event.uuid && actor.uuid ? event : undefined;
      if (ghost) {
        if (deps.deferImmediate?.()) {
          held.add(ghost.id);
          return;
        }
        await deps.materializer.ensureMaterialized(ghost.id);
        return; // Materialize places the tokens (`materialized`).
      }
    }
    const scene = event.uuid ? sceneOf(event.id) : undefined;
    const actorId = actorIdOf(actor);
    if (!scene || !actorId) return;
    if (present) await addToken(scene._id, actorId);
    else await removeTokens(scene._id, actorId);
  }

  const pairs = () => new Set(presentAt().map((c) => pairKey(c.from, c.to)));

  function wrapOne(command: Command): Command {
    return {
      ...command,
      async run(args) {
        const before = pairs();
        const result = await command.run(args);
        const after = pairs();
        for (const key of new Set([...before, ...after])) {
          if (before.has(key) === after.has(key)) continue;
          const [from, to] = key.split('>') as [string, string];
          await settle(from, to, after.has(key));
        }
        return result;
      },
    };
  }

  /** Foundry-driven: the actor's tokens on an Event Scene decide its present at. */
  async function connectionFollowsTokens(event: StoryElement, actor: StoryElement) {
    const scene = sceneOf(event.id);
    const actorId = actorIdOf(actor);
    if (!scene || !actorId) return;
    const has = scene.tokens.some((t) => t.actorId === actorId);
    const existing = presentAt().filter((c) => c.from === actor.id && c.to === event.id);
    if (has && !existing.length) {
      const data = {
        from: actor.id,
        to: event.id,
        type: 'presentAt' as const,
        direction: 'directed' as const,
        label: '',
      };
      if (check(wc().records(), data).ok) await wc().set([connectionRecord(deps.newId(), data)]);
    } else if (!has && existing.length) await wc().delete(existing.map((c) => c.id));
  }

  async function onToken(token: { sceneId: string; actorId: string | null }) {
    const event = eventOf(token.sceneId);
    const actor = elementOfActor(token.actorId);
    if (event && actor) await connectionFollowsTokens(event, actor);
  }

  /** First activation: Happened (once; the GM may undo it). */
  async function markActivated(sceneId: string) {
    const scene = scenes.get(sceneId);
    if (!scene || scene.flags.silk?.activated || activating.has(sceneId)) return;
    activating.add(sceneId);
    try {
      await scenes.update(sceneId, { 'flags.silk.activated': true });
      const event = eventOf(sceneId);
      if (event && (event.status ?? 'planned') === 'planned') {
        await deps.materializer.setStatus(event.id, 'happened');
        deps.notify(deps.localize('SILK.EventScene.Happened', { name: event.name }));
      }
    } finally {
      activating.delete(sceneId);
    }
  }

  function requireScenic(id: string) {
    const el = element(id);
    if (!el) throw new Error(`Silk: no element "${id}"`);
    if (!SCENE_CLASSES.has(el.class))
      throw new Error(`Silk: only Events and Locations have a Scene, not ${el.class}`);
    return el;
  }

  async function setPreset(el: StoryElement, preset: ScenePreset) {
    if (el.fields?.scenePreset === preset) return el;
    const next = { ...el, fields: { ...el.fields, scenePreset: preset } };
    await writeElement(el, { fields: next.fields });
    return next;
  }

  const contributor: LifecycleContributor = {
    async materialized(el) {
      if (SCENE_CLASSES.has(el.class)) await ensureScene(el);
      const actorId = actorIdOf(el);
      if (!actorId) return;
      for (const c of presentAt()) {
        if (c.from !== el.id) continue;
        const scene = element(c.to)?.uuid ? sceneOf(c.to) : undefined;
        if (scene) await addToken(scene._id, actorId);
      }
    },

    async unmaterialize(el) {
      const scene = SCENE_CLASSES.has(el.class) ? sceneOf(el.id) : undefined;
      if (scene) {
        await wc().set([snapshotRecord(el, scene)]);
        await scenes.delete(scene._id);
      }
      const actorId = actorIdOf(el);
      if (actorId)
        for (const s of scenes.scenes())
          if (element(s.flags.silk?.sceneOf)?.class === 'event') await removeTokens(s._id, actorId);
    },

    async deleted({ element: el, keepFoundryDoc }) {
      const scene = SCENE_CLASSES.has(el.class) ? sceneOf(el.id) : undefined;
      if (scene) {
        if (keepFoundryDoc) await scenes.update(scene._id, { 'flags.-=silk': null });
        else await scenes.delete(scene._id);
      }
      if (wc().get(eventSceneId(el.id))) await wc().delete([eventSceneId(el.id)]);
      const actorId = actorIdOf(el);
      if (actorId)
        for (const s of scenes.scenes())
          if (element(s.flags.silk?.sceneOf)?.class === 'event') await removeTokens(s._id, actorId);
    },

    async docDeleted(doc) {
      if (doc.documentName !== 'Scene') return false;
      const el = element((doc.flags as { silk?: { sceneOf?: string } }).silk?.sceneOf);
      if (!el) return false;
      if (sceneOf(el.id)) return true; // Another Scene is linked now.
      await setLink(el, undefined);
      if (wc().get(eventSceneId(el.id))) await wc().delete([eventSceneId(el.id)]);
      deps.notify(deps.localize('SILK.EventScene.Deleted', { name: el.name }));
      return true;
    },

    async capture() {
      for (const record of wc().records().values()) {
        const el = readElement(record);
        if (!el?.uuid || !SCENE_CLASSES.has(el.class)) continue;
        const scene = sceneOf(el.id);
        if (!scene) continue;
        const next = snapshotRecord(el, scene);
        const current = wc().get(next.id);
        if (!current || canonicalJson(current) !== canonicalJson(next)) await wc().set([next]);
      }
    },

    async reconcile() {
      for (const record of [...wc().records().values()]) {
        const el = readElement(record);
        if (!el?.uuid || !SCENE_CLASSES.has(el.class)) continue;
        const scene = sceneOf(el.id);
        await setLink(el, scene?._id);
        if (!scene || el.class !== 'event') continue;
        for (const actor of wc().records().values()) {
          const a = readElement(actor);
          if (a && actorIdOf(a)) await connectionFollowsTokens(el, a);
        }
      }
    },
  };

  return {
    contributor,
    wrap: (commands) => commands.map(wrapOne),
    sceneOf: (id) => sceneOf(id),

    async afterPipeline(id) {
      if (!held.delete(id)) return;
      if (element(id)) await deps.materializer.ensureMaterialized(id);
    },

    async renamed(id) {
      const el = element(id);
      const scene = el?.uuid ? sceneOf(id) : undefined;
      if (el && scene && scene.name !== el.name) await scenes.update(scene._id, { name: el.name });
    },

    tokenCreated: (token) => serial(() => onToken(token)),
    tokenDeleted: (token) => serial(() => onToken(token)),
    sceneActivated: (sceneId) => serial(() => markActivated(sceneId)),

    async activateScene(id) {
      requireScenic(id);
      await deps.materializer.ensureMaterialized(id);
      const scene = sceneOf(id);
      if (!scene) throw new Error(deps.localize('SILK.EventScene.NoScene'));
      await scenes.activate(scene._id);
      await markActivated(scene._id);
    },

    async createScene(id, preset) {
      let el = requireScenic(id);
      if (preset !== undefined && !isPreset(preset))
        throw new Error(`Silk: unknown Scene Preset "${preset}"`);
      if (preset === 'overview' && el.class !== 'location')
        throw new Error('Silk: the Overview Preset is for Locations only');
      if (preset && preset !== 'overview' && el.class === 'location')
        throw new Error('Silk: a Location only has an Overview Scene');
      el = await setPreset(el, presetFor(el, preset));
      if (!el.uuid) {
        // A Ghost: the Scene comes with the Materialize (implicit, §6).
        await deps.materializer.ensureMaterialized(id);
        if (el.class === 'event' || sceneOf(id)) return;
        el = element(id) as StoryElement;
      }
      if (sceneOf(id)) throw new Error(`Silk: "${el.name}" has a Scene already`);
      await once(id, () => createFromPreset(el, presetFor(el)));
    },

    async restoreScene(id) {
      const el = requireScenic(id);
      if (!el.uuid) throw new Error(`Silk: "${el.name}" is a Ghost`);
      if (sceneOf(id)) throw new Error(`Silk: "${el.name}" has a Scene already`);
      const snapshot = readSnapshot((await deps.lastCommit())?.snapshot.get(eventSceneId(id)));
      if (!snapshot)
        throw new Error(deps.localize('SILK.EventScene.NothingToRestore', { name: el.name }));
      await once(id, () => createFrom(el, { ...snapshot.scene, name: el.name }));
    },

    async viewScene(id) {
      const scene = sceneOf(requireScenic(id).id);
      if (!scene) throw new Error(deps.localize('SILK.EventScene.NoScene'));
      await scenes.view(scene._id);
    },
  };
}

/** Commands (spec §15 "Event Scenes"). GM only. */
export function eventSceneCommands(es: EventScenes): Command[] {
  const gm = (ctx: { isGM: boolean }) => ctx.isGM;
  const command = <A>(name: string, run: (args: A) => Promise<void>): Command<A, void> => ({
    name,
    title: `SILK.Commands.${name}`,
    available: gm,
    run,
  });
  return [
    command('event.activateScene', (args: { id: string }) => es.activateScene(args.id)),
    command('event.createScene', (args: { id: string; preset?: string }) =>
      es.createScene(args.id, args.preset),
    ),
    command('event.restoreScene', (args: { id: string }) => es.restoreScene(args.id)),
    // Not in §15: the journal's Scene link (§4 "click = view") is a command too (ADR 0003).
    command('event.viewScene', (args: { id: string }) => es.viewScene(args.id)),
  ] as Command[];
}
