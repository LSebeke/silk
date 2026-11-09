/**
 * Bridge from the MCP server into a Foundry page that has Garn loaded: every call is a
 * `page.evaluate` against `game.modules.get('garn').api`. The functions below are
 * serialized into the page, so they must stay self-contained (no outer references).
 */
import type { CommandRegistry } from '../../src/core/commands/registry';
import type { CommandInfo, GarnBridge } from './server';

/** The slice of a Playwright `Page` the bridge needs. */
export interface EvaluatingPage {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

interface PageGlobals {
  game?: { modules?: { get(id: string): { api?: CommandRegistry } | undefined } };
}

export function pageBridge(page: EvaluatingPage): GarnBridge {
  return {
    listCommands: () =>
      page.evaluate((): CommandInfo[] => {
        const api = (globalThis as PageGlobals).game?.modules?.get('garn')?.api;
        if (!api) throw new Error('Garn API not found: is the module enabled and the world ready?');
        return api.list().map((c) => ({
          name: c.name,
          title: c.title,
          available: api.isAvailable(c.name),
        }));
      }, undefined),
    run: (name, args) =>
      page.evaluate(
        ({ name, args }) => {
          const api = (globalThis as PageGlobals).game?.modules?.get('garn')?.api;
          if (!api)
            throw new Error('Garn API not found: is the module enabled and the world ready?');
          return api.run(name, args);
        },
        { name, args },
      ),
  };
}
