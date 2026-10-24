/**
 * Entry point. Wires the pure core to Foundry through the adapter and exposes the
 * command registry at `game.modules.get('silk').api` (spec §2, ADR 0003).
 */
import { showFileBrowseNotice } from './adapter/file-browse-notice';
import { registerKeybindings } from './adapter/keybindings';
import { addSilkSceneControl, type SceneControls } from './adapter/scene-controls';
import { getSession, startSession } from './adapter/session';
import { registerSettings } from './adapter/settings';
import { MODULE_ID } from './constants';
import {
  canvasCoreCommands,
  createCanvasState,
  createCreationPipeline,
  createViewState,
} from './core/canvas';
import { createRegistry } from './core/commands/registry';
import { campaignCommands } from './core/campaigns/commands';
import { connectionCommands, connectOnCreate } from './core/connections';
import { elementCommands, type ElementCommandDeps } from './core/elements';
import { historyCommands } from './core/history';
import { canonCommands } from './ui/canon/commands';
import { canvasUiCommands } from './ui/canvas/commands';
import type { CanvasContext } from './ui/canvas/context';
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

const canvasContext = (): CanvasContext => ({
  run: (name, args) => registry.run(name, args),
  workingCopy: workingCopy(),
  state: canvasState,
  pipeline,
  viewState,
  detailDrop: game.settings?.get(MODULE_ID, 'detailDrop') ?? true,
  localize,
});

for (const command of [
  ...elementCommands({ workingCopy, newId: () => foundry.utils.randomID(16), afterCreate }),
  ...connectionCommands({ workingCopy, newId: () => foundry.utils.randomID(16) }),
  ...canvasCoreCommands({ workingCopy, state: canvasState }),
  ...canvasUiCommands(canvasContext),
  ...canonCommands,
  ...historyCommands(() => getSession().history),
  ...campaignCommands(() => getSession().campaigns),
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
