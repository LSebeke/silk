/**
 * Entry point. Wires the pure core to Foundry through the adapter and exposes the
 * command registry at `game.modules.get('silk').api` (spec §2, ADR 0003).
 */
import {
  adoptDialogs,
  createAdoptStarter,
  foundryAdopt,
  registerAdoptHooks,
} from './adapter/adopt';
import { registerConnectionsPageHooks } from './adapter/connections-page';
import { dsa5Mapping, dsa5Sections } from './adapter/dsa5';
import { showFileBrowseNotice } from './adapter/file-browse-notice';
import { activeScene, registerFocusHooks } from './adapter/focus';
import { createFoundryDocs } from './adapter/foundry-docs';
import { registerKeybindings } from './adapter/keybindings';
import { lifecycleDialogs, registerLifecycleHooks } from './adapter/lifecycle';
import { foundryApi, registerMaterializeHooks } from './adapter/materialize';
import { registerOwnsHooks } from './adapter/owns';
import { createSocketRelay, registerPlayerNoteHooks, textToHtml } from './adapter/player-notes';
import { foundryRevealStage, registerRevealHooks } from './adapter/reveal';
import { foundryOwnershipRevealed } from './adapter/revealed';
import { createSceneDocs, registerSceneBar, registerSceneHooks } from './adapter/scenes';
import { addSilkSceneControl, type SceneControls } from './adapter/scene-controls';
import {
  getSession,
  setBeforeCommit,
  setRevelationMapApplier,
  startSession,
} from './adapter/session';
import { registerSettings } from './adapter/settings';
import { isActiveGM } from './adapter/working-copy-journal';
import { MODULE_ID } from './constants';
import {
  canvasCoreCommands,
  createCanvasFilter,
  createCanvasSearch,
  createCanvasState,
  createCreationPipeline,
  createFocus,
  createLayoutTween,
  createRevealedSource,
  createViewState,
  filterCommands,
  focusCommands,
  joinFrameOnCreate,
  layoutCommands,
  readViewState,
  searchCommands,
} from './core/canvas';
import { adoptCommands, createAdopt } from './core/adopt';
import { createRegistry } from './core/commands/registry';
import { devCoreCommands } from './core/dev/commands';
import { campaignCommands } from './core/campaigns/commands';
import {
  isRevealed,
  setRevealed,
  parseRevelationMap,
  revelationMapCleanup,
  serializeRevelationMap,
} from './core/campaigns';
import { connectionCommands, connectOnCreate } from './core/connections';
import { elementCommands, readElement, type ElementCommandDeps } from './core/elements';
import { createEventScenes, eventSceneCommands } from './core/event-scenes';
import { historyCommands } from './core/history';
import {
  createConnectionsPages,
  createDocRewriter,
  createLifecycle,
  createMaterializer,
  lifecycleCommands,
  materializeCommands,
} from './core/materialize';
import { createMerges, mergeCommands, type Merges } from './core/merge';
import { createOwns, type Owns } from './core/owns';
import { createPlayerNotes, playerNoteCommands } from './core/player-notes';
import { createReveal, revealCommands } from './core/reveal';
import { canonCommands } from './ui/canon/commands';
import { canvasBridge } from './ui/canvas/bridge';
import { canvasUiCommands } from './ui/canvas/commands';
import type { CanvasContext } from './ui/canvas/context';
import { devUiCommands } from './ui/dev/commands';
import { createMergeUi } from './ui/merge/ui';
import { detailUiCommands } from './ui/detail/commands';
import type { DetailContext } from './ui/detail/context';
import { playerCanvasCommands } from './ui/player-canvas/commands';
import type { PlayerCanvasContext } from './ui/player-canvas/context';
import { createPlayerViewPublisher, parsePlayerView } from './core/player-view';
import { openPlayerDoc, resolvePlayerNode, type PlayerDoc } from './adapter/player-docs';
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
/** Canvas Filters (§10.5); Revealed reads the Campaign's map under an Adventure, else ownership. */
const revealed = createRevealedSource({
  revelationMap: async () => {
    const checkout = workingCopy().binding?.checkout;
    if (!checkout || !('adventure' in checkout)) return null;
    const campaigns = getSession().campaigns;
    const campaign = await campaigns.checkedOutCampaign();
    return campaign ? campaigns.readRevelationMap(campaign.id) : null;
  },
  ownership: (element) => foundryOwnershipRevealed(element.uuid),
});
/** Focus View (§10.6): seeds from the active Scene + selection, Focus Pins. */
const focus = createFocus({
  workingCopy,
  viewState,
  state: canvasState,
  activeScene: () => activeScene(game.scenes?.active as never),
});
const canvasFilter = createCanvasFilter({ workingCopy, viewState, revealed, focus });
/** Search (§10.8): shared index; jumps and new Nodes show through filters until deselected. */
const canvasSearch = createCanvasSearch({ workingCopy, filter: canvasFilter, state: canvasState });
/**
 * Re-read the map only while the Revealed filter is in use (GM): reading the Canon on every
 * binding change would race the bind/checkout flows. `filter.set` refreshes on activation.
 */
