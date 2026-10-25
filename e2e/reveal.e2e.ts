/**
 * Reveal against real Foundry + dsa5 with a GM and a player client (spec §8): the context
 * menu, `r` with y/n, Element Detail eye toggles, sheet header buttons, and what the
 * player can actually see.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
import { ensureAdventure as startAdventure } from './adventure';
import { expect, test } from './fixtures';

/** Player sync is slow under load (e2e.md): never poll it below 20 s. */
const SYNC = { timeout: 45_000 };

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function waitForSilk(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
}

/** Bound Canon with an Adventure checked out (an earlier test may have started one). */
async function ensureAdventure(page: Page) {
  await startAdventure(page);
  await page.evaluate(async () => {
    await game.settings?.set('silk', 'materializeMode', 'immediate');
    await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
  });
}

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
    document.getElementById('notifications')?.style.setProperty('display', 'none');
  });
}

const uuidOf = (page: Page, id: string) =>
  page.evaluate(
    (i) => game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data['uuid'] as string,
    id,
  );

/** What the player client can see of a doc (and its pages). */
const playerView = (page: Page, uuid: string) =>
  page.evaluate((u) => {
    const doc = fromUuidSync(u) as any;
    if (!doc) return null;
    const can = (d: any, level: string) => d.testUserPermission(game.user, level) as boolean;
    const companion = doc.flags?.silk?.companion
      ? game.journal?.get(doc.flags.silk.companion)
      : undefined;
    const journal = doc.documentName === 'JournalEntry' ? doc : companion;
    const pages = journal
      ? Object.fromEntries(
          [...journal.pages].map((p: any) => [p.name, can(p, 'OBSERVER') ? 'observe' : 'none']),
        )
      : {};
    const connections = journal?.pages.get(journal.flags.silk?.connections);
    return {
      limited: can(doc, 'LIMITED'),
      observer: can(doc, 'OBSERVER'),
      img: doc.img as string,
      companion: companion ? can(companion, 'OBSERVER') : null,
      pages,
      connections: connections && can(connections, 'OBSERVER') ? connections.text.content : null,
    };
  }, uuid);

const card = (page: Page, name: string) => page.locator('[data-silk-node]', { hasText: name });

test('Reveal through menu, r, Element Detail and header buttons; the player sees exactly that', async ({
  gm,
  player,
}) => {
  test.setTimeout(300_000);
  await waitForSilk(gm);
  await ensureAdventure(gm);
  const create = async (cls: string, name: string, x: number) =>
    (await api<{ id: string }>(gm, 'element.create', { class: cls, name, at: { x, y: 200 } })).id;
  const gareth = await create('location', 'Gareth-T16', 600);
  const alrik = await create('person', 'Alrik-T16', 200);
  const livesIn = (
    await api<{ id: string }>(gm, 'connection.create', {
      from: alrik,
      to: gareth,
      label: 'lives in',
    })
  ).id;
  await api(gm, 'connection.create', { from: alrik, to: gareth, label: 'fears' });
  await expect.poll(() => uuidOf(gm, alrik)).toBeTruthy();
  const garethUuid = await uuidOf(gm, gareth);
  const alrikUuid = await uuidOf(gm, alrik);

  await waitForSilk(player);
  await expect.poll(() => playerView(player, garethUuid), SYNC).toMatchObject({ limited: false });
  // Before Reveal the actor is hooded even in Foundry, for tokens on any Scene.
  await expect
    .poll(async () => (await playerView(player, alrikUuid))?.img, SYNC)
    .toBe('modules/silk/assets/hooded.svg');

  await closePopups(gm);
  await api(gm, 'canvas.open');
  // Context menu → Reveal (the class box sits to the right of the actions).
  await card(gm, 'Gareth-T16').locator('.portrait').click({ button: 'right' });
  const menu = gm.locator(`[data-silk-menu="${gareth}"]`);
  await expect(menu).toBeVisible();
  await expect(gm.locator('[data-silk-class-box]')).toBeVisible();
  await menu.locator('[data-silk-menu-item="reveal.element"]').click();
  await expect(card(gm, 'Gareth-T16')).toHaveAttribute('data-silk-revealed', '');
  await expect(card(gm, 'Gareth-T16').locator('[data-silk-eye]')).toHaveAttribute(
    'data-silk-eye',
    'on',
  );
  await expect
    .poll(() => playerView(player, garethUuid), SYNC)
    .toMatchObject({
      observer: true,
      pages: { Cover: 'observe', Description: 'none', Secrets: 'none', Connections: 'none' },
    });

  // `r` on Alrik: n declines, y Reveals (LIMITED, still hooded).
  await card(gm, 'Alrik-T16').locator('.portrait').click();
  await gm.keyboard.press('KeyR');
  const confirm = gm.locator('[data-silk-reveal-confirm]');
  await expect(confirm).toContainText('Alrik-T16');
  await gm.keyboard.press('KeyN');
  await expect(confirm).toHaveCount(0);
  await gm.keyboard.press('KeyR');
  await gm.keyboard.press('KeyY');
  await expect
    .poll(() => playerView(player, alrikUuid), SYNC)
    .toMatchObject({ limited: true, observer: false, companion: false });

  // Element Detail (double-click): eye on one Connection; the GM sees both.
  await card(gm, 'Alrik-T16').locator('.portrait').dblclick();
  const detail = gm.locator(`[data-silk-detail="${alrik}"]`);
  await expect(detail.locator('[data-silk-detail-connection]')).toHaveCount(2);
  await detail.locator(`[data-silk-detail-connection="${livesIn}"] [data-silk-eye]`).click();
  await expect(
    detail.locator(`[data-silk-detail-connection="${livesIn}"] [data-silk-eye]`),
  ).toHaveAttribute('data-silk-eye', 'on');
  // Players see only the Revealed sentence, on both endpoints' Connections pages.
  await expect
    .poll(async () => (await playerView(player, garethUuid))?.connections, SYNC)
    .toBe('<ul><li>Alrik-T16 lives in Gareth-T16</li></ul>');
  await expect
    .poll(() => playerView(player, alrikUuid), SYNC)
    .toMatchObject({
      companion: true,
      connections: '<ul><li>Alrik-T16 lives in Gareth-T16</li></ul>',
    });

  // Appearance from the detail window: the real image comes back.
  await detail.locator('[data-silk-detail-appearance] [data-silk-eye]').click();
  await expect
    .poll(async () => (await playerView(player, alrikUuid))?.img, SYNC)
    .not.toBe('modules/silk/assets/hooded.svg');

  // Sheet header button: Un-reveal Gareth reverses everything for the player.
  const labels = await gm.evaluate(async (u) => {
    const doc = fromUuidSync(u) as any;
    await doc.sheet.render(true);
    return [...doc.sheet._headerControlButtons()].map((c: any) => c.label as string);
  }, garethUuid);
  expect(labels).toEqual(
    expect.arrayContaining(['Un-reveal', 'Show to players', 'Element Detail']),
  );
  await gm.evaluate((u) => {
    const doc = fromUuidSync(u) as any;
    [...doc.sheet._headerControlButtons()].find((c: any) => c.label === 'Un-reveal').onClick();
  }, garethUuid);
  await expect
    .poll(() => playerView(player, garethUuid), SYNC)
    .toMatchObject({ limited: false, observer: false });
  // Alrik's only Revealed Connection went with Gareth.
  await expect
    .poll(() => playerView(player, alrikUuid), SYNC)
    .toMatchObject({ limited: true, connections: null });
});
