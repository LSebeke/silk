import type { Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [name, args] as const);

const records = (page: Page, kind: string): Promise<CanonRecord[]> =>
  page.evaluate((k) => {
    const all = game.modules?.get('silk')?.session?.().workingCopy.records();
    return [...(all?.values() ?? [])].filter((r) => r.kind === k);
  }, kind);

/** Fresh working copy with `records`, no filters, popups gone, the canvas open. */
async function openWith(page: Page, list: CanonRecord[]) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.waitForTimeout(1500);
  await page.evaluate(async (json) => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    document.getElementById('dsa5-patch-viewer')?.remove();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout, .didYouKnow'))
      el.remove();
    ui.notifications?.clear();
    document.getElementById('notifications')?.style.setProperty('display', 'none');
    await foundry.applications.instances.get('silk-canvas')?.close();
    while (foundry.applications.instances.get('silk-canvas'))
      await new Promise((r) => setTimeout(r, 20));
    await game.settings?.set('silk', 'materializeMode', 'onDemand');
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await wc?.set(JSON.parse(json));
    await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  }, JSON.stringify(list));
  await api(page, 'canvas.open');
  await expect(page.locator('[data-silk-canvas]')).toBeVisible();
}

const el = (id: string, cls: string, name: string, x: number, extra = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: cls, name, position: { x, y: 100 }, ...extra },
});

const WEB = [
  el('sa', 'person', 'Alrik', 0, { tags: ['noble'] }),
  el('sb', 'person', 'Bosper', 250, { tags: ['noble'] }),
  el('ss', 'item', 'Sword of Rondra', 500, {
    infoBlocks: [{ _id: 'ib1', name: 'Lore', text: '<p>Forged in <b>Baliho</b> long ago</p>' }],
  }),
];

const card = (page: Page, id: string) => page.locator(`[data-silk-node="${id}"]`);

test('Search: Ctrl+F, result order, jump through filters, filtered marker', async ({ gm }) => {
  await openWith(gm, WEB);
  await api(gm, 'filter.set', { dimension: 'class', values: ['person'] });
  await expect(card(gm, 'ss')).toHaveCount(0);

  // Ctrl+F only while the canvas has focus.
  await gm.locator('body').focus();
  await gm.keyboard.press('Control+KeyF');
  await expect(gm.locator('[data-silk-search]')).toHaveCount(0);
  await gm.locator('[data-silk-canvas]').focus();
  await gm.keyboard.press('Control+KeyF');
  const input = gm.locator('[data-silk-search-input]');
  await expect(input).toBeFocused();

  // Tags expand into their elements; Info Block text is found; Connection labels are not.
  await input.fill('nob');
  await expect(gm.locator('[data-silk-search-tag]')).toHaveText('#noble');
  await expect(gm.locator('[data-silk-search-hit]')).toHaveCount(2);
  await input.fill('baliho');
  await expect(gm.locator('[data-silk-search-hit]')).toHaveText([/Sword of Rondra.*Lore: /]);

  // Jump to the filtered-out Sword: shown with a marker and selected, until deselected.
  await input.fill('sword');
  await expect(gm.locator('[data-silk-search-hit]').first()).toHaveAttribute(
    'data-silk-search-hit',
    'ss',
  );
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-search]')).toHaveCount(0);
  await expect(card(gm, 'ss')).toBeVisible();
  await expect(card(gm, 'ss').locator('[data-silk-filtered]')).toBeVisible();
  await expect(card(gm, 'sa').locator('[data-silk-filtered]')).toHaveCount(0);
  await api(gm, 'canvas.select', { ids: ['sa'] });
  await expect(card(gm, 'ss')).toHaveCount(0);
});

test('c: connect search to an existing Node, or "New Node" with direction + class', async ({
  gm,
}) => {
  await openWith(gm, WEB);
  await card(gm, 'sa').locator('.portrait').click();
  await gm.keyboard.press('KeyC');
  const input = gm.locator('[data-silk-search-input]');
  await expect(input).toBeFocused();
  await expect(gm.locator('[data-silk-search-new]')).toBeVisible();
  await input.fill('bos');
  await gm.keyboard.press('ArrowDown');
  await gm.keyboard.press('Enter');
  const label = gm.locator('[data-silk-label-input]');
  await expect(label).toBeFocused();
  await gm.keyboard.press('Escape');
  await expect
    .poll(async () => (await records(gm, 'connection')).map((c) => [c.data['from'], c.data['to']]))
    .toEqual([['sa', 'sb']]);

  // Default entry "New Node": direction (↓ = incoming), then the class box, name, label.
  await card(gm, 'sa').locator('.portrait').click();
  await gm.keyboard.press('KeyC');
  await expect(input).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-directions]')).toBeFocused();
  await gm.keyboard.press('ArrowDown');
  await expect(gm.locator('[data-silk-direction="in"]')).toHaveClass(/active/);
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-class-search]')).toBeFocused();
  await gm.locator('[data-silk-class-option="location"]').click();
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.type('Gareth');
  await gm.keyboard.press('Enter');
  await expect(label).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect
    .poll(async () => {
      const gareth = (await records(gm, 'element')).find((r) => r.data['name'] === 'Gareth');
      const c = (await records(gm, 'connection')).find((r) => r.data['to'] === 'sa');
      return !!gareth && c?.data['from'] === gareth.id;
    })
    .toBe(true);
});

test('Palette: drag a class onto the canvas or onto a Node; new filtered Node is marked', async ({
  gm,
}) => {
  await openWith(gm, WEB);
  await gm.locator('[data-silk-action="palette"]').click();
  const palette = gm.locator('[data-silk-palette]');
  await expect(palette).toBeVisible();
  // The palette filter uses Search's matcher.
  await gm.locator('[data-silk-palette-input]').fill('loca');
  await expect(gm.locator('[data-silk-palette-class]')).toHaveCount(1);
  await gm.locator('[data-silk-palette-input]').fill('');

  // Onto empty canvas: a standalone Node, then the name step.
  const pane = gm.locator('.svelte-flow__pane');
  await gm
    .locator('[data-silk-palette-class="location"]')
    .dragTo(pane, { targetPosition: { x: 300, y: 400 } });
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-node]')).toHaveCount(4);
  expect(await records(gm, 'connection')).toHaveLength(0);

  // Onto a Node: it highlights as the connect target; the new Node is connected to it.
  await gm.locator('[data-silk-palette-class="faction"]').hover();
  await gm.mouse.down();
  const target = await card(gm, 'sb').boundingBox();
  if (!target) throw new Error('Bosper not rendered');
  await gm.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await expect(card(gm, 'sb')).toHaveClass(/silk-drop-target/);
  await gm.mouse.up();
  await expect(card(gm, 'sb')).not.toHaveClass(/silk-drop-target/);
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-label-input]')).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect
    .poll(async () => (await records(gm, 'connection')).map((c) => c.data['from']))
    .toEqual(['sb']);

  // A new Node the filters would hide is shown, marked "filtered".
  await api(gm, 'filter.set', { dimension: 'class', values: ['item'] });
  await gm.locator('[data-silk-palette-class="quest"]').dragTo(pane, {
    targetPosition: { x: 100, y: 500 },
  });
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.press('Enter');
  const quest = gm.locator('[data-silk-class="quest"]');
  await expect(quest).toBeVisible();
  await expect(quest.locator('[data-silk-filtered]')).toBeVisible();
  await expect(card(gm, 'ss').locator('[data-silk-filtered]')).toHaveCount(0);
});
