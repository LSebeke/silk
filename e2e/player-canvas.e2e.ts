/**
 * Player View + Player Canvas against real Foundry + dsa5 (spec §9): the GM's Reveals and
 * moves reach the Player View setting; the player opens a read-only canvas from the same
 * scene-control button and sees Revealed Nodes only, hooded until Appearance; clicks open docs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
import { ensureAdventure } from './adventure';
import { expect, test, waitForGarn } from './fixtures';

/** Player sync is slow under load (e2e.md): never poll it below 20 s. */
const SYNC = { timeout: 45_000 };
const HOODED = 'icons/svg/mystery-man-black.svg';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const uuidOf = (page: Page, id: string) =>
  page.evaluate(
    (i) => game.modules?.get('garn')?.session?.().workingCopy.get(i)?.data['uuid'] as string,
    id,
  );

const storedView = (page: Page) =>
  page.evaluate(() => game.settings?.get('garn', 'playerView') as any);

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

/** Uuids of the documents whose sheets are open on this client. */
const openSheets = (page: Page) =>
  page.evaluate(() =>
    [...foundry.applications.instances.values()]
      .map((app: any) => app.document?.uuid as string | undefined)
      .filter(Boolean),
  );

test('Player View follows Reveal and moves; the player canvas shows it read-only and opens docs', async ({
  gm,
  player,
}) => {
  test.setTimeout(420_000);
  await waitForGarn(gm);
  await ensureAdventure(gm);
  await gm.evaluate(() => game.settings?.set('garn', 'materializeMode', 'immediate'));
  const create = async (cls: string, name: string, x: number, y: number) =>
    (await api<{ id: string }>(gm, 'element.create', { class: cls, name, at: { x, y } })).id;
  const gareth = await create('location', 'Gareth-T17', 600, 200);
  const alrik = await create('person', 'Alrik-T17', 200, 200);
  // A real image: DSA5's default actor icon is the core hood itself (v1.1 §C.4).
  await api(gm, 'element.setImage', { id: alrik, img: 'icons/svg/cowled.svg' });
  const spy = await create('person', 'Spy-T17', 400, 500);
  const livesIn = (
    await api<{ id: string }>(gm, 'connection.create', {
      from: alrik,
      to: gareth,
      label: 'lives in',
    })
  ).id;
  const serves = (
    await api<{ id: string }>(gm, 'connection.create', { from: alrik, to: spy, label: 'serves' })
  ).id;
  await expect.poll(() => uuidOf(gm, spy)).toBeTruthy();
  const garethUuid = await uuidOf(gm, gareth);
  const alrikUuid = await uuidOf(gm, alrik);

  // GM: one Connection Reveal reveals both ends; the active GM writes the Player View.
  await api(gm, 'reveal.connection', { id: livesIn, revealed: true });
  await expect
    .poll(async () => {
      const view = await storedView(gm);
      return {
        nodes: (view.nodes ?? []).map((n: any) => n.id).sort(),
        connections: (view.connections ?? []).map((c: any) => [c.id, c.label]),
      };
    }, SYNC)
    .toEqual({ nodes: [alrik, gareth].sort(), connections: [[livesIn, 'lives in']] });
  const view = JSON.stringify(await storedView(gm));
  for (const secret of [spy, serves, 'Spy-T17', 'Gareth-T17']) expect(view).not.toContain(secret);

  // Player: the same Garn scene-control button, which runs `canvas.open`.
  await waitForGarn(player);
  await closePopups(player);
  await player.evaluate(() => game.settings?.set('garn', 'playerViewState', {}));
  const tool = await player.evaluate(() => {
    const t = (ui.controls as any)?.controls?.notes?.tools?.garn;
    return t ? { visible: t.visible, button: t.button } : null;
  });
  expect(tool).toEqual({ visible: true, button: true });
  await api(player, 'canvas.open');
  const canvas = player.locator('[data-garn-player-canvas]');
  await expect(canvas).toBeVisible();
  const card = (name: string) => canvas.locator('[data-garn-player-node]', { hasText: name });
  await expect(card('Gareth-T17')).toBeVisible(SYNC);
  await expect(card('Alrik-T17')).toBeVisible(SYNC);
  await expect(canvas.locator('[data-garn-player-node]')).toHaveCount(2);
  // Names wrap like the GM's cards (spec 1.1 §G.5, §E.1): one shared card-name style.
  await expect(card('Alrik-T17').locator('[data-garn-card-name="title"]')).toHaveCSS(
    'white-space',
    'normal',
  );
  await expect(canvas.locator(`[data-garn-player-edge="${livesIn}"]`)).toHaveText('lives in');
  await expect(canvas.locator('[data-garn-player-edge]')).toHaveCount(1);
  // Hooded until Appearance; no Status chip, eye toggle or Connection Points.
  await expect(card('Alrik-T17')).toHaveAttribute('data-garn-img', HOODED);
  await expect(
    canvas.locator('[data-garn-eye], [data-garn-status], [data-garn-point]'),
  ).toHaveCount(0);
  // Players never get the GM World Canvas.
  await expect(player.locator('[data-garn-canvas]')).toHaveCount(0);

  // Read-only: dragging a card moves nothing.
  const before = await card('Gareth-T17').boundingBox();
  const box = before ?? { x: 0, y: 0, width: 0, height: 0 };
  const gapBefore = box.y - ((await card('Alrik-T17').boundingBox())?.y ?? 0);
  await player.mouse.move(box.x + 100, box.y + 40);
  await player.mouse.down();
  await player.mouse.move(box.x + 100, box.y + 140, { steps: 5 });
  await player.mouse.up();
  // The pane may pan with the drag; the card keeps its place relative to Alrik.
  const gap = async () =>
    ((await card('Gareth-T17').boundingBox())?.y ?? 0) -
    ((await card('Alrik-T17').boundingBox())?.y ?? 0);
  expect(Math.round(await gap())).toBe(Math.round(gapBefore));
  // Nothing was written from the player's client.
  expect(await storedView(player)).toMatchObject({
    nodes: expect.arrayContaining([expect.objectContaining({ id: gareth, x: 600, y: 200 })]),
  });

  // GM moves and Reveals Appearance: the player's canvas follows.
  await api(gm, 'canvas.moveNodes', { moves: [{ id: gareth, x: 900, y: 300 }] });
  await api(gm, 'reveal.appearance', { id: alrik, revealed: true });
  await expect
    .poll(async () => (await storedView(player)).nodes?.find((n: any) => n.id === gareth), SYNC)
    .toMatchObject({ x: 900, y: 300 });
  await expect.poll(() => card('Alrik-T17').getAttribute('data-garn-img'), SYNC).not.toBe(HOODED);

  // Pan/zoom is per client.
  const area = await canvas.boundingBox();
  if (area) await player.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await player.mouse.wheel(0, -300);
  await expect
    .poll(() => player.evaluate(() => (game.settings?.get('garn', 'playerViewState') as any)?.zoom))
    .toBeGreaterThan(0);

  // Clicks open the docs: the journal entry; the LIMITED actor sheet + Companion Journal
  // (OBSERVER since its Connection is Revealed).
  // Reopen fitted (Gareth moved off-screen): no saved view → fit.
  await player.evaluate(async () => {
    await foundry.applications.instances.get('garn-player-canvas')?.close();
    await game.settings?.set('garn', 'playerViewState', {});
  });
  await expect(canvas).toHaveCount(0);
  await api(player, 'canvas.open');
  await expect(card('Gareth-T17')).toBeVisible();
  await card('Gareth-T17').click();
  await expect.poll(() => openSheets(player), SYNC).toContain(garethUuid);
  // The sheet covers the canvas.
  await player.evaluate(async (u) => {
    for (const app of [...foundry.applications.instances.values()] as any[])
      if (app.document?.uuid === u) await app.close();
  }, garethUuid);
  await card('Alrik-T17').click();
  await expect.poll(() => openSheets(player), SYNC).toContain(alrikUuid);
  const companion = await player.evaluate(
    (u) => `JournalEntry.${(fromUuidSync(u) as any).flags.garn.companion}`,
    alrikUuid,
  );
  await expect.poll(() => openSheets(player), SYNC).toContain(companion);
});
