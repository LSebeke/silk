/** Connections journal page against real Foundry + dsa5 (spec §4 Journal layout, §5 In journals). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
import { ensureAdventure } from './adventure';
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
  await page.evaluate(() => game.settings?.set('silk', 'materializeMode', 'immediate'));
  // The page lists Revealed Connections only (§5, §8): Reveal needs an Adventure.
  await ensureAdventure(page);
}

/** The element's Connections page content (journal, or Companion Journal for actors/items). */
const connectionsPage = (page: Page, id: string) =>
  page.evaluate((elementId) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data['uuid'];
    if (typeof uuid !== 'string') return null;
    const doc = fromUuidSync(uuid) as any;
    const journal =
      doc?.documentName === 'JournalEntry' ? doc : game.journal?.get(doc?.flags.silk?.companion);
    const page = journal?.pages.get(journal.flags.silk?.connections);
    return page
      ? { content: page.text.content as string, ownership: page.ownership.default as number }
      : null;
  }, id);

const create = async (page: Page, cls: string, name: string) =>
  (await api<{ id: string }>(page, 'element.create', { class: cls, name })).id;

test('Connections pages follow create, edit, flip and delete on both endpoints', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const alrik = await create(gm, 'person', 'Alrik');
  const inn = await create(gm, 'location', 'Inn');
  await expect.poll(() => connectionsPage(gm, inn)).toEqual({ content: '', ownership: 0 });

  const { id } = await api<{ id: string }>(gm, 'connection.create', {
    from: alrik,
    to: inn,
    label: 'runs',
  });
  // Not Revealed yet: players see no sentence.
  await expect.poll(async () => (await connectionsPage(gm, inn))?.content).toBe('');
  await api(gm, 'reveal.connection', { id, revealed: true });
  for (const end of [alrik, inn])
    await expect
      .poll(async () => (await connectionsPage(gm, end))?.content)
      .toBe('<ul><li>Alrik runs Inn</li></ul>');

  await api(gm, 'connection.setLabel', { id, label: 'fears' });
  await api(gm, 'connection.flip', { id });
  for (const end of [alrik, inn])
    await expect
      .poll(async () => (await connectionsPage(gm, end))?.content)
      .toBe('<ul><li>Inn fears Alrik</li></ul>');

  // Behavioural phrase, localised (EN in the test world).
  const sword = await create(gm, 'item', 'Sword');
  const owns = await api<{ id: string }>(gm, 'connection.create', {
    from: alrik,
    to: sword,
    type: 'owns',
  });
  await api(gm, 'reveal.connection', { id: owns.id, revealed: true });
  await expect
    .poll(async () => (await connectionsPage(gm, sword))?.content)
    .toBe('<ul><li>Alrik owns Sword</li></ul>');

  await api(gm, 'connection.delete', { ids: [id] });
  await expect.poll(async () => (await connectionsPage(gm, inn))?.content).toBe('');
  await expect
    .poll(async () => (await connectionsPage(gm, alrik))?.content)
    .toBe('<ul><li>Alrik owns Sword</li></ul>');
  // OBSERVER from the first Revealed Connection on; NONE again without one (§8).
  expect((await connectionsPage(gm, alrik))?.ownership).toBe(2);
  await expect.poll(async () => (await connectionsPage(gm, inn))?.ownership).toBe(0);
});

test('a hand edit of the Connections page is regenerated', async ({ gm }) => {
  test.setTimeout(60_000);
  await ready(gm);
  const a = await create(gm, 'location', 'Gareth');
  const b = await create(gm, 'location', 'Punin');
  const { id } = await api<{ id: string }>(gm, 'connection.create', {
    from: a,
    to: b,
    direction: 'mutual',
    label: 'trade',
  });
  await api(gm, 'reveal.connection', { id, revealed: true });
  const expected = '<ul><li>Gareth and Punin trade</li></ul>';
  await expect.poll(async () => (await connectionsPage(gm, b))?.content).toBe(expected);
  await gm.evaluate(async (elementId) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data['uuid'];
    const journal = fromUuidSync(uuid as string) as any;
    await journal.pages.get(journal.flags.silk.connections).update({ 'text.content': 'mine' });
  }, b);
  await expect.poll(async () => (await connectionsPage(gm, b))?.content).toBe(expected);
});
