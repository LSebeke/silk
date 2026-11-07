import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function resetCanvas(page: Page) {
  await page.evaluate(async () => {
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  });
}

/** Raw mouse input skips Playwright's locator handlers: clear dsa5 popups and the tour first. */
async function closePopups(page: Page) {
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    document.getElementById('dsa5-patch-viewer')?.remove();
    for (const tip of document.querySelectorAll('.didYouKnow')) tip.remove();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout')) el.remove();
  });
}

/** A real right click (press, release): what a user does, not a synthetic `contextmenu`. */
async function rightClick(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
}

test('Edge menu (spec 1.1 §F.1): right-click on edge and label, entries', async ({ gm }) => {
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
  await closePopups(gm);
  await api(gm, 'canvas.open');
  const label = gm.locator(`[data-silk-edge="${id}"]`);
  const path = gm.locator(`.svelte-flow__edge[data-id="${id}"] .svelte-flow__edge-path`);
  const menu = gm.locator(`[data-silk-menu="${id}"]`);
  // The window opens with a scale animation: wait until the edge has its full length.
  await expect.poll(async () => (await path.boundingBox())?.width ?? 0).toBeGreaterThan(300);
  const l = await label.boundingBox();
  const p = await path.boundingBox();
  if (!l || !p) throw new Error('not rendered');
  const lineY = p.y + p.height / 2;
  const centre = { x: l.x + l.width / 2, y: l.y + l.height / 2 };

  // The edge, away from the label: on the line and 6 px either side (the ~16 px hit area).
  for (const dy of [0, -6, 6]) {
    await rightClick(gm, { x: l.x - 80, y: lineY + dy });
    await expect(menu, `edge, ${dy} px off`).toBeVisible();
    // Escape closes the menu, not the canvas window.
    await gm.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(label).toBeVisible();
  }

  // Well outside the hit area: the canvas, no edge menu.
  await rightClick(gm, { x: l.x - 80, y: lineY + 30 });
  await expect(menu).toHaveCount(0);
  await gm.keyboard.press('Escape');

  // The label; the entries of §F.1.
  await rightClick(gm, centre);
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-silk-menu-item]')).toHaveText([
    'Open details',
    'Reveal',
    'Edit Connection label',
    'Directed ⇄ Mutual',
    'Cycle Connection type',
    'Reverse direction',
    'Delete Connection',
  ]);
  // Connection Detail is T51: disabled until its command is registered.
  await expect(menu.locator('[data-silk-menu-item="connection.openDetail"]')).toBeDisabled();

  // An entry runs its command: Reverse direction swaps the endpoints.
  await menu.locator('[data-silk-menu-item="connection.flip"]').click();
  await expect(label).toHaveAttribute('data-silk-edge-from', b);
});
