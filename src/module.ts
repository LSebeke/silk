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
import { createRegistry } from './core/commands/registry';
import { historyCommands } from './core/history';
import { canvasCommands } from './ui/canvas/commands';
import './ui/silk.css';

const registry = createRegistry(() => ({ isGM: game.user?.isGM ?? false }));
for (const command of [...canvasCommands, ...historyCommands(() => getSession().history)])
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
