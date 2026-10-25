/**
 * Player Notes against real Foundry + dsa5 with a GM and a player client (spec §9): the
 * player adds a note from a sheet header button (socket → active GM), edits it, the GM
 * converts one to an Info Block, and un-reveal hides the rest.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
import { ensureAdventure } from './adventure';
import { expect, test, waitForSilk } from './fixtures';

/** Player sync is slow under load (e2e.md): never poll it below 20 s. */
const SYNC = { timeout: 45_000 };

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const record = (page: Page, id: string) =>
  page.evaluate((i) => game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data as any, id);

/** The player's permission on each Player Note page / Info Block of the element's journal. */
const playerPages = (page: Page, uuid: string) =>
  page.evaluate((u) => {
    const doc = fromUuidSync(u) as any;
    const companion = doc?.flags?.silk?.companion
      ? game.journal?.get(doc.flags.silk.companion)
      : undefined;
    const journal = doc?.documentName === 'JournalEntry' ? doc : companion;
    if (!journal) return null;
    const level = (p: any) =>
      p.testUserPermission(game.user, 'OWNER')
        ? 'owner'
        : p.testUserPermission(game.user, 'OBSERVER')
          ? 'observer'
          : 'none';
    return Object.fromEntries(
      [...journal.pages].map((p: any) => [
        p.id,
        {
          level: level(p),
          note: !!p.category && p.category === journal.flags.silk?.playerNotes,
          text: p.text?.content as string,
        },
      ]),
    );
  }, uuid);

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

test('a player writes, edits and loses notes; the GM converts one', async ({ gm, player }) => {
  test.setTimeout(300_000);
  await waitForSilk(gm);
  await ensureAdventure(gm);
  await gm.evaluate(() => game.settings?.set('silk', 'materializeMode', 'immediate'));
  const create = async (cls: string, name: string) =>
    (await api<{ id: string }>(gm, 'element.create', { class: cls, name })).id;
  const gareth = await create('location', 'Gareth-T18');
  const alrik = await create('person', 'Alrik-T18');
  await expect.poll(async () => (await record(gm, alrik))?.uuid).toBeTruthy();
  const garethUuid = (await record(gm, gareth)).uuid as string;
  const alrikUuid = (await record(gm, alrik)).uuid as string;
  await api(gm, 'reveal.element', { id: gareth });
  await api(gm, 'reveal.element', { id: alrik });

  // Player: the header button on the Revealed journal, a prompt, socket → GM.
  await waitForSilk(player);
  await closePopups(player);
  await expect
    .poll(
      () =>
        player.evaluate(async (u) => {
          const doc = fromUuidSync(u) as any;
          if (!doc?.testUserPermission(game.user, 'OBSERVER')) return [];
          await doc.sheet.render(true);
          return [...doc.sheet._headerControlButtons()].map((c: any) => c.label as string);
        }, garethUuid),
      SYNC,
    )
    .toContain('Add Player Note');
  await player.evaluate((u) => {
    const doc = fromUuidSync(u) as any;
    [...doc.sheet._headerControlButtons()]
      .find((c: any) => c.label === 'Add Player Note')
      .onClick();
  }, garethUuid);
  await player.locator('[data-silk-player-note-text]').fill('The gate guard takes bribes');
  await player.locator('dialog button[data-action="ok"]').click();

  await expect.poll(async () => (await record(gm, gareth))?.playerNotes?.length ?? 0, SYNC).toBe(1);
  const note = (await record(gm, gareth)).playerNotes[0];
  expect(note.text).toBe('<p>The gate guard takes bribes</p>');
  expect(note.campaign).toBeTruthy();
  await expect
    .poll(async () => (await playerPages(player, garethUuid))?.[note._id], SYNC)
    .toMatchObject({ level: 'owner', note: true });

  // Any player edits (relayed); a note on an Actor element opens its Companion Journal.
  await api(player, 'playerNote.edit', { id: note._id, text: '<p>Only at night</p>' });
  await expect
    .poll(async () => (await record(gm, gareth)).playerNotes[0].text, SYNC)
    .toBe('<p>Only at night</p>');
  const { id: alrikNote } = await api<{ id: string }>(player, 'playerNote.create', {
    elementId: alrik,
    text: '<p>Limps</p>',
  });
  await expect
    .poll(async () => (await playerPages(player, alrikUuid))?.[alrikNote], SYNC)
    .toMatchObject({ level: 'owner', note: true });

  // GM: Convert to GM Info Block → players lose edit rights, it stays Revealed.
  await api(gm, 'playerNote.convert', { id: note._id });
  await expect
    .poll(async () => (await playerPages(player, garethUuid))?.[note._id], SYNC)
    .toMatchObject({ level: 'observer', note: false });
  expect((await record(gm, gareth)).infoBlocks.map((b: any) => b._id)).toContain(note._id);

  // Un-reveal hides the element's notes; re-Reveal brings them back.
  await api(gm, 'reveal.element', { id: alrik, revealed: false });
  await expect
    .poll(async () => (await playerPages(player, alrikUuid))?.[alrikNote]?.level ?? 'none', SYNC)
    .toBe('none');
  await api(gm, 'reveal.element', { id: alrik });
  await expect
    .poll(async () => (await playerPages(player, alrikUuid))?.[alrikNote]?.level, SYNC)
    .toBe('owner');

  // The player deletes it.
  await api(player, 'playerNote.delete', { id: alrikNote });
  await expect.poll(async () => (await record(gm, alrik)).playerNotes, SYNC).toBeUndefined();
});
