/**
 * Entry point. Wires the pure core to Foundry through the adapter and exposes the
 * command registry at `game.modules.get('silk').api` (spec §2, ADR 0003).
 */
import { registerConnectionsPageHooks } from './adapter/connections-page';
import { dsa5Mapping } from './adapter/dsa5';
import { showFileBrowseNotice } from './adapter/file-browse-notice';
import { createFoundryDocs } from './adapter/foundry-docs';
import { registerKeybindings } from './adapter/keybindings';
import { lifecycleDialogs, registerLifecycleHooks } from './adapter/lifecycle';
import { foundryApi, registerMaterializeHooks } from './adapter/materialize';
import { registerOwnsHooks } from './adapter/owns';
import { createSceneDocs, registerSceneBar, registerSceneHooks } from './adapter/scenes';
import { addSilkSceneControl, type SceneControls } from './adapter/scene-controls';
import { getSession, setBeforeCommit, startSession } from './adapter/session';
import { registerSettings } from './adapter/settings';
import { isActiveGM } from './adapter/working-copy-journal';
import { MODULE_ID } from './constants';
import {
  canvasCoreCommands,
  createCanvasState,
  createCreationPipeline,
  createLayoutTween,
  createViewState,
  joinFrameOnCreate,
  layoutCommands,
} from './core/canvas';
import { createRegistry } from './core/commands/registry';
import { devCoreCommands } from './core/dev/commands';
import { campaignCommands } from './core/campaigns/commands';
import { isRevealed, revelationMapCleanup } from './core/campaigns';
import { connectionCommands, connectOnCreate } from './core/connections';
import { elementCommands, readElement, type ElementCommandDeps } from './core/elements';
import { createEventScenes, eventSceneCommands } from './core/event-scenes';
import { historyCommands } from './core/history';
import {
  createConnectionsPages,
  createLifecycle,
  createMaterializer,
  lifecycleCommands,
  materializeCommands,
} from './core/materialize';
import { createOwns, type Owns } from './core/owns';
import { canonCommands } from './ui/canon/commands';
import { canvasUiCommands } from './ui/canvas/commands';
import type { CanvasContext } from './ui/canvas/context';
import { devUiCommands } from './ui/dev/commands';
import './ui/silk.css';

const localize = (key: string) => game.i18n?.localize(key) ?? key;
const registry = createRegistry(() => ({ isGM: game.user?.isGM ?? false }));
const workingCopy = () => getSession().workingCopy;

/** Client-local canvas state (selection) and the Creation Pipeline, shared by every entry point. */
const canvasState = createCanvasState();
const pipeline = createCreationPipeline({
  run: (name, args) => registry.run(name, args),
  label: (id) => localize(`SILK.Class.${id}`),
});
const viewState = createViewState({
  load: () => game.settings?.get(MODULE_ID, 'viewState'),
  save: async (value) => void (await game.settings?.set(MODULE_ID, 'viewState', value)),
});
/** `element.create` hooks: T7 (Connection to `from`) and T8 (immediate Materialize) push here. */
const afterCreate: NonNullable<ElementCommandDeps['afterCreate']> = [];
afterCreate.push(connectOnCreate({ workingCopy, run: (name, args) => registry.run(name, args) }));
/** T26: a Node created inside a Visual Group frame joins it. */
afterCreate.push(joinFrameOnCreate(workingCopy));
/** Untangle tween: layout commands announce old positions, the canvas animates. */
const layoutTween = createLayoutTween();

const foundryDocs = createFoundryDocs(foundryApi());
/** T12 owns ↔ inventory; created below, after the materializer it uses. */
// eslint-disable-next-line prefer-const -- the materializer's deps reach it lazily
let owns: Owns;
/** Materialize + write-through (spec §6, §7). */
const materializer = createMaterializer({
  workingCopy,
  docs: foundryDocs,
  system: dsa5Mapping,
  mode: () => game.settings?.get(MODULE_ID, 'materializeMode') ?? 'immediate',
  newId: () => foundry.utils.randomID(16),
  localize: (key, data) => (data ? game.i18n?.format(key, data) : game.i18n?.localize(key)) ?? key,
  notify: (message) => void ui.notifications?.info(message),
  confirm: async (count) =>
    !!(await foundry.applications.api.DialogV2.confirm({
      window: { title: localize('SILK.Materialize.VisibleTitle') },
      content: `<p>${game.i18n?.format('SILK.Materialize.VisibleConfirm', { count: String(count) })}</p>`,
    })),
  // Canvas Filters / Focus View (T23/T24) narrow this to the rendered Nodes.
  visibleIds: () => [...workingCopy().records().keys()],
  selection: () => canvasState.get().selection,
  // The pipeline is still in the class box while `element.create` runs.
  deferImmediate: () => pipeline.get().step === 'classBox',
  parentOf: (id) => owns.parentOf(id),
  restorePlan: (el, folders) => lifecycle.restorePlan(el, folders),
  afterMaterialize: async (id) => {
    await owns.afterMaterialize(id);
    await lifecycle.afterMaterialize(id);
  },
});
owns = createOwns({
  workingCopy,
  docs: foundryDocs,
  materializer,
  mode: () => game.settings?.get(MODULE_ID, 'materializeMode') ?? 'immediate',
  deferImmediate: () => pipeline.get().step === 'classBox',
  newId: () => foundry.utils.randomID(16),
  now: () => Date.now(),
  localize,
});

