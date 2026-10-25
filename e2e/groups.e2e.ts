import type { Locator, Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [name, args] as const);

const record = (page: Page, id: string): Promise<CanonRecord | undefined> =>
  page.evaluate((i) => game.modules?.get('silk')?.session?.().workingCopy.get(i), id);

const groups = (page: Page): Promise<CanonRecord[]> =>
  page.evaluate(() => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records();
    return [...(records?.values() ?? [])].filter((r) => r.kind === 'layoutGroup');
  });

/** Fresh working copy with `records`, a 1:1 view at the origin, the canvas open. */
async function openWith(page: Page, records: CanonRecord[]) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async (rs) => {
    // dsa5 popups, dialogs and Foundry's welcome tour swallow pointer input.
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout, .didYouKnow'))
      el.remove();
    await foundry.applications.instances.get('silk-canvas')?.close();
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await wc?.set(rs);
    await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  }, records);
  await api(page, 'canvas.open');
  await expect(page.locator('[data-silk-canvas]')).toBeVisible();
}

const el = (id: string, name: string, x: number, y: number): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: 'person', name, position: { x, y } },
});
const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to },
});

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return box;
}

async function drag(page: Page, locator: Locator, dx: number, dy: number) {
  const box = await boxOf(locator);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + dx / 2, box.y + 20 + dy / 2, { steps: 5 });
  await page.mouse.move(box.x + 20 + dx, box.y + 20 + dy, { steps: 5 });
  await page.mouse.up();
}

const position = async (page: Page, id: string) =>
  (await record(page, id))?.data['position'] as { x: number; y: number } | undefined;

test('GM groups with g, renames, drops a Node in, moves and dissolves the frame', async ({
  gm,
}) => {
  test.setTimeout(90_000);
  await openWith(gm, [
    el('ga', 'Alrik', 100, 100),
    el('gb', 'Boron', 400, 150),
    el('gc', 'Cella', 900, 500),
  ]);
  const canvas = gm.locator('[data-silk-canvas]');

  await api(gm, 'canvas.select', { ids: ['ga', 'gb'] });
  await expect(gm.locator('[data-silk-selection-toolbar]')).toBeVisible();
  await canvas.focus();
  await gm.keyboard.press('g');

  const frame = gm.locator('[data-silk-group]');
  await expect(frame).toHaveCount(1);
  const [created] = await groups(gm);
  const groupId = created?.id ?? '';
  expect(created?.data).toMatchObject({
    parent: null,
    position: { x: 70, y: 30 },
    size: { width: 550, height: 230 },
  });
  expect((await record(gm, 'ga'))?.data['group']).toBe(groupId);
  // The frame is drawn where the record says (zoom 1, view at the origin).
  const pane = await boxOf(gm.locator('[data-silk-canvas] .svelte-flow__pane'));
  const fb = await boxOf(frame);
  expect(Math.round(fb.x - pane.x)).toBe(70);
  expect(Math.round(fb.width)).toBe(550);

  // Rename: double-click the title.
  await gm.locator('[data-silk-group-label]').dblclick();
  const input = gm.locator('[data-silk-group-label-input]');
  await expect(input).toBeFocused();
  await gm.keyboard.type('Gareth');
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-group-label]')).toHaveText('Gareth');
  expect((await record(gm, groupId))?.data['label']).toBe('Gareth');

  // Drop Cella into the frame: she joins it.
  await api(gm, 'canvas.select', { ids: [] });
  await drag(gm, gm.locator('[data-silk-node="gc"]'), -500, -350);
  await expect.poll(async () => (await record(gm, 'gc'))?.data['group']).toBe(groupId);

  // Drag the frame by its title: contents move along.
  const before = await position(gm, 'ga');
  await drag(gm, gm.locator('[data-silk-group-label]'), 100, 60);
  await expect
    .poll(async () => {
      const p = await position(gm, 'ga');
      return p && before && p.x - before.x > 80 && p.y - before.y > 40;
    })
    .toBe(true);
  expect((await record(gm, 'ga'))?.data['group']).toBe(groupId);

  // Dissolve.
  await frame.hover();
  await gm.locator(`[data-silk-ungroup="${groupId}"]`).click();
  await expect(frame).toHaveCount(0);
  expect((await record(gm, 'ga'))?.data).not.toHaveProperty('group');
});

test('nested frames: grouping inside a frame nests; a Node drops into the innermost', async ({
  gm,
}) => {
  await openWith(gm, [el('na', 'Alrik', 100, 100), el('nb', 'Boron', 400, 100)]);
  const outer = (await api(gm, 'canvas.group', { ids: ['na', 'nb'], label: 'Town' })) as {
    id: string;
  };
  const inner = (await api(gm, 'canvas.group', { ids: ['nb'], label: 'Inn' })) as { id: string };
  await expect(gm.locator('[data-silk-group]')).toHaveCount(2);
  expect((await record(gm, inner.id))?.data['parent']).toBe(outer.id);
  // Move Alrik onto Boron's spot in the inner frame.
  const target = await boxOf(gm.locator('[data-silk-node="nb"]'));
  const source = await boxOf(gm.locator('[data-silk-node="na"]'));
  await drag(
    gm,
    gm.locator('[data-silk-node="na"]'),
    target.x - source.x,
    target.y - source.y + 20,
  );
  await expect.poll(async () => (await record(gm, 'na'))?.data['group']).toBe(inner.id);
});

test('u untangles the selection left to right in one tween; Ctrl+Z undoes it', async ({ gm }) => {
  await openWith(gm, [
    el('ua', 'Alrik', 600, 400),
    el('ub', 'Boron', 100, 100),
    el('uc', 'Cella', 300, 600),
    el('ud', 'Darpatia', 1000, 100),
    link('uab', 'ua', 'ub'),
    link('ubc', 'ub', 'uc'),
    link('ucd', 'uc', 'ud'),
  ]);
  const canvas = gm.locator('[data-silk-canvas]');
  await api(gm, 'canvas.select', { ids: ['ua', 'ub', 'uc'] });
  await expect(gm.locator('[data-silk-action="untangle"]')).toBeVisible();
  const startedAt = await gm.evaluate(() => performance.now());
  await canvas.focus();
  await gm.keyboard.press('u');

  await expect
    .poll(async () => {
      const [a, b, c] = await Promise.all(['ua', 'ub', 'uc'].map((id) => position(gm, id)));
      return !!a && !!b && !!c && a.x < b.x && b.x < c.x && a.y === b.y && b.y === c.y;
    })
    .toBe(true);
  // The card animates: right after the write it is not yet at its new spot.
  const ub = await position(gm, 'ub');
  const pane = await boxOf(gm.locator('[data-silk-canvas] .svelte-flow__pane'));
  await expect
    .poll(async () => {
      const box = await boxOf(gm.locator('[data-silk-node="ub"]'));
      return Math.round(box.x - pane.x) === Math.round(ub?.x ?? NaN);
    })
    .toBe(true);
  const took = (await gm.evaluate(() => performance.now())) - startedAt;
  expect(took).toBeGreaterThan(400);
  expect(await position(gm, 'ud')).toEqual({ x: 1000, y: 100 });

  await canvas.focus();
  await gm.keyboard.press('Control+z');
  await expect.poll(() => position(gm, 'ua')).toEqual({ x: 600, y: 400 });
  expect(await position(gm, 'ub')).toEqual({ x: 100, y: 100 });
  expect(await position(gm, 'uc')).toEqual({ x: 300, y: 600 });
});