const refreshRevealed = async () => {
  if (game.user?.isGM && canvasFilter.filters().revealed?.length) await revealed.refresh();
};
/** `element.create` hooks: T7 (Connection to `from`) and T8 (immediate Materialize) push here. */
const afterCreate: NonNullable<ElementCommandDeps['afterCreate']> = [];
afterCreate.push(connectOnCreate({ workingCopy, run: (name, args) => registry.run(name, args) }));
/** T26: a Node created inside a Visual Group frame joins it. */
afterCreate.push(joinFrameOnCreate(workingCopy));
afterCreate.push((element) => canvasSearch.afterCreate(element));
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
  // The rendered Nodes: Canvas Filters / Focus View (§10.5, §10.6).
  visibleIds: () => canvasFilter.visibleIds(),
  selection: () => canvasState.get().selection,
  // The pipeline is still in the class box while `element.create` runs.
  deferImmediate: () => pipeline.get().step === 'classBox',
  parentOf: (id) => owns.parentOf(id),
  restorePlan: (el, folders) => lifecycle.restorePlan(el, folders),
  afterMaterialize: async (id) => {
    await owns.afterMaterialize(id);
    await lifecycle.afterMaterialize(id);
    // T16: ownership, hood and token display from the World's reveal state.
    await reveal.afterMaterialize(id);
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
const eventScenesDocs = createSceneDocs({
  scenes: () => (game.scenes ?? []) as never,
  get: (id) => game.scenes?.get(id) as never,
  sceneClass: () => CONFIG.Scene.documentClass as never,
  async tokenData(actorId, data, scene) {
    const actor = game.actors?.get(actorId);
    const token = await actor?.getTokenDocument(data as never, { parent: scene as never });
    return token?.toObject();
  },
  ensureFolder: (name) => foundryDocs.ensureFolder('Scene' as never, 'event', name),
  embeddedName: (collection) =>
    Object.entries(
      (
        CONFIG.Scene.documentClass as unknown as {
          metadata: { embedded: Record<string, string> };
        }
      ).metadata.embedded,
    ).find(([, key]) => key === collection)?.[0],
});
const eventScenes = createEventScenes({
  workingCopy,
  docs: foundryDocs,
  scenes: eventScenesDocs,
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
  // One page for GM and players: Revealed sentences only (§5, §8). The GM sees every
  // Connection on the canvas and in the Element Detail window.
  include: (c) => reveal.isRevealed('connection', c.id),
});
/** T11: Connections pages are derived state; reconcile rewrites stale ones. */
lifecycle.contribute({ reconcile: () => connectionsPages.refresh() });

/** End Adventure / merge (spec §11.3, §11.4): one session per World session. */
const docRewriter = createDocRewriter({
  workingCopy,
  docs: foundryDocs,
  materializer,
  lifecycle,
  scenes: eventScenes,
  newId: () => foundry.utils.randomID(16),
  localize,
});
let merges: { session: object; merges: Merges } | undefined;
function getMerges(): Merges {
  const session = getSession();
  if (merges?.session !== session)
    merges = {
      session,
      merges: createMerges({
        history: session.history,
        workingCopy: session.workingCopy,
        campaigns: session.campaigns,
        author: () => game.user?.name ?? 'GM',
        applyResult: (result) => docRewriter.apply(result),
        sections: dsa5Sections,
        retagPlayerNotes: (from, to) => playerNotes.retag(from, to),
        applyRevelationMap: (map) => reveal.applyMap(map),
      }),
    };
  return merges.merges;
}
const mergeUi = createMergeUi({
  view: () => getMerges().view(),
  workingCopy,
  run: (name, args) => registry.run(name, args),
  t: format,
});
/** Reveal (spec §8): World ownership, mirrored in the Campaign's Revelation Map. */
const adventureCheckedOut = () => {
  try {
    const checkout = workingCopy().binding?.checkout;
    return !!checkout && 'adventure' in checkout;
  } catch {
    return false; // before `ready`
  }
};
const reveal = createReveal({
  workingCopy,
  docs: foundryDocs,
  materializer,
  system: dsa5Mapping,
  campaign: {
    current: async () =>
      workingCopy().binding
        ? ((await getSession().campaigns.checkedOutCampaign())?.id ?? null)
        : null,
    read: (id) => getSession().campaigns.readRevelationMap(id),
    write: (id, map) => getSession().campaigns.writeRevelationMap(id, map),
  },
  world: {
    get: () => parseRevelationMap((game.settings?.get(MODULE_ID, 'revealState') ?? null) as never),
    set: async (map) =>
      void (await game.settings?.set(
        MODULE_ID,
        'revealState',
        serializeRevelationMap(map) as object,
      )),
  },
  adventure: adventureCheckedOut,
  hood: () =>
    game.settings?.get(MODULE_ID, 'hoodedImage') ?? `modules/${MODULE_ID}/assets/hooded.svg`,
  stage: foundryRevealStage(),
  localize,
  refreshPages: (ids) => connectionsPages.refresh(ids),
});
setRevelationMapApplier((map) => reveal.applyMap(map));
/** Player Notes (spec §9): players' writes go over the socket to the active GM. */
const playerNotes = createPlayerNotes({
  workingCopy,
  docs: foundryDocs,
  materializer,
  reveal,
  campaign: async () =>
    adventureCheckedOut()
      ? ((await getSession().campaigns.checkedOutCampaign())?.id ?? null)
      : null,
  newId: () => foundry.utils.randomID(16),
  localize,
});
const socketRelay = createSocketRelay({
  socket: {
    on: (channel, fn) => void game.socket?.on(channel, fn),
    emit: (channel, data) => void game.socket?.emit(channel, data),
  },
  userId: () => game.user?.id ?? '',
  isActiveGM: () => isActiveGM(game as never),
  run: (name, args) => registry.run(name, args),
});

/**
 * Player View + Player Canvas (spec §9). The active GM publishes the world setting; players
 * read only it and the Foundry docs they can see, never the Working Copy or Canon.
 */
const playerView = () => parsePlayerView(game.settings?.get(MODULE_ID, 'playerView'));
const playerViewPublisher = createPlayerViewPublisher({
  workingCopy,
  reveal,
  // Frozen under the main Checkout (§8).
  frozen: () => !adventureCheckedOut(),
  current: () => game.settings?.get(MODULE_ID, 'playerView'),
  write: async (view) => void (await game.settings?.set(MODULE_ID, 'playerView', view as object)),
});
const playerDoc = (uuid: string) => fromUuidSync(uuid) as unknown as PlayerDoc | null;
const playerCanvasWatchers = new Set<() => void>();
let playerCanvasTimer: ReturnType<typeof setTimeout> | undefined;
/** Player View or a doc changed: refresh open Player Canvases (coalesced). */
const playerCanvasChanged = () => {
  if (!playerCanvasWatchers.size) return;
  clearTimeout(playerCanvasTimer);
  playerCanvasTimer = setTimeout(() => {
    for (const fn of playerCanvasWatchers) fn();
  }, 50);
};
const playerCanvasContext = (): PlayerCanvasContext => ({
  run: (name, args) => registry.run(name, args),
  view: playerView,
  watch(fn) {
    playerCanvasWatchers.add(fn);
    return () => void playerCanvasWatchers.delete(fn);
  },
  resolve: (node) => resolvePlayerNode(node, playerDoc, game.user),
  viewport: {
    get: () =>
      readViewState({ viewport: game.settings?.get(MODULE_ID, 'playerViewState') }).viewport,
    save: async (viewport) =>
      void (await game.settings?.set(MODULE_ID, 'playerViewState', viewport)),
  },
  localize,
});
const playerCanvasEntry = {
  isGM: () => game.user?.isGM ?? false,
  async open() {
    const { openPlayerCanvasWindow } = await import('./ui/player-canvas/PlayerCanvasWindow');
    await openPlayerCanvasWindow(playerCanvasContext());
  },
};
lifecycle.contribute({ reconcile: () => reveal.reconcile() });
const title = (name: string) => localize(registry.get(name)?.title ?? name);
const detailContext = (): DetailContext => ({
  run: (name, args) => registry.run(name, args),
  available: (name) => registry.isAvailable(name),
  title,
  workingCopy: workingCopy(),
  reveal,
  localize,
  format: (key, data) => game.i18n?.format(key, data) ?? key,
  error: (message) => void ui.notifications?.error(message),
});

/** T14 Adopt: existing Foundry docs become Story Elements (spec §6 Adopt). */
const adoptPrompts = adoptDialogs({
  wait: (config) => foundry.applications.api.DialogV2.wait(config as never),
  localize: format,
});
const adoptFoundryApi = foundryAdopt();
const adopt = createAdopt({
  workingCopy,
  docs: foundryDocs,
  scenes: eventScenesDocs,
  system: dsa5Mapping,
  newId: () => foundry.utils.randomID(16),
  localize: format,
  materializer,
  foundry: adoptFoundryApi,
  run: (name, args) => registry.run(name, args),
  afterAdopt: async (id) => {
    await owns.afterMaterialize(id);
    await lifecycle.afterMaterialize(id);
  },
  // §6/§8: a doc players can already see counts as Revealed. Under main there is no map:
  // the Revealed filter reads ownership, which Adopt leaves unchanged.
  async markRevealed({ elements, infoBlocks }) {
    const campaigns = getSession().campaigns;
    const campaign = workingCopy().binding ? await campaigns.checkedOutCampaign() : null;
    if (!campaign) return;
    let map = await campaigns.readRevelationMap(campaign.id);
    for (const id of elements) map = setRevealed(map, 'element', id, true);
    for (const id of infoBlocks) map = setRevealed(map, 'infoBlock', id, true);
    await campaigns.writeRevelationMap(campaign.id, map);
    // The World mirror (T16 `revealState`) too; ownership already matches, nothing to apply.
    let world = parseRevelationMap((game.settings?.get(MODULE_ID, 'revealState') ?? null) as never);
    for (const id of elements) world = setRevealed(world, 'element', id, true);
    for (const id of infoBlocks) world = setRevealed(world, 'infoBlock', id, true);
    await game.settings?.set(MODULE_ID, 'revealState', serializeRevelationMap(world) as object);
    reveal.reload();
    await refreshRevealed();
  },
  viewCenter: () => canvasBridge.center?.() ?? { x: 0, y: 0 },
  select: async (ids) => void (await registry.run('canvas.select', { ids })),
  flash: (id) => canvasBridge.flash?.(id),
  chooseUseFor: (args) => adoptPrompts.chooseUseFor(args),
  confirmFolder: (rows) => adoptPrompts.confirmFolder(rows),
  commit: (label) => getSession().history.commit(label ? { label } : {}),
  async lastCommitTime() {
    const head = workingCopy().binding?.head;
    const canon = head ? await getSession().history.canon() : null;
    return head && canon ? Date.parse((await canon.readCommit(head)).date) : null;
  },
  showAdHoc: (rows) =>
    adoptPrompts.showAdHoc(rows, {
      adopt: (uuid) => startAdopt(uuid),
      ignore: (uuid) => registry.run('adopt.ignore', { uuid }),
    }),
});
lifecycle.contribute(adopt.contributor);
const startAdopt = createAdoptStarter({
  inspect: (uuid) => adopt.inspect(uuid),
  importFromCompendium: (uuid) => adoptFoundryApi.importFromCompendium(uuid),
  run: (name, args) => registry.run(name, args),
  pipeline,
  center: () => canvasBridge.center?.() ?? { x: 0, y: 0 },
  askAlsoActor: (name) => adoptPrompts.askAlsoActor(name),
  error: (message) => void ui.notifications?.error(message),
  localize: format,
});

const canvasContext = (): CanvasContext => ({
  run: (name, args) => registry.run(name, args),
  available: (name) => registry.isAvailable(name),
  workingCopy: workingCopy(),
  state: canvasState,
  pipeline,
  viewState,
  layoutTween,
  detailDrop: game.settings?.get(MODULE_ID, 'detailDrop') ?? true,
  filter: canvasFilter,
  focus,
  refreshRevealed,
  renderBudget: game.settings?.get(MODULE_ID, 'renderBudgetWarning') ?? 1000,
  search: canvasSearch,
  localize,
  title,
  reveal,
  warn: (message) => void ui.notifications?.warn(message),
  adopt: (uuid, options) =>
    startAdopt(uuid, options).catch((error: unknown) => {
      ui.notifications?.error(error instanceof Error ? error.message : String(error));
    }),
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
  ...filterCommands(canvasFilter),
  ...focusCommands(focus),
  ...searchCommands(canvasSearch),
  ...canvasUiCommands(canvasContext, playerCanvasEntry),
  ...playerCanvasCommands({
    view: playerView,
    openDoc: (node) =>
      openPlayerDoc(node, {
        get: playerDoc,
        journal: (id) => game.journal?.get(id) as unknown as PlayerDoc | undefined,
        user: game.user,
      }),
  }),
  ...canonCommands,
  ...historyCommands(() => getSession().history),
  ...campaignCommands(() => getSession().campaigns),
  ...mergeCommands(getMerges, mergeUi),
  ...revealCommands(reveal),
  ...playerNoteCommands(playerNotes, {
    isGM: () => game.user?.isGM ?? false,
    gmOnline: () => !!game.users?.activeGM,
    relay: (name, args) => socketRelay.relay(name, args),
  }),
  ...detailUiCommands(detailContext),
  ...adoptCommands(adopt),
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
  // Sidebar directories build their context menus on first render, before `ready`.
  registerAdoptHooks({
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isGM: () => game.user?.isGM ?? false,
    isActiveGM: () => isActiveGM(game as never),
    start: (uuid) => startAdopt(uuid),
    run: (name, args) => registry.run(name, args),
    isStoryElement(uuid) {
      try {
        return !!adopt.inspect(uuid)?.existing;
      } catch {
        return false; // Before `ready`: no session yet.
      }
    },
    folderType: (id) => game.folders?.get(id)?.type,
    docCreated: (doc) => adopt.docCreated(doc),
    error: (message) => void ui.notifications?.error(message),
  });
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
  reveal.reload();
  registerRevealHooks(reveal, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
    isGM: () => game.user?.isGM ?? false,
    elementIdOf: (doc) => materializer.elementIdOf(doc),
    run: (name, args) => registry.run(name, args),
    localize,
  });
  socketRelay.listen();
  registerPlayerNoteHooks({
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    elementIdOf: (doc) => materializer.elementIdOf(doc),
    isRevealed: (id) => reveal.isRevealed('element', id),
    available: () => registry.isAvailable('playerNote.create'),
    prompt: async () => {
      const text: unknown = await foundry.applications.api.DialogV2.prompt({
        window: { title: localize('SILK.PlayerNote.Add') },
        content: `<label>${localize('SILK.PlayerNote.Prompt')}<textarea name="text" rows="6" data-silk-player-note-text></textarea></label>`,
        ok: {
          label: localize('SILK.PlayerNote.Save'),
          callback: (
            _event: unknown,
            button: { form: { elements: { text: { value: string } } } },
          ) => button.form.elements.text.value,
        },
        rejectClose: false,
      } as never);
      return typeof text === 'string' && text.trim() ? textToHtml(text) : null;
    },
    run: (name, args) => registry.run(name, args),
    localize,
    error: (message) => void ui.notifications?.error(message),
  });
  connectionsPages.watch();
  if (isActiveGM(game as never)) reveal.watch();
  // Checkout changes switch the Revealed filter between ownership and a Revelation Map.
  const refreshQuietly = () => void refreshRevealed().catch(() => {});
  refreshQuietly();
  // Every Reveal / un-reveal changes the Revealed filter (T16 → T23).
  reveal.subscribe(refreshQuietly);
  // T17: the active GM keeps the Player View current; Player Canvases follow it and the docs.
  if (isActiveGM(game as never)) playerViewPublisher.start();
  for (const hook of ['createSetting', 'updateSetting'])
    Hooks.on(
      hook as never,
      ((setting: { key?: string }) => {
        if (setting.key === `${MODULE_ID}.playerView`) playerCanvasChanged();
      }) as never,
    );
  for (const doc of ['Actor', 'Item', 'JournalEntry', 'JournalEntryPage'])
    for (const op of ['create', 'update', 'delete'])
      Hooks.on(`${op}${doc}` as never, playerCanvasChanged as never);
  getSession().workingCopy.watch((change) => change.binding && setTimeout(refreshQuietly, 500));
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
  registerFocusHooks(focus, { on: (hook, fn) => void Hooks.on(hook as never, fn as never) });
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
    run: (name) => registry.run(name),
  });
});
