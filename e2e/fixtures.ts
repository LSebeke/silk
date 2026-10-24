/**
 * Playwright fixtures. One headless Foundry + `silk-test-<run>` world per worker (silk
 * enabled, users `Gamemaster` and `Player`); `gm` and `player` are joined, ready pages.
 */
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FOUNDRY_USER_DATA,
  createAndLaunchWorld,
  deleteWorld,
  freePort,
  prepareDataPath,
  startFoundry,
} from './harness';

export { expect };

export const GM = 'Gamemaster';
export const PLAYER = 'Player';

export interface World {
  url: string;
  id: string;
  /** Opens a fresh browser context joined as `userName`, waits for `game.ready`. */
  join(browser: Browser, userName: string): Promise<Page>;
}

async function join(browser: Browser, url: string, userName: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: url })).newPage();
  page.on('pageerror', (err) => console.error(`[${userName}] ${err.message}`));
  await page.goto('/join');
  await page.waitForFunction(() => (game.users?.size ?? 0) > 0);
  const status = await page.evaluate(async (name) => {
    const user = game.users?.getName(name);
    if (!user) return `no user ${name}`;
    const res = await fetch('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'join', userId: user.id, password: '' }),
    });
    return res.ok ? 'ok' : await res.text();
  }, userName);
  if (status !== 'ok') throw new Error(`Join as ${userName} failed: ${status}`);
  await page.goto('/game');
  await page.waitForFunction(() => game.ready === true, undefined, { timeout: 60_000 });
  return page;
}

/** First GM session: add the player and enable silk (takes effect on next load). */
async function setUpWorld(page: Page): Promise<void> {
  await page.evaluate(async (playerName) => {
    if (!game.users?.getName(playerName)) {
      await User.implementation.create({ name: playerName, role: CONST.USER_ROLES.PLAYER });
    }
    const config = game.settings?.get('core', 'moduleConfiguration') ?? {};
    await game.settings?.set('core', 'moduleConfiguration', { ...config, silk: true });
  }, PLAYER);
}

export const test = base.extend<{ gm: Page; player: Page }, { world: World }>({
  world: [
    async ({ browser }, use) => {
      const run = `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
      const dataPath = prepareDataPath({
        source: FOUNDRY_USER_DATA,
        dist: resolve(import.meta.dirname, '../dist'),
      });
      const foundry = await startFoundry({ dataPath, port: await freePort() });
      let id: string | undefined;
      try {
        id = await createAndLaunchWorld(foundry, run);
        const setup = await join(browser, foundry.url, GM);
        await setUpWorld(setup);
        await setup.context().close();
        await use({ url: foundry.url, id, join: (b, name) => join(b, foundry.url, name) });
      } finally {
        await foundry.stop();
        if (id) deleteWorld(foundry, id);
        rmSync(dataPath, { recursive: true, force: true });
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  gm: async ({ browser, world }, use) => {
    const page = await world.join(browser, GM);
    await use(page);
    await page.context().close();
  },
  player: async ({ browser, world }, use) => {
    const page = await world.join(browser, PLAYER);
    await use(page);
    await page.context().close();
  },
});
