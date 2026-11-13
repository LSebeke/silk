import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function resetCanvas(page: Page) {
  await page.evaluate(async () => {
    const wc = game.modules?.get('garn')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await game.settings?.set('garn', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  });
}

test('Legend (spec 1.1 §E.3): open by default, ? and the button toggle it', async ({ gm }) => {
  await resetCanvas(gm);
  await api(gm, 'canvas.open');
  const panel = gm.locator('[data-garn-legend-panel]');
  await expect(panel).toBeVisible();
  await expect(gm.locator('[data-garn-legend-group]')).toHaveCount(3);
  await expect(panel).toContainText('Right-drag Node → Node: connect');
  await expect(panel).toContainText('on a selected Node or Connection');
  // Garn's live Foundry keybindings (Materialize: M).
  await expect(gm.locator('[data-garn-legend-group="foundry"]')).toContainText('Materialize');

  await gm.locator('[data-garn-canvas]').focus();
  await gm.keyboard.press('Shift+Slash');
  await expect(panel).toHaveCount(0);
  expect(await gm.evaluate(() => game.settings?.get('garn', 'legendOpen'))).toBe(false);

  await gm.locator('[data-garn-action="legend"]').click();
  await expect(panel).toBeVisible();
  expect(await gm.evaluate(() => game.settings?.get('garn', 'legendOpen'))).toBe(true);
});

test('Del on a selected Connection deletes it at once (spec 1.1 §E.4)', async ({ gm }) => {
  await resetCanvas(gm);
  const { id: a } = await api<{ id: string }>(gm, 'element.create', {
    class: 'person',
    name: 'Alrik',
    at: { x: 100, y: 300 },
  });
  const { id: b } = await api<{ id: string }>(gm, 'element.create', {
    class: 'person',
    name: 'Rondra',
    at: { x: 700, y: 300 },
  });
  const { id } = await api<{ id: string }>(gm, 'connection.create', {
    from: a,
    to: b,
    label: 'loves',
  });
  await api(gm, 'canvas.open');
  const path = gm.locator(`.svelte-flow__edge[data-id="${id}"] .svelte-flow__edge-path`);
  await expect.poll(async () => (await path.boundingBox())?.width ?? 0).toBeGreaterThan(300);
  const label = gm.locator(`[data-garn-edge="${id}"]`);
  await label.click();
  await expect(label).toHaveClass(/selected/);

  await gm.keyboard.press('Delete');
  await expect(gm.locator(`.svelte-flow__edge[data-id="${id}"]`)).toHaveCount(0);
  const left = await gm.evaluate(
    (ids) => ids.map((i) => !!game.modules?.get('garn')?.session?.().workingCopy.get(i)),
    [id, a, b],
  );
  expect(left).toEqual([false, true, true]);
});
