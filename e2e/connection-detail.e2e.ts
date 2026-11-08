/**
 * Connection Detail against real Foundry (v1.1 §F.2): opened by double-click on the edge and
 * on its label, the edge menu and Element Detail; label, type, direction, Reverse, Notes and
 * Delete write through commands.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const record = (page: Page, id: string) =>
  page.evaluate(
    (i) =>
      game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data as
        Record<string, unknown> | undefined,
    id,
  );

async function reset(page: Page) {
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

const closeDetail = (page: Page, id: string) =>
  page.evaluate(
    (i) => foundry.applications.instances.get(`silk-connection-detail-${i}`)?.close(),
    id,
  );

async function setup(gm: Page) {
  await reset(gm);
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
  return { a, b, id };
}

test('Connection Detail opens by double-click on edge and label, menu, Element Detail', async ({
  gm,
}) => {
  const { a, b, id } = await setup(gm);
  await closePopups(gm);
  await api(gm, 'canvas.open');
  const label = gm.locator(`[data-silk-edge="${id}"]`);
  const path = gm.locator(`.svelte-flow__edge[data-id="${id}"] .svelte-flow__edge-path`);
  const detail = gm.locator(`[data-silk-connection-detail="${id}"]`);
  await expect.poll(async () => (await path.boundingBox())?.width ?? 0).toBeGreaterThan(300);
  const l = await label.boundingBox();
  const p = await path.boundingBox();
  if (!l || !p) throw new Error('not rendered');

  // The edge, away from the label. (A press must not hide the edges: Detail drop, §10.2.)
  await gm.mouse.dblclick(l.x - 80, p.y + p.height / 2);
  await expect(detail).toBeVisible();
  await expect(detail.locator('h2')).toHaveText('Alrik loves Rondra');
  await closeDetail(gm, id);
  await expect(detail).toHaveCount(0);

  // The label (xyflow's label portal).
  await gm.mouse.dblclick(l.x + l.width / 2, l.y + l.height / 2);
  await expect(detail).toBeVisible();
  await closeDetail(gm, id);

  // The edge menu's Open details.
  await label.click({ button: 'right' });
  await gm
    .locator(`[data-silk-menu="${id}"] [data-silk-menu-item="connection.openDetail"]`)
    .click();
  await expect(detail).toBeVisible();
  await closeDetail(gm, id);

  // The edit button beside the Connection in Element Detail.
  await api(gm, 'element.openDetail', { id: a });
  await gm.locator(`[data-silk-detail-connection-open="${id}"]`).click();
  await expect(detail).toBeVisible();

  // An endpoint opens its Element Detail.
  await detail.locator('[data-silk-connection-detail-end="to"]').click();
  await expect(gm.locator(`[data-silk-detail="${b}"]`)).toBeVisible();
});

test('Connection Detail edits label, direction, Reverse, Notes; Delete confirms', async ({
  gm,
}) => {
  const { a, b, id } = await setup(gm);
  await closePopups(gm);
  await api(gm, 'connection.openDetail', { id });
  const detail = gm.locator(`[data-silk-connection-detail="${id}"]`);
  await expect(detail).toBeVisible();

  const field = detail.locator('[data-silk-connection-detail-label]');
  await field.fill('trusts');
  await field.press('Enter');
  await expect.poll(async () => (await record(gm, id))?.['label']).toBe('trusts');
  // Esc reverts without saving and keeps the window open.
  await field.fill('hates');
  await field.press('Escape');
  await expect(field).toHaveValue('trusts');
  await expect(detail).toBeVisible();
  expect((await record(gm, id))?.['label']).toBe('trusts');

  await detail.locator('[data-silk-connection-detail-reverse]').click();
  await expect.poll(async () => (await record(gm, id))?.['from']).toBe(b);
  await detail.locator('[data-silk-connection-detail-direction]').selectOption('mutual');
  await expect.poll(async () => (await record(gm, id))?.['direction']).toBe('mutual');
  await expect(detail.locator('h2')).toContainText('and');

  // Notes: Foundry's ProseMirror editor is mounted; the command stores HTML.
  await expect(detail.locator('[data-silk-connection-detail-notes] prose-mirror')).toHaveCount(1);
  await api(gm, 'connection.setNotes', { id, notes: '<p>Owes him money</p>' });
  await expect(detail.locator('[data-silk-connection-detail-notes]')).toContainText(
    'Owes him money',
  );

  await detail.locator('[data-silk-connection-detail-delete]').click();
  await gm.locator('.application.dialog button[data-action="yes"]').click();
  await expect.poll(() => record(gm, id)).toBeUndefined();
  await expect(detail).toHaveCount(0);
  expect(await record(gm, a)).toBeDefined();
});

/** Scrolling elements inside a detail window other than its body (v1.1 §G.1: none). */
const nestedScrollers = (detail: Locator) =>
  detail.evaluate((root) => {
    const body = root.querySelector('[data-silk-detail-body]');
    return [...root.querySelectorAll('*')]
      .filter(
        (el) =>
          el !== body &&
          el.scrollHeight > el.clientHeight + 1 &&
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowY),
      )
      .map((el) => el.className);
  });

test('Notes grow with their content; the pencil is always visible (v1.1 §G.1)', async ({ gm }) => {
  const { id } = await setup(gm);
  await closePopups(gm);
  const long = Array.from({ length: 40 }, (_, i) => `<p>Line ${i}</p>`).join('');
  await api(gm, 'connection.setNotes', { id, notes: long });
  await api(gm, 'connection.openDetail', { id });
  const detail = gm.locator(`[data-silk-connection-detail="${id}"]`);
  const notes = detail.locator('[data-silk-connection-detail-notes]');
  await expect(notes).toContainText('Line 39');

  // Read-only: as tall as the text, no inner scroll.
  const tall = (el: Element) => el.scrollHeight <= el.clientHeight + 1 && el.clientHeight > 300;
  expect(await nestedScrollers(detail)).toEqual([]);
  expect(await notes.locator('.editor-content').evaluate(tall)).toBe(true);

  // The pencil shows without hover and opens the editor, which grows too.
  await gm.mouse.move(0, 0);
  const pencil = notes.locator('prose-mirror button.toggle');
  await expect(pencil).toBeVisible();
  await pencil.click();
  await expect(notes.locator('.ProseMirror')).toBeVisible();
  expect(await nestedScrollers(detail)).toEqual([]);
  expect(await notes.locator('.ProseMirror').evaluate(tall)).toBe(true);
});
