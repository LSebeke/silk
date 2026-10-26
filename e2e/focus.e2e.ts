import type { Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [name, args] as const);

/** Fresh working copy with `records`, no filters or pins, the canvas open. */
async function openWith(page: Page, records: CanonRecord[]) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async (json) => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout, .didYouKnow'))
      el.remove();
    ui.notifications?.clear();
    document.getElementById('notifications')?.style.setProperty('display', 'none');
    await foundry.applications.instances.get('silk-canvas')?.close();
    while (foundry.applications.instances.get('silk-canvas'))
      await new Promise((r) => setTimeout(r, 20));
    await game.settings?.set('silk', 'materializeMode', 'onDemand');
    for (const s of [...(game.scenes ?? [])])
      if ((s.flags as { silk?: { focusTest?: boolean } }).silk?.focusTest) await s.delete();
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await wc?.set(JSON.parse(json));
    await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  }, JSON.stringify(records));
  await api(page, 'canvas.open');
  await expect(page.locator('[data-silk-canvas]')).toBeVisible();
}

const el = (id: string, x: number, y = 100, cls = 'person'): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: cls, name: id, position: { x, y } },
});
const link = (id: string, from: string, to: string): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type: 'free', direction: 'directed', label: '' },
});

// Chain loc — qa — qb — qc and qx alone, far from the origin; qf/qg further off.
const WEB = [
  el('qloc', 3000, 100, 'location'),
  el('qa', 3250),
  el('qb', 3500),
  el('qc', 3750),
  el('qx', 3250, 350),
  el('qf', 20000, 8000),
  el('qg', -20000, -8000),
  link('q1', 'qloc', 'qa'),
  link('q2', 'qa', 'qb'),
  link('q3', 'qb', 'qc'),
];

const shown = (page: Page) =>
  page
    .locator('[data-silk-node]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['silkNode']).sort());
const camera = (page: Page) =>
  page.locator('.svelte-flow__viewport').evaluate((e) => (e as HTMLElement).style.transform);

test('Focus View: Scene seeds, selection, pins, hops, camera', async ({ gm }) => {
  test.setTimeout(180_000);
  await openWith(gm, WEB);
  await expect(gm.locator('[data-silk-node]')).toHaveCount(7);

  // On with no active Scene and nothing selected: only pins show, plus a hint.
  await gm.locator('[data-silk-action="focus-toggle"]').click();
  await expect(gm.locator('[data-silk-node]')).toHaveCount(0);
  await expect(gm.locator('[data-silk-focus-hint]')).toBeVisible();
  await api(gm, 'focus.pin', { ids: ['qx'] });
  await expect.poll(() => shown(gm)).toEqual(['qx']);

  // A Scene linked to qloc becomes active: N = 2 hops around it, and the camera fits.
  const before = await camera(gm);
  await gm.evaluate(async () => {
    const data = { name: 'Focus test', flags: { silk: { sceneOf: 'qloc', focusTest: true } } };
    const scene = (await Scene.create(data as never)) as
      { activate(): Promise<unknown> } | undefined;
    await scene?.activate();
  });
  await expect.poll(() => shown(gm)).toEqual(['qa', 'qb', 'qloc', 'qx']);
  await expect(gm.locator('[data-silk-focus-hint]')).toHaveCount(0);
  await expect.poll(() => camera(gm)).not.toBe(before);

  // N from the chip bar.
  await gm.locator('[data-silk-focus-hops]').selectOption('1');
  await expect.poll(() => shown(gm)).toEqual(['qa', 'qloc', 'qx']);

  // Selection is a temporary seed: selecting qa shows qb; deselecting collapses it.
  await gm.locator('[data-silk-node="qa"]').click();
  await expect.poll(() => shown(gm)).toEqual(['qa', 'qb', 'qloc', 'qx']);

  // `p` pins the selection; the card's Focus Pin button unpins.
  await gm.locator('[data-silk-canvas]').press('p');
  await expect(gm.locator('[data-silk-node="qa"] [data-silk-pin="pinned"]')).toHaveCount(1);
  await gm.locator('[data-silk-node="qa"] .pin').click();
  await expect(gm.locator('[data-silk-node="qa"] [data-silk-pin="pinned"]')).toHaveCount(0);
  await api(gm, 'canvas.select', { ids: [] });
  await expect.poll(() => shown(gm)).toEqual(['qa', 'qloc', 'qx']);

  // Shift held: a pin far offscreen shows, but the camera holds (the move is dropped).
  await gm.waitForTimeout(800);
  const held = await camera(gm);
  await gm.keyboard.down('Shift');
  await api(gm, 'focus.pin', { ids: ['qf'] });
  await expect(gm.locator('[data-silk-node="qf"]')).toHaveCount(1);
  await gm.waitForTimeout(800);
  expect(await camera(gm)).toBe(held);
  await gm.keyboard.up('Shift');
  expect(await camera(gm)).toBe(held);

  // Without Shift an offscreen newly shown Node pans the camera.
  await api(gm, 'focus.pin', { ids: ['qg'] });
  await expect.poll(() => camera(gm)).not.toBe(held);

  // Pins persist in the view state.
  const pins = await gm.evaluate(
    () => (game.settings?.get('silk', 'viewState') as { pins?: string[] }).pins,
  );
  expect(pins).toEqual(['qx', 'qf', 'qg']);

  await api(gm, 'filter.clear');
  await api(gm, 'focus.unpin', { ids: ['qx', 'qf', 'qg'] });
  await gm.evaluate(async () => {
    for (const s of [...(game.scenes ?? [])])
      if ((s.flags as { silk?: { focusTest?: boolean } }).silk?.focusTest) await s.delete();
  });
});
