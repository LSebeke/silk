/**
 * Info Block editing in Element Detail against real Foundry (v1.1 §C.1): Add Info Block…
 * from the Node menu, inline rename, ProseMirror text, drag reorder, delete with confirm,
 * open in Foundry.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function ready(page: Page) {
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
    await game.settings?.set('silk', 'materializeMode', 'immediate');
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

/** The journal's Info Block-ish text pages, in sort order. */
const pages = (page: Page, id: string) =>
  page.evaluate((i) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
    const journal = fromUuidSync(uuid as string) as any;
    return [...journal.pages.contents]
      .sort((a: any, b: any) => a.sort - b.sort)
      .map((p: any) => `${p.name}:${p.text?.content ?? ''}`);
  }, id);

test('Info Blocks: add from the Node menu, rename, edit text, reorder, delete, open', async ({
  gm,
}) => {
  test.setTimeout(180_000);
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'location',
    name: 'Hafen',
    at: { x: 200, y: 200 },
  });
  await closePopups(gm);
  await api(gm, 'canvas.open');

  // Node context menu: Add Info Block… opens Element Detail, new name field focused.
  await gm
    .locator('[data-silk-node]', { hasText: 'Hafen' })
    .locator('.portrait')
    .click({ button: 'right' });
  await gm.locator('[data-silk-menu-item="element.openDetail.addInfoBlock"]').click();
  const detail = gm.locator(`[data-silk-detail="${id}"]`);
  const names = detail.locator('[data-silk-detail-block-name]');
  await expect(names).toHaveCount(3);
  await expect(names.nth(2)).toBeFocused();
  await gm.keyboard.type('Gerüchte');
  await gm.keyboard.press('Enter');
  await expect
    .poll(() => pages(gm, id))
    .toEqual(['Cover:', 'Description:', 'Secrets:', 'Gerüchte:', 'Connections:']);

  // ProseMirror text → infoBlock.edit.
  const blockIds = await names.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-silk-detail-block-name') as string),
  );
  const [description, secrets, rumours] = blockIds as [string, string, string];
  const text = detail.locator(`[data-silk-detail-block-text="${description}"]`);
  await text.locator('prose-mirror').hover();
  await text.locator('prose-mirror button.toggle').click();
  await text.locator('.ProseMirror').click();
  await gm.keyboard.type('Salzig');
  await gm.keyboard.press('Control+s');
  await expect.poll(() => pages(gm, id)).toContain('Description:<p>Salzig</p>');
  await expect(text.locator('prose-mirror')).toContainText('Salzig');

  // Drag the new block to the top: only Info Blocks move.
  await detail
    .locator(`[data-silk-detail-block-handle="${rumours}"]`)
    .dragTo(detail.locator(`[data-silk-detail-block="${description}"]`));
  await expect
    .poll(() => pages(gm, id))
    .toEqual(['Cover:', 'Gerüchte:', 'Description:<p>Salzig</p>', 'Secrets:', 'Connections:']);

  // Delete with confirmation.
  await detail.locator(`[data-silk-detail-block-delete="${secrets}"]`).click();
  await gm.locator('.application.dialog button[data-action="yes"]').click();
  await expect(names).toHaveCount(2);
  expect(await pages(gm, id)).not.toContain('Secrets:');

  // Open in Foundry: the journal sheet at that page.
  await detail.locator(`[data-silk-detail-block-open="${rumours}"]`).click();
  await expect
    .poll(() =>
      gm.evaluate((i) => {
        const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
        const sheet = (fromUuidSync(uuid as string) as any)?.sheet;
        return sheet?.rendered ? sheet.pageId : null;
      }, id),
    )
    .toBe(rumours);
});
