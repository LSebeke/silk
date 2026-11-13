/**
 * Element Detail layout and rename against real Foundry (v1.1 §G.1): 16 px side padding,
 * fixed header over a scrolling body; the pencil beside the name renames inline.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function ready(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('garn')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async () => {
    const wc = game.modules?.get('garn')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await game.settings?.set('garn', 'materializeMode', 'immediate');
  });
}

const elementName = (page: Page, id: string) =>
  page.evaluate(
    (i) => game.modules?.get('garn')?.session?.().workingCopy.get(i)?.data['name'] as string,
    id,
  );

test('Element Detail layout: 16 px side padding, fixed header, scrolling body', async ({ gm }) => {
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'location',
    name: 'Hafen',
    at: { x: 200, y: 200 },
  });
  for (let i = 0; i < 6; i++) await api(gm, 'infoBlock.create', { elementId: id });
  await api(gm, 'element.openDetail', { id });
  await gm.evaluate(
    (i) => foundry.applications.instances.get(`garn-detail-${i}`)?.setPosition({ height: 260 }),
    id,
  );
  const detail = gm.locator(`[data-garn-detail="${id}"]`);
  await expect(detail).toBeVisible();

  const padding = await detail.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.paddingLeft, s.paddingRight];
  });
  expect(padding).toEqual(['16px', '16px']);

  const header = detail.locator('header');
  const before = await header.boundingBox();
  const body = detail.locator('[data-garn-detail-body]');
  const scrolled = await body.evaluate((el) => {
    el.scrollTop = 10_000;
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  expect(await header.boundingBox()).toEqual(before);
});

test('Element Detail rename: pencil edits inline, Enter/blur save, Esc cancels', async ({ gm }) => {
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'person',
    name: 'Alrik',
    at: { x: 200, y: 200 },
  });
  await api(gm, 'element.openDetail', { id });
  const detail = gm.locator(`[data-garn-detail="${id}"]`);
  const pencil = detail.locator('[data-garn-detail-rename]');
  const field = detail.locator('[data-garn-detail-name-input]');

  // Enter saves.
  await pencil.click();
  await expect(field).toBeFocused();
  await field.fill('Alrik vom Berg');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect.poll(() => elementName(gm, id)).toBe('Alrik vom Berg');
  await expect(detail.locator('h2')).toHaveText('Alrik vom Berg');

  // Esc cancels.
  await pencil.click();
  await field.fill('Niemand');
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(detail.locator('h2')).toHaveText('Alrik vom Berg');
  expect(await elementName(gm, id)).toBe('Alrik vom Berg');

  // Blur saves.
  await pencil.click();
  await field.fill('Alrik');
  await detail.locator('[data-garn-detail-body]').click({ position: { x: 4, y: 4 } });
  await expect(field).toHaveCount(0);
  await expect.poll(() => elementName(gm, id)).toBe('Alrik');
});
