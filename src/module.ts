/**
 * Entry point. Wires the pure core to Foundry through the adapter and exposes the
 * command registry at `game.modules.get('silk').api` (spec §2, ADR 0003).
 */
import { registerConnectionsPageHooks } from './adapter/connections-page';
import { dsa5Mapping } from './adapter/dsa5';
import { showFileBrowseNotice } from './adapter/file-browse-notice';
import { createFoundryDocs } from './adapter/foundry-docs';
import { registerKeybindings } from './adapter/keybindings';
import { foundryApi, registerMaterializeHooks } from './adapter/materialize';
import { registerOwnsHooks } from './adapter/owns';
import { foundryOwnershipRevealed } from './adapter/revealed';
import { addSilkSceneControl, type SceneControls } from './adapter/scene-controls';
import { getSession, startSession } from './adapter/session';
import { registerSettings } from './adapter/settings';
import { isActiveGM } from './adapter/working-copy-journal';
import { MODULE_ID } from './constants';
import {
  canvasCoreCommands,
  createCanvasFilter,
  createCanvasState,
  createCreationPipeline,
  createLayoutTween,
  createRevealedSource,
  createViewState,
  filterCommands,
  joinFrameOnCreate,
  layoutCommands,
} from './core/canvas';
import { createRegistry } from './core/commands/registry';
import { devCoreCommands } from './core/dev/commands';
import { campaignCommands } from './core/campaigns/commands';
import { connectionCommands, connectOnCreate } from './core/connections';
import { elementCommands, type ElementCommandDeps } from './core/elements';
import { historyCommands } from './core/history';
import {
  createConnectionsPages,
  createMaterializer,
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
/** Canvas Filters (§10.5); Revealed reads the Campaign's map under an Adventure, else ownership. */
const revealed = createRevealedSource({
  revelationMap: async () => {
    const campaigns = getSession().campaigns;
    const campaign = await campaigns.checkedOutCampaign();
    return campaign ? campaigns.readRevelationMap(campaign.id) : null;
  },
  ownership: (element) => foundryOwnershipRevealed(element.uuid),
});
const canvasFilter = createCanvasFilter({ workingCopy, viewState, revealed });
/** `element.create` hooks: T7 (Connection to `from`) and T8 (immediate Materialize) push here. */
const afterCreate: NonNullable<ElementCommandDeps['afterCreate']> = [];
afterCreate.push(connectOnCreate({ workingCopy, run: (name, args) => registry.run(name, args) }));
/** T26: a Node created inside a Visual Group frame joins it. */
afterCreate.push(joinFrameOnCreate(workingCopy));
/** Untangle tween: layout commands announce old positions, the canvas animates. */
const layoutTween = createLayoutTween();

/** Materialize + write-through (spec §6, §7). */
const foundryDocs = createFoundryDocs(foundryApi());
/** T12 owns ↔ inventory; created below, after the materializer it uses. */
// eslint-disable-next-line prefer-const -- the materializer's deps reach it lazily
let owns: Owns;
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
  afterMaterialize: (id) => owns.afterMaterialize(id),
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
afterCreate.push((element) => materializer.afterCreate(element));
pipeline.onComplete(({ id }) => {
  materializer.afterPipeline(id).catch((error: unknown) => console.error(error));
  owns.afterPipeline(id).catch((error: unknown) => console.error(error));
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
  refreshRevealed: () => revealed.refresh(),
  renderBudget: game.settings?.get(MODULE_ID, 'renderBudgetWarning') ?? 1000,
  localize,
});

for (const command of [
  ...elementCommands({
    workingCopy,
    newId: () => foundry.utils.randomID(16),
    afterCreate,
    afterRename: [(element) => materializer.writeName(element.id)],
  }),
  ...materializeCommands(materializer),
  ...owns.wrap(connectionCommands({ workingCopy, newId: () => foundry.utils.randomID(16) })),
  ...canvasCoreCommands({ workingCopy, state: canvasState }),
  ...layoutCommands({
    workingCopy,
    state: canvasState,
    newId: () => foundry.utils.randomID(16),
    groupLabel: () => localize('SILK.Canvas.NewGroup'),
    tween: (from) => layoutTween.start(from),
  }),
  ...filterCommands(canvasFilter),
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
  connectionsPages.watch();
  // Checkout changes switch the Revealed filter between ownership and a Revelation Map.
  const refreshRevealed = () => void revealed.refresh().catch(() => {});
  refreshRevealed();
  getSession().workingCopy.watch((change) => change.binding && refreshRevealed());
  registerConnectionsPageHooks(connectionsPages, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
  });
  // Reconcile on load (§7): pages written while Silk was off, or by an older version.
  if (isActiveGM(game as never)) void connectionsPages.refresh().catch(() => {});
  registerOwnsHooks(owns, {
    on: (hook, fn) => void Hooks.on(hook as never, fn as never),
    isActiveGM: () => isActiveGM(game as never),
  });
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
