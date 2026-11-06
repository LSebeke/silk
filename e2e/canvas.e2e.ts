import type { Locator, Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test, waitForSilk } from './fixtures';

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
    // These tests work with Ghosts (immediate Materialize is materialize.e2e).
    await game.settings?.set('silk', 'materializeMode', 'onDemand');
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
  expect(created?.data).toMatchObject({
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
  await waitForSilk(gm);
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

const connections = (page: Page): Promise<CanonRecord[]> =>
  page.evaluate(() => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records();
    return [...(records?.values() ?? [])].filter((r) => r.kind === 'connection');
  });

/** Right-button drag in screen px; `onTheWay` runs mid-drag. */
async function rightDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  onTheWay?: () => Promise<void>,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await onTheWay?.();
  await page.mouse.up({ button: 'right' });
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test('right-drag (spec 1.1 §A): connect, create from/onto a Node, menu, never pans', async ({
  gm,
}) => {
  await resetCanvas(gm);
  const run = <T>(name: string, args: object) => api(gm, name, args) as Promise<T>;
  const { id: alrik } = await run<{ id: string }>('element.create', {
    class: 'person',
    name: 'Alrik',
    at: { x: 200, y: 200 },
  });
  const { id: tavern } = await run<{ id: string }>('element.create', {
    class: 'location',
    name: 'Tavern',
    at: { x: 700, y: 200 },
  });
  await openCanvas(gm);
  const card = (name: string) => gm.locator('[data-silk-node]', { hasText: name });
  await expect(card('Tavern')).toBeVisible();
  // No Connection Points: edges float.
  await expect(gm.locator('[data-silk-point]')).toHaveCount(0);
  const pane = await boxOf(gm.locator('[data-silk-canvas] .svelte-flow__pane'));
  const before = await viewportTransform(gm);

  // Node A → Node B, Shift at release: incoming (Tavern → Alrik); rubber band + highlight.
  await rightDrag(
    gm,
    center(await boxOf(card('Alrik'))),
    center(await boxOf(card('Tavern'))),
    async () => {
      await expect(gm.locator('[data-silk-rubber-band]')).toBeVisible();
      await expect(card('Tavern')).toHaveClass(/silk-drop-target/);
      await gm.keyboard.down('Shift');
    },
  );
  await gm.keyboard.up('Shift');
  await expect(gm.locator('[data-silk-rubber-band]')).toHaveCount(0);
  await expect(card('Tavern')).not.toHaveClass(/silk-drop-target/);
  await expect.poll(async () => (await connections(gm)).length).toBe(1);
  expect((await connections(gm))[0]?.data).toMatchObject({ from: tavern, to: alrik });
  await expect(gm.locator('[data-silk-label-input]')).toBeFocused();
  await gm.keyboard.press('Escape');

  // canvas → canvas: standalone class box at the press point; right-drag never pans.
  await rightDrag(gm, { x: pane.x + 300, y: pane.y + 600 }, { x: pane.x + 500, y: pane.y + 700 });
  expect(await viewportTransform(gm)).toBe(before);
  await gm.locator('[data-silk-class-option="note"]').click();
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.type('Loose');
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-label-input]')).toHaveCount(0);
  await expect
    .poll(
      async () => (await elements(gm)).find((r) => r.data['name'] === 'Loose')?.data['position'],
    )
    .toEqual({ x: 300, y: 600 });
  expect(await connections(gm)).toHaveLength(1);

  // canvas → Node B: new element at the press point, connected new → B.
  await rightDrag(gm, { x: pane.x + 700, y: pane.y + 600 }, center(await boxOf(card('Tavern'))));
  await gm.locator('[data-silk-class-option="note"]').click();
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.type('Rumour');
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-label-input]')).toBeFocused();
  await gm.keyboard.press('Escape');
  const rumour = (await elements(gm)).find((r) => r.data['name'] === 'Rumour');
  expect(rumour?.data['position']).toEqual({ x: 700, y: 600 });
  await expect.poll(async () => (await connections(gm)).length).toBe(2);
  expect((await connections(gm)).map((c) => c.data)).toContainEqual(
    expect.objectContaining({ from: rumour?.id, to: tavern }),
  );

  // Node A → Node A: the Node context menu.
  await card('Alrik').click({ button: 'right' });
  await expect(gm.locator(`[data-silk-menu="${alrik}"]`)).toBeVisible();
  await gm.keyboard.press('Escape');
  await expect(gm.locator('[data-silk-menu]')).toHaveCount(0);
  expect(await viewportTransform(gm)).toBe(before);
});

test('Source Step (spec 1.1 §B.1): compass after Person/Creature, greyed choices inert, Blank', async ({
  gm,
}) => {
  await resetCanvas(gm);
  await openCanvas(gm);
  const pane = gm.locator('[data-silk-canvas] .svelte-flow__pane');
  const compass = gm.locator('[data-silk-source-step]');
  const choice = (kind: string) => gm.locator(`[data-silk-source-choice="${kind}"]`);

  // Class box → Creature → compass; Generator not offered, Compendium not yet available.
  await pane.click({ button: 'right', position: { x: 300, y: 200 } });
  await gm.locator('[data-silk-class-option="creature"]').click();
  await expect(compass).toBeFocused();
  await expect(compass).toHaveAttribute('data-silk-source-step', 'creature');
  await expect(choice('generator')).toHaveAttribute('aria-disabled', 'true');
  await expect(choice('generator')).toHaveAttribute('title', /.+/);
  await expect(choice('compendium')).toHaveAttribute('aria-disabled', 'true');
  await expect(choice('blank')).toHaveAttribute('aria-disabled', 'false');

  // Greyed: arrow and click do nothing.
  await gm.keyboard.press('ArrowUp');
  await gm.keyboard.press('ArrowLeft');
  await choice('generator').click({ force: true });
  await expect(compass).toBeVisible();
  expect(await elements(gm)).toHaveLength(0);

  // Esc cancels the creation; nothing is created.
  await gm.keyboard.press('Escape');
  await expect(compass).toHaveCount(0);
  expect(await elements(gm)).toHaveLength(0);

  // Digit key → compass; ↓ cancels too.
  await gm.locator('[data-silk-canvas]').focus();
  await gm.keyboard.press('Digit1');
  await expect(compass).toHaveAttribute('data-silk-source-step', 'person');
  await gm.keyboard.press('ArrowDown');
  await expect(compass).toHaveCount(0);

  // Mouse: Blank → the name step, default name selected.
  await gm.keyboard.press('Digit2');
  await choice('blank').click();
  const nameInput = gm.locator('[data-silk-name-input]');
  await expect(nameInput).toBeFocused();
  await gm.keyboard.type('Wolf');
  await gm.keyboard.press('Enter');
  await expect(nameInput).toHaveCount(0);
  const [wolf] = await elements(gm);
  expect(wolf?.data).toMatchObject({ class: 'creature', name: 'Wolf' });
  expect(wolf?.data['source']).toBeUndefined();
});
