import type { Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [name, args] as const);

/** Fresh working copy with `records`, no filters, the canvas open. */
async function openWith(page: Page, records: CanonRecord[], budget = 1000) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(
    async ([json, max]) => {
      for (const app of [...foundry.applications.instances.values()])
        if (app.element?.classList.contains('dsa5')) await app.close();
      for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
      (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
      for (const el of document.querySelectorAll(
        '.tour, .tour-overlay, .tour-fadeout, .didYouKnow',
      ))
        el.remove();
      // Permanent notices (hardware acceleration, FILES_BROWSE) sit over the chip bar.
      ui.notifications?.clear();
      document.getElementById('notifications')?.style.setProperty('display', 'none');
      await foundry.applications.instances.get('silk-canvas')?.close();
      while (foundry.applications.instances.get('silk-canvas'))
        await new Promise((r) => setTimeout(r, 20));
      await game.settings?.set('silk', 'materializeMode', 'onDemand');
      await game.settings?.set('silk', 'renderBudgetWarning', max as number);
      const wc = game.modules?.get('silk')?.session?.().workingCopy;
      await wc?.delete([...(wc.records().keys() ?? [])]);
      await wc?.set(JSON.parse(json as string));
      await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
    },
    [JSON.stringify(records), budget] as const,
  );
  await api(page, 'canvas.open');
  await expect(page.locator('[data-silk-canvas]')).toBeVisible();
}

const el = (id: string, cls: string, x: number, tags?: string[]): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: cls, name: id, position: { x, y: 100 }, ...(tags ? { tags } : {}) },
});
const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type: 'free', direction: 'directed', label: 'knows' },
});

const WEB = [
  el('fa', 'person', 0, ['noble']),
  el('fb', 'person', 250),
  el('fi', 'item', 500, ['noble']),
  el('fl', 'location', 750),
  link('fc1', 'fa', 'fi'),
  link('fc2', 'fa', 'fl'),
];

test('GM filters the canvas: chips, N of M, +N badge, clear', async ({ gm }) => {
  test.setTimeout(90_000);
  await openWith(gm, WEB);
  const nodes = gm.locator('[data-silk-node]');
  const count = gm.locator('[data-silk-filter-count]');
  await expect(nodes).toHaveCount(4);
  await expect(count).toHaveText('4 of 4 shown');
  await expect(gm.locator('[data-silk-filter-chip]')).toHaveCount(0);

  // OR within a dimension, AND across: (person ∨ item) ∧ noble.
  await api(gm, 'filter.set', { dimension: 'class', values: ['person', 'item'] });
  await expect(nodes).toHaveCount(3);
  await api(gm, 'filter.set', { dimension: 'tag', values: ['noble'] });
  await expect(nodes).toHaveCount(2);
  await expect(count).toHaveText('2 of 4 shown');
  await expect(gm.locator('[data-silk-filter-chip]')).toHaveCount(3);
  // Filtered-out Nodes are not rendered; edges only between visible ones.
  await expect(gm.locator('[data-silk-node="fb"]')).toHaveCount(0);
  await expect(gm.locator('.svelte-flow__edge')).toHaveCount(1);

  // "+N": fa has one hidden neighbour (fl); clicking shows it.
  const badge = gm.locator('[data-silk-node="fa"] [data-silk-badge]');
  await expect(badge).toHaveText('+1');
  await badge.click();
  await expect(gm.locator('[data-silk-node="fl"]')).toBeVisible();
  await expect(badge).toHaveCount(0);
  await expect(gm.locator('[data-silk-filter-expanded]')).toBeVisible();

  // Removing a chip relaxes its dimension.
  await gm.locator('[data-silk-filter-chip="tag"] [data-silk-action="filter-remove"]').click();
  await expect(nodes).toHaveCount(4);

  // Picker: Class → Location.
  await gm.locator('[data-silk-action="filter-clear"]').click();
  await expect(count).toHaveText('4 of 4 shown');
  await gm.locator('[data-silk-filter-dimension]').selectOption('class');
  await gm.locator('[data-silk-filter-option]').selectOption('location');
  await expect(nodes).toHaveCount(1);
  await expect(gm.locator('[data-silk-node="fl"]')).toBeVisible();

  // Filters persist in the view state and survive a reopen.
  await gm.evaluate(() => foundry.applications.instances.get('silk-canvas')?.close());
  await expect(gm.locator('[data-silk-canvas]')).toHaveCount(0);
  await api(gm, 'canvas.open');
  await expect(nodes).toHaveCount(1);
  await api(gm, 'filter.clear');
  await expect(nodes).toHaveCount(4);
});

test('Materialize visible acts on the filtered Nodes only', async ({ gm }) => {
  test.setTimeout(90_000);
  await openWith(gm, [el('ma', 'note', 0), el('mb', 'location', 250)]);
  await api(gm, 'filter.set', { dimension: 'class', values: ['note'] });
  await expect(gm.locator('[data-silk-node]')).toHaveCount(1);
  await api(gm, 'materialize.visible', { confirmed: true });
  const uuid = (id: string) =>
    gm.evaluate((i) => game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'], id);
  await expect.poll(() => uuid('ma')).toBeTruthy();
  expect(await uuid('mb')).toBeUndefined();
  await api(gm, 'filter.clear');
});

test('render budget: a non-blocking warning above the client threshold', async ({ gm }) => {
  test.setTimeout(60_000);
  await openWith(gm, WEB, 3);
  const warning = gm.locator('[data-silk-render-budget]');
  await expect(warning).toBeVisible();
  await api(gm, 'filter.set', { dimension: 'class', values: ['person'] });
  await expect(warning).toHaveCount(0);
  await api(gm, 'filter.clear');
  await gm.evaluate(() => game.settings?.set('silk', 'renderBudgetWarning', 1000));
});