const format = (key: string, data?: Record<string, string>) =>
  (data ? game.i18n?.format(key, data) : game.i18n?.localize(key)) ?? key;
const dialogs = lifecycleDialogs({
  wait: (config) => foundry.applications.api.DialogV2.wait(config as never),
  localize: format,
  disable: (setting) => game.settings?.set(MODULE_ID, setting, false) as Promise<unknown>,
});
/**
 * Unmaterialize, Foundry-side deletion, element delete, reconcile (spec §6, §7).
 * Features follow the element lifecycle with `lifecycle.contribute(...)`.
 */
const lifecycle = createLifecycle({
  workingCopy,
  docs: foundryDocs,
  system: dsa5Mapping,
  materializer,
  newId: () => foundry.utils.randomID(16),
  localize: format,
  warn: (message) => void ui.notifications?.warn(message),
  async isRevealed(id) {
    const campaigns = getSession().campaigns;
    const campaign = workingCopy().binding ? await campaigns.checkedOutCampaign() : null;
    return !!campaign && isRevealed(await campaigns.readRevelationMap(campaign.id), 'element', id);
  },
  warnRevealed: () => game.settings?.get(MODULE_ID, 'warnUnmaterializeReveal') ?? true,
  confirmUnmaterialize: (names) => dialogs.confirmUnmaterialize(names),
  confirmDeleteEnabled: () => game.settings?.get(MODULE_ID, 'confirmDelete') ?? true,
  confirmDelete: (args) => dialogs.confirmDelete(args),
  lastCommit: () => getSession().history.lastCommit(),
});
lifecycle.contribute(
  revelationMapCleanup(
    () => getSession().campaigns,
    () => !!workingCopy().binding,
  ),
);
setBeforeCommit(() => lifecycle.capture());
afterCreate.push((element) => materializer.afterCreate(element));
pipeline.onComplete(({ id }) => {
  materializer.afterPipeline(id).catch((error: unknown) => console.error(error));
  owns.afterPipeline(id).catch((error: unknown) => console.error(error));
});

/** T13 Event Scenes: Scene per Event, present at ↔ tokens, Happened on activation. */
const eventScenes = createEventScenes({
  workingCopy,
  docs: foundryDocs,
  scenes: createSceneDocs({
    scenes: () => (game.scenes ?? []) as never,
    get: (id) => game.scenes?.get(id) as never,
    sceneClass: () => CONFIG.Scene.documentClass as never,
    async tokenData(actorId, data, scene) {
      const actor = game.actors?.get(actorId);
      const token = await actor?.getTokenDocument(data as never, { parent: scene as never });
      return token?.toObject();
    },
    ensureFolder: (name) => foundryDocs.ensureFolder('Scene' as never, 'event', name),
  }),
  materializer,
  mode: () => game.settings?.get(MODULE_ID, 'materializeMode') ?? 'immediate',
  deferImmediate: () => pipeline.get().step === 'classBox',
  newId: () => foundry.utils.randomID(16),
  localize: format,
  notify: (message) => void ui.notifications?.info(message),
  lastCommit: () => getSession().history.lastCommit(),
});
lifecycle.contribute(eventScenes.contributor);
pipeline.onComplete(({ id }) => {
  eventScenes.afterPipeline(id).catch((error: unknown) => console.error(error));
});

/** Generated Connections pages (spec §5 In journals); only the active GM writes them. */
const connectionsDocs = createFoundryDocs(foundryApi());
const connectionsPages = createConnectionsPages({
  workingCopy,
  docs: {
    updatePage: async (uuid, pageId, data) => {
      if (isActiveGM(game as never)) await connectionsDocs.updatePage(uuid, pageId, data);
    },
  },
  docsOf: (id) => materializer.docsOf(id),
  format: (key, data) => game.i18n?.format(key, data) ?? key,
});
/** T11: Connections pages are derived state; reconcile rewrites stale ones. */
lifecycle.contribute({ reconcile: () => connectionsPages.refresh() });

