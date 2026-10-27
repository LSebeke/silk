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
  // dsa5 opens a modal skin dialog, a patch-notes window and a "Did you know?" tip on fresh
  // clients at random moments after `ready`; they swallow pointer input. Close them whenever
  // they get in the way.
  const DSA5_POPUPS = ['dsa5-skin-selection-dialog', 'dsa5-patch-viewer'];
  // Foundry's welcome tour overlay too.
  const selector = [...DSA5_POPUPS.map((id) => `#${id}`), '.didYouKnow', '.tour-overlay'].join(
    ', ',
  );
  await page.addLocatorHandler(page.locator(selector).first(), () =>
    page.evaluate(async (ids) => {
      for (const id of ids) {
        await foundry.applications.instances.get(id)?.close();
        // The patch viewer is no registered app instance: drop its element.
        document.getElementById(id)?.remove();
      }
      for (const tip of document.querySelectorAll('.didYouKnow')) tip.remove();
      (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
      for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout'))
        el.remove();
    }, DSA5_POPUPS),
  );
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
  await waitForSilk(page);
  return page;
}

/**
 * `game.ready` flips before Silk's async `ready` hook has started its session; wait for
 * that too when Silk is enabled (it isn't on the first, setup join).
 */
export async function waitForSilk(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      try {
        if (game.ready !== true) return false;
        if (!game.modules?.get('silk')?.active) return true;
        return !!game.modules.get('silk')?.session?.();
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 60_000 },
  );
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

export const test = base.extend<{ gm: Page; player: Page }, { world: World; worldKey: string }>({
  /**
   * The World is shared by every test in a worker. A file that needs a fresh one (e.g. an
   * unbound World) sets its own key with `test.use({ worldKey })`: Playwright gives it a
   * separate worker, hence a separate World.
   */
  worldKey: ['shared', { scope: 'worker', option: true }],
  world: [
    async ({ browser, worldKey }, use) => {
      const run = `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}-${worldKey}`;
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
  // Joins take tens of seconds under load: their own timeout, not the test's budget.
  gm: [
    async ({ browser, world }, use) => {
      const page = await world.join(browser, GM);
      await use(page);
      await page.context().close();
    },
    { timeout: 120_000 },
  ],
  player: [
    async ({ browser, world }, use) => {
      const page = await world.join(browser, PLAYER);
      await use(page);
      await page.context().close();
    },
    { timeout: 120_000 },
  ],
});
