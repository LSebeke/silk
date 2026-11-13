import type { Locator, Page } from '@playwright/test';
import type { CanonRecord } from '../src/core/canon';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const records = (page: Page, kind: string): Promise<CanonRecord[]> =>
  page.evaluate((k) => {
    const all = game.modules?.get('garn')?.session?.().workingCopy.records();
    return [...(all?.values() ?? [])].filter((r) => r.kind === k);
  }, kind);

async function resetCanvas(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('garn')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async () => {
    const wc = game.modules?.get('garn')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await game.settings?.set('garn', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
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

const card = (page: Page, name: string) => page.locator('[data-garn-node]', { hasText: name });

test('Connections: right-drag, digit keys, c, editor, Tab/q, rendering', async ({ gm }) => {
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

  // Right-drag from Alrik onto the canvas → class box → Item. Counting real inputs: one
  // drag gesture, one click: the connected Element exists (spec 1.1 §B.4: ≤ 2).
  const p = await boxOf(card(gm, 'Alrik'));
  await gm.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await gm.mouse.down({ button: 'right' });
  await gm.mouse.move(p.x + 250, p.y + 80, { steps: 5 });
  await gm.mouse.move(p.x + 450, p.y + 120, { steps: 5 });
  await gm.mouse.up({ button: 'right' });
  await expect(gm.locator('[data-garn-class-box]')).toBeVisible();
  await gm.locator('[data-garn-class-option="item"]').click();
  await expect.poll(async () => (await records(gm, 'connection')).length).toBe(1);
  const [owns] = await records(gm, 'connection');
  expect(owns?.data).toMatchObject({ from: alrik, type: 'owns', direction: 'directed' });

  // Name, then the Connection editor (Behavioural: Enter closes it).
  await expect(gm.locator('[data-garn-name-input]')).toBeFocused();
  await gm.keyboard.type('Sword');
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-garn-connection-editor] button').first()).toBeFocused();
  await gm.keyboard.press('Enter');
  await expect(gm.locator('[data-garn-connection-editor]')).toHaveCount(0);
  const ownsLabel = gm.locator(`[data-garn-edge="${owns?.id}"]`);
  await expect(ownsLabel).toHaveAttribute('data-garn-edge-type', 'owns');
  await expect(ownsLabel).toContainText('owns');
  // Directed: arrowhead on the edge path.
  await expect(
    gm.locator(`.svelte-flow__edge[data-id="${owns?.id}"] .svelte-flow__edge-path`),
  ).toHaveAttribute('marker-end', /url/);

  // Digit key on the selected Node: `1` creates a connected Person (free-form, outgoing).
  await card(gm, 'Alrik').click();
  await expect(card(gm, 'Alrik')).toHaveClass(/selected/);
  await gm.keyboard.press('Digit1');
  // Person takes the Source Step (spec 1.1 §B.1): → Blank.
  await expect(gm.locator('[data-garn-source-step="person"]')).toBeFocused();
  await gm.keyboard.press('ArrowRight');
  await expect(gm.locator('[data-garn-name-input]')).toBeFocused();
  await gm.keyboard.type('Rondra');
  await gm.keyboard.press('Enter');
  const label = gm.locator('[data-garn-label-input]');
  await expect(label).toBeFocused();
  await gm.keyboard.type('loves');
  await gm.keyboard.press('Enter');
  await expect(label).toHaveCount(0);
  const loves = gm.locator('[data-garn-edge]', { hasText: 'loves' });
  await expect(loves).toHaveAttribute('data-garn-edge-from', alrik);
  await expect(loves).toHaveAttribute('data-garn-edge-direction', 'directed');

  // v1.1 §F.1: Tab toggles directed ⇄ mutual (never reverses); Shift+Tab reverses.
  const lovesId = (await loves.getAttribute('data-garn-edge')) ?? '';
  const lovesPath = gm.locator(`.svelte-flow__edge[data-id="${lovesId}"] .svelte-flow__edge-path`);
  await loves.click();
  await gm.keyboard.press('Tab');
  await expect(loves).toHaveAttribute('data-garn-edge-direction', 'mutual');
  await expect(lovesPath).not.toHaveAttribute('marker-end', /url/);
  await gm.keyboard.press('Tab');
  await expect(loves).toHaveAttribute('data-garn-edge-direction', 'directed');
  // Mutual → directed points A→B in id order (§D `connection.setDirection`), ids are random.
  const lovesData = (await records(gm, 'connection')).find((r) => r.id === lovesId)?.data;
  const [first = '', second = ''] = [String(lovesData?.['from']), String(lovesData?.['to'])].sort();
  await expect(loves).toHaveAttribute('data-garn-edge-from', first);
  await gm.keyboard.press('Shift+Tab');
  await expect(loves).toHaveAttribute('data-garn-edge-from', second);
  await expect(loves).toHaveAttribute('data-garn-edge-direction', 'directed');

  // `c` Rondra → Sword: the default Connection (v1.1 §F.3) is owns.
  await card(gm, 'Rondra').click();
  await gm.keyboard.press('KeyC');
  await expect(gm.locator('[data-garn-connect-hint]')).toBeVisible();
  await card(gm, 'Sword').click();
  await expect(gm.locator('[data-garn-connection-editor] button').first()).toBeFocused();
  await gm.keyboard.press('Enter');
  // Rondra now owns the Sword; the old owner's Connection is replaced (≤1 owner).
  const rondraSword = gm.locator('[data-garn-edge][data-garn-edge-type="owns"]');
  await expect(rondraSword).toHaveCount(1);
  await expect(gm.locator(`[data-garn-edge="${owns?.id}"]`)).toHaveCount(0);
  // q cycles type: owns → free-form.
  await rondraSword.click();
  await gm.keyboard.press('KeyQ');
  await expect(gm.locator('[data-garn-edge-type="owns"]')).toHaveCount(0);

  // Parallel Connections between one pair: separate curves, separate labels.
  const rondra = (await records(gm, 'element')).find((r) => r.data['name'] === 'Rondra')?.id;
  await api(gm, 'connection.create', { from: alrik, to: rondra, label: 'fears' });
  const fears = gm.locator('[data-garn-edge]', { hasText: 'fears' });
  await expect(fears).toBeVisible();
  const a = await boxOf(fears);
  const b = await boxOf(loves);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(20);

  // F2 on a selected Connection opens its editor.
  await fears.click();
  await gm.keyboard.press('F2');
  await expect(gm.locator('[data-garn-label-input]')).toBeFocused();
  await gm.keyboard.press('Escape');
});