const canvasContext = (): CanvasContext => ({
  run: (name, args) => registry.run(name, args),
  available: (name) => registry.isAvailable(name),
  workingCopy: workingCopy(),
  state: canvasState,
  pipeline,
  viewState,
  layoutTween,
  detailDrop: game.settings?.get(MODULE_ID, 'detailDrop') ?? true,
  localize,
});

for (const command of [
  ...elementCommands({
    workingCopy,
    newId: () => foundry.utils.randomID(16),
    afterCreate,
    afterRename: [
      (element) => materializer.writeName(element.id),
      (element) => eventScenes.renamed(element.id),
    ],
  }),
  ...materializeCommands(materializer),
  ...lifecycleCommands(lifecycle, () => canvasState.get().selection),
  ...eventScenes.wrap(
    owns.wrap(connectionCommands({ workingCopy, newId: () => foundry.utils.randomID(16) })),
  ),
  ...eventSceneCommands(eventScenes),
  ...canvasCoreCommands({ workingCopy, state: canvasState }),
  ...layoutCommands({
    workingCopy,
    state: canvasState,
    newId: () => foundry.utils.randomID(16),
    groupLabel: () => localize('SILK.Canvas.NewGroup'),
    tween: (from) => layoutTween.start(from),
  }),
  ...canvasUiCommands(canvasContext),
  ...canonCommands,
  ...historyCommands(() => getSession().history),
  ...campaignCommands(() => getSession().campaigns),
])
  registry.register(command);

// Dev-only commands (spec §14): `__SILK_DEV__` is false in release builds, so they and the
// fixture/bench code are dropped from dist.
if (__SILK_DEV__)
  for (const command of [
    ...devCoreCommands({ workingCopy }),
    ...devUiCommands({ run: (name, args) => registry.run(name, args), workingCopy, viewState }),
  ])
    registry.register(command);

Hooks.once('init', () => {
  registerSettings((ns, key, data) => game.settings?.register(ns, key as never, data as never));
  registerKeybindings(registry, (ns, action, data) =>
    game.keybindings?.register(ns, action, data as never),
  );
  const module = game.modules?.get(MODULE_ID);
  if (module) {
    module.api = registry;
    // Internal, unstable: the World's working copy and history, for tests and dev tools.
    module.session = getSession;
  }
});

Hooks.once('ready', async () => {
  await startSession();
  registerMaterializeHooks(materializer, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
  });
  // A dsa5 Item move deletes the source doc: owns retargets it, no Unmaterialize (T12).
  // Lifecycle hooks are registered before owns', so `isMove` still sees the copy.
  registerLifecycleHooks(
    { docDeleted: (doc) => (owns.isMove(doc) ? Promise.resolve() : lifecycle.docDeleted(doc)) },
    {
      on: (hook, fn) => void Hooks.on(hook as never, fn as never),
      isActiveGM: () => isActiveGM(game as never),
    },
  );
  connectionsPages.watch();
  registerConnectionsPageHooks(connectionsPages, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
  });
  registerOwnsHooks(owns, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
  });
  registerSceneHooks(eventScenes, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
  });
  registerSceneBar({
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isGM: () => game.user?.isGM ?? false,
    state(journal) {
      const id = materializer.elementIdOf(journal);
      const el = id ? readElement(workingCopy().get(id)) : undefined;
      if (!el?.uuid || (el.class !== 'event' && el.class !== 'location')) return undefined;
      const scene = eventScenes.sceneOf(el.id)?.name;
      return { elementId: el.id, cls: el.class, ...(scene ? { scene } : {}) };
    },
    run: (name, args) => registry.run(name, args),
    localize,
    error: (message) => void ui.notifications?.error(message),
  });
  // Reconcile on load (§7): missed hooks are never replayed, Foundry is re-read. Missing
  // docs first, then the contributors (Connections pages written while Silk was off, …).
  if (isActiveGM(game as never))
    lifecycle.reconcile().catch((error: unknown) => console.error(error));
  showFileBrowseNotice({
    isGM: game.user?.isGM ?? false,
    permissions: game.permissions as Record<string, number[] | undefined> | undefined,
    alreadyShown: game.settings?.get(MODULE_ID, 'fileBrowseNoticeShown') ?? false,
    localize: (key, data) =>
      (data ? game.i18n?.format(key, data) : game.i18n?.localize(key)) ?? key,
    warn: (message) => ui.notifications?.warn(message, { permanent: true }),
    markShown: () => game.settings?.set(MODULE_ID, 'fileBrowseNoticeShown', true),
  });
});

Hooks.on('getSceneControlButtons', (controls) => {
  addSilkSceneControl(controls as unknown as SceneControls, {
    isGM: game.user?.isGM ?? false,
    run: (name) => registry.run(name),
  });
});
