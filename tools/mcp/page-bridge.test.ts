import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../../src/core/commands/registry';
import { pageBridge, type EvaluatingPage } from './page-bridge';

/** Stands in for a Playwright page: runs the function "in the page", here this process. */
const inProcessPage: EvaluatingPage = {
  evaluate: async (fn, arg) => fn(arg),
};

function foundryWithSilk(isGM: boolean) {
  const api = createRegistry(() => ({ isGM }));
  api.register({
    name: 'canvas.open',
    title: 'SILK.Command.canvas.open',
    available: () => true,
    run: async () => 'opened',
  });
  api.register({
    name: 'element.rename',
    title: 'Rename',
    available: (ctx) => ctx.isGM,
    run: async (args: { id: string; name: string }) => ({ renamed: args }),
  });
  vi.stubGlobal('game', { modules: new Map([['silk', { api }]]) });
}

afterEach(() => vi.unstubAllGlobals());

describe('pageBridge', () => {
  it("lists the page's registry commands with their availability", async () => {
    foundryWithSilk(false);
    expect(await pageBridge(inProcessPage).listCommands()).toEqual([
      { name: 'canvas.open', title: 'SILK.Command.canvas.open', available: true },
      { name: 'element.rename', title: 'Rename', available: false },
    ]);
  });

  it('runs a command through the page registry', async () => {
    foundryWithSilk(true);
    const result = await pageBridge(inProcessPage).run('element.rename', { id: 'e1', name: 'X' });
    expect(result).toEqual({ renamed: { id: 'e1', name: 'X' } });
  });

  it('fails clearly when Silk is not loaded in the page', async () => {
    vi.stubGlobal('game', { modules: new Map() });
    await expect(pageBridge(inProcessPage).listCommands()).rejects.toThrow(/Silk API not found/);
  });
});
