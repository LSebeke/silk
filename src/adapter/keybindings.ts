/** Foundry keybindings derived from command `keys` (spec §2). Register on `init`. */
import { MODULE_ID } from '../constants';
import type { CommandRegistry, KeyChord } from '../core/commands/registry';

export interface KeybindingData {
  name: string;
  editable: KeyChord[];
  /** Returns true when Silk handled the key, so Foundry stops propagating it. */
  onDown(): boolean;
}

export type RegisterKeybinding = (
  namespace: typeof MODULE_ID,
  action: string,
  data: KeybindingData,
) => void;

export function registerKeybindings(registry: CommandRegistry, register: RegisterKeybinding): void {
  for (const command of registry.list()) {
    if (!command.keys?.length) continue;
    register(MODULE_ID, command.name, {
      name: command.title,
      editable: command.keys,
      onDown() {
        if (!registry.isAvailable(command.name)) return false;
        registry.run(command.name).catch((error: unknown) => console.error(error));
        return true;
      },
    });
  }
}
