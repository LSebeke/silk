/**
 * Command registry (spec §2, ADR 0003). Every UI action is a command.
 * Pure core: knows nothing about Foundry. The adapter supplies the context.
 */

/** What `available()` sees. Grows as features need it; keep it plain data. */
export interface CommandContext {
  isGM: boolean;
}

/** A key chord in Foundry's keybinding format, e.g. `{ key: 'KeyS', modifiers: ['Shift'] }`. */
export interface KeyChord {
  key: string;
  modifiers?: ('Control' | 'Shift' | 'Alt')[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are typed per command
export interface Command<Args = any, Result = unknown> {
  /** Dot-namespaced `area.verb`, see spec §15. */
  name: string;
  /** i18n key or plain text for menus, palette and keybinding config. */
  title: string;
  keys?: KeyChord[];
  available(ctx: CommandContext): boolean;
  run(args: Args): Promise<Result>;
}

export interface CommandRegistry {
  register(command: Command): void;
  get(name: string): Command | undefined;
  list(): Command[];
  isAvailable(name: string): boolean;
  run<Result = unknown>(name: string, args?: object): Promise<Result>;
}

/** `area.verb` or deeper (`dev.fixture.generate`); camelCase segments. */
const COMMAND_NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export function createRegistry(getContext: () => CommandContext): CommandRegistry {
  const commands = new Map<string, Command>();

  return {
    register(command) {
      if (!COMMAND_NAME.test(command.name))
        throw new Error(`Silk: command name "${command.name}" must be dot-namespaced area.verb`);
      if (commands.has(command.name))
        throw new Error(`Silk: command "${command.name}" is already registered`);
      commands.set(command.name, command);
    },
    get: (name) => commands.get(name),
    list: () => [...commands.values()],
    isAvailable(name) {
      const command = commands.get(name);
      return command !== undefined && command.available(getContext());
    },
    async run<Result>(name: string, args: object = {}) {
      const command = commands.get(name);
      if (!command) throw new Error(`Silk: unknown command "${name}"`);
      if (!command.available(getContext()))
        throw new Error(`Silk: command "${name}" is not available right now`);
      return (await command.run(args)) as Result;
    },
  };
}
