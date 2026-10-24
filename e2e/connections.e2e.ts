import type { Locator, Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const records = (page: Page, kind: string): Promise<CanonRecord[]> =>
  page.evaluate((k) => {
    const all = game.modules?.get('silk')?.session?.().workingCopy.records();
    return [...(all?.values() ?? [])].filter((r) => r.kind === k);
  }, kind);

async function resetCanvas(page: Page) {
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

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return box;
}

const card = (page: Page, name: string) => page.locator('[data-silk-node]', { hasText: name });

test('Connections: drag-out, digit keys, c, editor, Tab/q, rendering', async ({ gm }) => {
  test.setTimeout(240_000);
  await resetCanvas(gm);
  const { id: alrik } = await api<{ id: string }>(gm, 'element.create', {
    class: 'person',
    name: 'Alrik',
    at: { x: 200, y: 200 },
  });
  await closePopups(gm);
  await api(gm, 'canvas.open');
  await expect(card(gm, 'Alrik')).toBeVisible();

  // Drag-out from the outgoing point on the right → class box → Item. Counting real
  // inputs: one drag gesture, one click: the connected Element exists (§14: ≤ 2).
  const out = card(gm, 'Alrik').locator('[data-silk-point="out"][data-silk-point-side="right"]');
  await expect(out).toBeVisible();
  const p = await boxOf(out);
  await gm.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await gm.mouse.down();
  await gm.mouse.move(p.x + 150, p.y + 40, { steps: 5 });
  await gm.mouse.move(p.x + 300, p.y + 80, { steps: 5 });
  await gm.mouse.up();
  await expect(gm.locator('[data-silk-class-box]')).toBeVisible();
  await gm.locator('[data-silk-class-option="item"]').click();
  await expect.poll(async () => (await records(gm, 'connection')).length).toBe(1);
  const [owns] = await records(gm, 'connection');
  expect(owns?.data).toMatchObject({ from: alrik, type: 'owns', direction: 'directed' });

  // Name, then the Connection editor (Behavioural: Enter closes it).
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.type('Sword');
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-connection-editor] button').first()).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-silk-connection-editor]')).toHaveCount(0);
  const ownsLabel = gm.locator(`[data-silk-edge="${owns?.id}"]`);
  await expect(ownsLabel).toHaveAttribute('data-silk-edge-type', 'owns');
  await expect(ownsLabel).toContainText('owns');
  // Directed: arrowhead on the edge path.
  await expect(
    gm.locator(`.svelte-flow__edge[data-id="${owns?.id}"] .svelte-flow__edge-path`),
  ).toHaveAttribute('marker-end', /url/);

  // Digit key on the selected Node: `1` creates a connected Person (free-form, outgoing).
  await card(gm, 'Alrik').click();
  await expect(card(gm, 'Alrik')).toHaveClass(/selected/);
  await gm.keyboard.press('Digit1');
  await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
  await gm.keyboard.type('Rondra');
  await gm.keyboard.press('Enter');
  const label = gm.locator('[data-silk-label-input]');
  await expect(label).toBeFocused();
  await gm.keyboard.type('loves');
  await gm.keyboard.press('Enter');
  await expect(label).toHaveCount(0);
  const loves = gm.locator('[data-silk-edge]', { hasText: 'loves' });
  await expect(loves).toHaveAttribute('data-silk-edge-from', alrik);
  await expect(loves).toHaveAttribute('data-silk-edge-direction', 'directed');

  // Tab cycles direction on the selected Connection through A→B, B→A, mutual.
  const lovesId = (await loves.getAttribute('data-silk-edge')) ?? '';
  const lovesPath = gm.locator(`.svelte-flow__edge[data-id="${lovesId}"] .svelte-flow__edge-path`);
  const state = async () =>
    `${await loves.getAttribute('data-silk-edge-direction')}:${await loves.getAttribute('data-silk-edge-from')}`;
  await loves.click();
  const seen = [await state()];
  for (let i = 0; i < 3; i++) {
    await gm.keyboard.press('Tab');
    await expect.poll(state).not.toBe(seen.at(-1));
    seen.push(await state());
    if (seen.at(-1)?.startsWith('mutual'))
      await expect(lovesPath).not.toHaveAttribute('marker-end', /url/);
  }
  expect(new Set(seen.slice(0, 3)).size).toBe(3);
  expect(seen.filter((s) => s.startsWith('mutual'))).toHaveLength(1);
  expect(seen[3]).toBe(seen[0]);

  // q cycles type: Person → Item has `owns`, so a free-form Connection becomes owns.
  // Use `c` to connect Rondra to the Sword, then q.
  await card(gm, 'Rondra').click();
  await gm.keyboard.press('KeyC');
  await expect(gm.locator('[data-silk-connect-hint]')).toBeVisible();
  await card(gm, 'Sword').click();
  await expect(gm.locator('[data-silk-label-input]')).toBeFocused();
  await gm.keyboard.press('Escape');
  const rondraSword = gm.locator('[data-silk-edge][data-silk-edge-type="free"]', {
    hasNotText: 'loves',
  });
  await expect(rondraSword).toHaveCount(1);
  await rondraSword.click();
  await gm.keyboard.press('KeyQ');
  // Rondra now owns the Sword; the old owner's Connection is replaced (≤1 owner).
  await expect(gm.locator('[data-silk-edge-type="owns"]')).toHaveCount(1);
  await expect(gm.locator(`[data-silk-edge="${owns?.id}"]`)).toHaveCount(0);

  // Parallel Connections between one pair: separate curves, separate labels.
  const rondra = (await records(gm, 'element')).find((r) => r.data['name'] === 'Rondra')?.id;
  await api(gm, 'connection.create', { from: alrik, to: rondra, label: 'fears' });
  const fears = gm.locator('[data-silk-edge]', { hasText: 'fears' });
  await expect(fears).toBeVisible();
  const a = await boxOf(fears);
  const b = await boxOf(loves);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);

  // F2 on a selected Connection opens its editor.
  await fears.click();
  await gm.keyboard.press('F2');
  await expect(gm.locator('[data-silk-label-input]')).toBeFocused();
  await gm.keyboard.press('Escape');
});
