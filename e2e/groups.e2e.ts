import type { Locator, Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [name, args] as const);

const record = (page: Page, id: string): Promise<CanonRecord | undefined> =>
  page.evaluate((i) => game.modules?.get('garn')?.session?.().workingCopy.get(i), id);

const groups = (page: Page): Promise<CanonRecord[]> =>
  page.evaluate(() => {
    const records = game.modules?.get('garn')?.session?.().workingCopy.records();
    return [...(records?.values() ?? [])].filter((r) => r.kind === 'layoutGroup');
  });

/** Fresh working copy with `records`, a 1:1 view at the origin, the canvas open. */
async function openWith(page: Page, records: CanonRecord[]) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('garn')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async (json: string) => {
    // dsa5 popups, dialogs and Foundry's welcome tour swallow pointer input.
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout, .didYouKnow'))
      el.remove();
    await foundry.applications.instances.get('garn-canvas')?.close();
    const wc = game.modules?.get('garn')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await wc?.set(JSON.parse(json));
    await game.settings?.set('garn', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  }, JSON.stringify(records));
  await api(page, 'canvas.open');
  await expect(page.locator('[data-garn-canvas]')).toBeVisible();
}

const el = (id: string, name: string, x: number, y: number): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: 'person', name, position: { x, y } },
});
const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type: 'free', direction: 'directed', label: '' },
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
  // ~25 UI steps at 2-9 s each under load: the config's 120 s, not less.
  await openWith(gm, [
    el('ga', 'Alrik', 100, 100),
    el('gb', 'Boron', 400, 150),
    el('gc', 'Cella', 900, 500),
  ]);
  const canvas = gm.locator('[data-garn-canvas]');

  await api(gm, 'canvas.select', { ids: ['ga', 'gb'] });
  await expect(gm.locator('[data-garn-selection-toolbar]')).toBeVisible();
  await canvas.focus();
  await gm.keyboard.press('g');

  const frame = gm.locator('[data-garn-group]');
  await expect(frame).toHaveCount(1);
  const [created] = await groups(gm);
  const groupId = created?.id ?? '';
  expect(created?.data).toMatchObject({
    parent: null,
    position: { x: 70, y: 30 },
    // Measured cards (spec 1.1 §E.1): a short name is 78 px high.
    size: { width: 550, height: 228 },
  });
  expect((await record(gm, 'ga'))?.data['group']).toBe(groupId);
  // The frame is drawn where the record says (zoom 1, view at the origin).
  const pane = await boxOf(gm.locator('[data-garn-canvas] .svelte-flow__pane'));
  const fb = await boxOf(frame);
  expect(Math.round(fb.x - pane.x)).toBe(70);
  expect(Math.round(fb.width)).toBe(550);

  // Rename: double-click the title.
  await gm.locator('[data-garn-group-label]').dblclick();
  const input = gm.locator('[data-garn-group-label-input]');
  await expect(input).toBeFocused();
  await gm.keyboard.type('Gareth');
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-garn-group-label]')).toHaveText('Gareth');
  expect((await record(gm, groupId))?.data['label']).toBe('Gareth');

  // Drop Cella into the frame: she joins it.
  await api(gm, 'canvas.select', { ids: [] });
  await drag(gm, gm.locator('[data-garn-node="gc"]'), -500, -350);
  await expect.poll(async () => (await record(gm, 'gc'))?.data['group']).toBe(groupId);

  // Drag the frame by its title: contents move along.
  const before = await position(gm, 'ga');
  await drag(gm, gm.locator('[data-garn-group-label]'), 100, 60);
  await expect
    .poll(async () => {
      const p = await position(gm, 'ga');
      return p && before && p.x - before.x > 80 && p.y - before.y > 40;
    })
    .toBe(true);
  expect((await record(gm, 'ga'))?.data['group']).toBe(groupId);

  // Dissolve.
  await frame.hover();
  await gm.locator(`[data-garn-ungroup="${groupId}"]`).click();
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
  await expect(gm.locator('[data-garn-group]')).toHaveCount(2);
  expect((await record(gm, inner.id))?.data['parent']).toBe(outer.id);
  // Move Alrik onto Boron's spot in the inner frame.
  const target = await boxOf(gm.locator('[data-garn-node="nb"]'));
  const source = await boxOf(gm.locator('[data-garn-node="na"]'));
  await drag(
    gm,
    gm.locator('[data-garn-node="na"]'),
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
  const canvas = gm.locator('[data-garn-canvas]');
  await api(gm, 'canvas.select', { ids: ['ua', 'ub', 'uc'] });
  await expect(gm.locator('[data-garn-action="untangle"]')).toBeVisible();
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
  const pane = await boxOf(gm.locator('[data-garn-canvas] .svelte-flow__pane'));
  await expect
    .poll(async () => {
      const box = await boxOf(gm.locator('[data-garn-node="ub"]'));
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

test('cards (spec 1.1 §E.1): long names wrap, the card grows; frames and Untangle fit it', async ({
  gm,
}) => {
  const long = 'Alrik Sohn des Brodomir vom Hohen Kamm zu Gareth und Weiden';
  await openWith(gm, [
    el('wa', 'Boron', 100, 100),
    el('wb', long, 600, 100),
    el('wc', `${long} II`, 600, 120),
    link('wab', 'wa', 'wb'),
    link('wac', 'wa', 'wc'),
  ]);
  const card = gm.locator('[data-garn-node="wb"]');
  const title = card.locator('[data-garn-node-title]');
  // No ellipsis: the whole name on several lines; same width, taller than a short card.
  await expect(title).toHaveCSS('white-space', 'normal');
  const [tb, cb, sb] = [
    await boxOf(title),
    await boxOf(card),
    await boxOf(gm.locator('[data-garn-node="wa"]')),
  ];
  expect(tb.height).toBeGreaterThan(40);
  expect(cb.width).toBe(sb.width);
  expect(cb.height).toBeGreaterThan(sb.height + 20);
  // One control row under the name: eye, then pin, at the right.
  const [eye, pin] = [
    await boxOf(card.locator('[data-garn-eye]')),
    await boxOf(card.locator('[data-garn-pin]')),
  ];
  expect(eye.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1);
  expect(pin.x).toBeGreaterThan(eye.x);
  expect(Math.abs(pin.y - eye.y)).toBeLessThan(4);

  // The frame holds the measured card (zoom 1: screen px = canvas units): 30 px below, 70 above.
  await api(gm, 'canvas.group', { ids: ['wb'] });
  const [frame] = await groups(gm);
  const size = frame?.data['size'] as { width: number; height: number };
  expect(size.height).toBeGreaterThanOrEqual(Math.floor(cb.height) + 100);

  // Untangle: wb and wc share a rank and stack without overlapping.
  await api(gm, 'canvas.untangle', { ids: ['wa', 'wb', 'wc'] });
  await expect
    .poll(async () => {
      const [b, c] = [await position(gm, 'wb'), await position(gm, 'wc')];
      return !!b && !!c && Math.abs(b.y - c.y) >= cb.height;
    })
    .toBe(true);
});
