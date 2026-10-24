import type { Locator, Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [name, args] as const);

const elements = (page: Page): Promise<CanonRecord[]> =>
  page.evaluate(() => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records();
    return [...(records?.values() ?? [])].filter((r) => r.kind === 'element');
  });

/** Earlier tests share the worker's world: start from no elements and a 1:1 view. */
async function resetCanvas(page: Page) {
  // `game.ready` precedes Silk's async `ready` hook: wait for the session.
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async () => {
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  });
}

async function openCanvas(page: Page) {
  await api(page, 'canvas.open');
  await expect(page.locator('[data-silk-canvas]')).toBeVisible();
}

const closeCanvas = (page: Page) =>
  page.evaluate(() => foundry.applications.instances.get('silk-canvas')?.close());

const viewportTransform = (page: Page) =>
  page.locator('.svelte-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return box;
}

test('GM creates, names, moves and selects a Ghost on the canvas; view restores', async ({
  gm,
}) => {
  await resetCanvas(gm);
  await openCanvas(gm);
  const pane = gm.locator('[data-silk-canvas] .svelte-flow__pane');

  // Creation Pipeline: right-click → class box → name field.
  await pane.click({ button: 'right', position: { x: 300, y: 200 } });
  const search = gm.locator('[data-silk-class-search]');
  await expect(search).toBeFocused();
  await expect(gm.locator('[data-silk-class-option="playerCharacter"]')).toHaveCount(0);
  await search.fill('loc');
  await expect(gm.locator('[data-silk-class-option]')).toHaveCount(1);
  await search.press('Enter');

  const nameInput = gm.locator('[data-silk-name-input]');
  await expect(nameInput).toBeFocused();
  await gm.keyboard.type('Gareth');
  await gm.keyboard.press('Enter');
  await expect(nameInput).toHaveCount(0);
  await expect(gm.locator('[data-silk-class-box]')).toHaveCount(0);

  const card = gm.locator('[data-silk-node]', { hasText: 'Gareth' });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-silk-class', 'location');
  await expect(card).toHaveAttribute('data-silk-ghost', '');
  await expect(card).toHaveCSS('opacity', '0.55');

  const [created] = (await elements(gm)).filter((r) => r.data['name'] === 'Gareth');
  expect(created?.data).toEqual({
    class: 'location',
    name: 'Gareth',
    position: { x: 300, y: 200 },
  });
  const id = created?.id ?? '';

  // Drag → canvas.moveNodes (zoom 1: screen px = canvas units).
  const box = await boxOf(card);
  await gm.mouse.move(box.x + 20, box.y + 20);
  await gm.mouse.down();
  await gm.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await gm.mouse.move(box.x + 120, box.y + 100, { steps: 5 });
  await gm.mouse.up();
  // ~100/80 px; the drag threshold eats a few.
  await expect
    .poll(async () => {
      const p = (await elements(gm)).find((r) => r.id === id)?.data['position'] as
        { x: number; y: number } | undefined;
      return p && p.x > 370 && p.x <= 400 && p.y > 255 && p.y <= 280;
    })
    .toBe(true);

  // canvas.select drives the card's selection.
  await api(gm, 'canvas.select', { ids: [id] });
  await expect(card).toHaveClass(/selected/);
  await api(gm, 'canvas.select', { ids: [] });
  await expect(card).not.toHaveClass(/selected/);

  // Pan, close, reopen: the view is restored.
  const pb = await boxOf(pane);
  await gm.mouse.move(pb.x + 600, pb.y + 400);
  await gm.mouse.down();
  await gm.mouse.move(pb.x + 500, pb.y + 300, { steps: 5 });
  await gm.mouse.up();
  const panned = await viewportTransform(gm);
  await expect
    .poll(() => gm.evaluate(() => game.settings?.get('silk', 'viewState')))
    .toEqual({ viewport: { x: -100, y: -100, zoom: 1 } });
  await closeCanvas(gm);
  await openCanvas(gm);
  await expect.poll(() => viewportTransform(gm)).toBe(panned);
  await expect(gm.locator('[data-silk-node]', { hasText: 'Gareth' })).toBeVisible();
});

test('the canvas window remembers its position', async ({ gm }) => {
  await openCanvas(gm);
  await gm.evaluate(() =>
    foundry.applications.instances.get('silk-canvas')?.setPosition({ left: 123, top: 45 }),
  );
  await expect
    .poll(() =>
      gm.evaluate(
        () =>
          (game.settings?.get('silk', 'windowState') as Record<string, { position?: object }>)[
            'silk-canvas'
          ]?.position,
      ),
    )
    .toMatchObject({ left: 123, top: 45 });
  await closeCanvas(gm);
  await gm.reload();
  await gm.waitForFunction(() => game.ready === true);
  await openCanvas(gm);
  const position = await gm.evaluate(() => {
    const { left, top } = foundry.applications.instances.get('silk-canvas')?.position ?? {};
    return { left, top };
  });
  expect(position).toEqual({ left: 123, top: 45 });
});

const savedDetached = (page: Page) =>
  page.evaluate(
    () =>
      (game.settings?.get('silk', 'windowState') as Record<string, { detached?: boolean }>)[
        'silk-canvas'
      ]?.detached,
  );

test('a detached canvas re-detaches on open and works in its own window', async ({ gm }) => {
  await openCanvas(gm);
  const popup = gm.context().waitForEvent('page');
  await gm.evaluate(() => foundry.applications.instances.get('silk-canvas')?.detachWindow());
  const win = await popup;
  await expect(win.locator('[data-silk-canvas] .svelte-flow__pane')).toBeVisible();
  await expect.poll(() => savedDetached(gm)).toBe(true);
  await closeCanvas(gm);
  // Foundry reuses an open popup with the same id: wait until the first one is gone.
  await expect.poll(() => win.isClosed()).toBe(true);

  await api(gm, 'canvas.open');
  // The re-detached popup: the context's page that holds the canvas.
  let win2 = gm;
  await expect
    .poll(async () => {
      for (const p of gm.context().pages())
        if (p !== gm && !p.isClosed() && (await p.locator('[data-silk-canvas]').count())) {
          win2 = p;
          return true;
        }
      return false;
    })
    .toBe(true);
  const pane = win2.locator('[data-silk-canvas] .svelte-flow__pane');
  await expect(pane).toBeVisible();

  // The Creation Pipeline works inside the popup (binds to its ownerDocument).
  await pane.click({ button: 'right', position: { x: 200, y: 150 } });
  await expect(win2.locator('[data-silk-class-search]')).toBeFocused();
  await win2.locator('[data-silk-class-option="faction"]').click();
  await expect(win2.locator('[data-silk-name-input]')).toBeFocused();
  await win2.keyboard.type('Guild');
  await win2.keyboard.press('Enter');
  await expect(win2.locator('[data-silk-node]', { hasText: 'Guild' })).toBeVisible();

  await gm.evaluate(() => foundry.applications.instances.get('silk-canvas')?.attachWindow());
  await expect(gm.locator('[data-silk-canvas]')).toBeVisible();
  await expect.poll(() => savedDetached(gm)).toBe(false);
});
