/** Status against real dsa5 (spec §4 Status, §7 Dead, §10.3 `s`). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped dsa5/Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const status = (page: Page, id: string) =>
  page.evaluate(
    (i) => game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['status'] ?? null,
    id,
  );

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

/** The element's actor (Foundry doc), evaluated in the page. */
const isDead = (page: Page, id: string) =>
  page.evaluate((i) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
    return !!(fromUuidSync(uuid as string) as any)?.hasCondition('dead');
  }, id);

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

const card = (page: Page, name: string) => page.locator('[data-silk-node]', { hasText: name });

test('Person dead ↔ dsa5 dead condition, both ways; s with y/n confirm; Status chip', async ({
  gm,
}) => {
  test.setTimeout(180_000);
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'person',
    name: 'Alrik',
    at: { x: 200, y: 200 },
  });
  await closePopups(gm);
  await api(gm, 'canvas.open');
  const chip = card(gm, 'Alrik').locator('[data-silk-status]');
  await expect(chip).toHaveAttribute('data-silk-status', 'alive');

  // `s`, then n: nothing changes (default n).
  await card(gm, 'Alrik').locator('.portrait').click();
  await expect(card(gm, 'Alrik')).toHaveClass(/selected/);
  await gm.keyboard.press('KeyS');
  const prompt = gm.locator('[data-silk-status-confirm]');
  await expect(prompt).toContainText('Alrik');
  await gm.keyboard.press('Enter');
  await expect(prompt).toHaveCount(0);
  expect(await isDead(gm, id)).toBe(false);

  // `s`, then y: the actor gets dsa5's dead condition.
  await gm.keyboard.press('KeyS');
  await expect(prompt).toBeVisible();
  await gm.keyboard.press('KeyY');
  await expect.poll(() => isDead(gm, id)).toBe(true);
  await expect(chip).toHaveAttribute('data-silk-status', 'dead');

  // Foundry side: the GM removes the condition on the actor → the element is alive again.
  await gm.evaluate(async (i) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
    await (fromUuidSync(uuid as string) as any).removeCondition('dead');
  }, id);
  await expect.poll(() => status(gm, id)).toBe(null);
  await expect(chip).toHaveAttribute('data-silk-status', 'alive');

  // And adds it again (as from the token HUD).
  await gm.evaluate(async (i) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
    await (fromUuidSync(uuid as string) as any).addCondition('dead');
  }, id);
  await expect.poll(() => status(gm, id)).toBe('dead');

  // Chip click asks too; y brings him back.
  await gm.evaluate(() => ui.notifications?.clear());
  await chip.click();
  await expect(prompt).toBeVisible();
  await gm.locator('[data-silk-action="status-yes"]').click();
  await expect.poll(() => isDead(gm, id)).toBe(false);
  await expect(chip).toHaveAttribute('data-silk-status', 'alive');

  await gm.evaluate(() => foundry.applications.instances.get('silk-canvas')?.close());
});

test('Quest: status ↔ dsaquestlog status, questlogJournals; Event planned/happened/skipped', async ({
  gm,
}) => {
  test.setTimeout(120_000);
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'quest',
    name: 'Find the Ring',
  });
  const quest = () =>
    gm.evaluate((i) => {
      const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
      const doc = fromUuidSync(uuid as string) as any;
      const q = doc.pages.get(doc.flags.silk.quest).system.quests[doc.flags.silk.questKey];
      const journals = (game.settings as any).get('dsa5', 'questlogJournals').activated;
      return { status: q.status, registered: journals.some((j: any) => j.uuid === uuid) };
    }, id);
  expect(await quest()).toEqual({ status: 0, registered: true });

  await api(gm, 'element.toggleStatus', { id });
  expect((await quest()).status).toBe(1);
  await api(gm, 'element.setStatus', { id, status: 'failed' });
  expect((await quest()).status).toBe(2);
  expect(await status(gm, id)).toBe('failed');

  // Edited in the DSA5 quest log: flows back.
  await gm.evaluate(async (i) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'];
    const doc = fromUuidSync(uuid as string) as any;
    await doc.pages
      .get(doc.flags.silk.quest)
      .update({ [`system.quests.${doc.flags.silk.questKey}.status`]: 1 });
  }, id);
  await expect.poll(() => status(gm, id)).toBe('done');

  const { id: event } = await api<{ id: string }>(gm, 'element.create', {
    class: 'event',
    name: 'Feast',
  });
  await api(gm, 'element.toggleStatus', { id: event });
  expect(await status(gm, event)).toBe('happened');
  await api(gm, 'element.toggleStatus', { id: event });
  expect(await status(gm, event)).toBe('skipped');
});
