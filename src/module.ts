/**
 * Entry point. Wires the pure core to Foundry through the adapter and exposes the
 * command registry at `game.modules.get('silk').api` (spec §2, ADR 0003).
 */
import { registerKeybindings } from './adapter/keybindings';
import { addSilkSceneControl, type SceneControls } from './adapter/scene-controls';
import { registerSettings } from './adapter/settings';
import { MODULE_ID } from './constants';
import { createRegistry } from './core/commands/registry';
import { canvasCommands } from './ui/canvas/commands';
import './ui/silk.css';

const registry = createRegistry(() => ({ isGM: game.user?.isGM ?? false }));
for (const command of canvasCommands) registry.register(command);

Hooks.once('init', () => {
  registerSettings((ns, key, data) => game.settings?.register(ns, key as never, data as never));
  registerKeybindings(registry, (ns, action, data) =>
    game.keybindings?.register(ns, action, data as never),
  );
  const module = game.modules?.get(MODULE_ID);
  if (module) module.api = registry;
});

Hooks.on('getSceneControlButtons', (controls) => {
  addSilkSceneControl(controls as unknown as SceneControls, {
    isGM: game.user?.isGM ?? false,
    run: (name) => registry.run(name),
  });
});
