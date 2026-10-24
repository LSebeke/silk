/**
 * Gets a Playwright page on a running Foundry world with Silk loaded. Kept small on
 * purpose: the e2e harness owns starting Foundry and worlds; this only attaches to one.
 */
import { chromium, type Page } from 'playwright-core';

export interface FoundryTarget {
  /** Foundry base URL, e.g. `http://localhost:30001`. */
  url: string;
  /** Attach to an already running browser (CDP endpoint) instead of launching one. */
  cdp?: string;
  /** User to join as when launching (default `Gamemaster`). */
  user?: string;
  password?: string;
  /** Chromium binary when Playwright's own is not installed. */
  executablePath?: string;
  headless?: boolean;
}

const isReady = () => (globalThis as { game?: { ready?: boolean } }).game?.ready === true;

export async function connectFoundryPage(target: FoundryTarget): Promise<Page> {
  if (target.cdp) {
    const browser = await chromium.connectOverCDP(target.cdp);
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = pages.find((p) => p.url().startsWith(target.url) && p.url().includes('/game'));
    if (!page) throw new Error(`No Foundry /game page for ${target.url} in the CDP browser`);
    await page.waitForFunction(isReady);
    return page;
  }

  const browser = await chromium.launch({
    headless: target.headless ?? true,
    executablePath: target.executablePath,
  });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/join', target.url).href);
    await page.selectOption('select[name="userid"]', { label: target.user ?? 'Gamemaster' });
    if (target.password) await page.fill('input[name="password"]', target.password);
    await page.click('button[name="join"]');
    await page.waitForURL(/\/game$/);
    await page.waitForFunction(isReady);
    return page;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
