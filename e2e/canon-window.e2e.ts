import type { Locator, Page } from '@playwright/test';
import type { Session } from '../src/adapter/session';
import type { CommandRegistry } from '../src/core/commands/registry';
import { expect, test } from './fixtures';

/** Runs `fn` in the page with Silk's api and session. */
function silk<A, R>(
  page: Page,
  fn: (s: { api: CommandRegistry; session: Session }, arg: A) => R | Promise<R>,
  arg?: A,
): Promise<R> {
  return page.evaluate(
    ([src, a]) => {
      const mod = game.modules?.get('silk') as unknown as {
        api: CommandRegistry;
        session(): Session;
      };
      const f = new Function(`return (${src})`)() as typeof fn;
      return f({ api: mod.api, session: mod.session() }, a as A);
    },
    [fn.toString(), arg] as const,
  );
}

const fetchJson = (page: Page, path: string) =>
  page.evaluate(async (p) => (await fetch(p, { cache: 'no-store' })).json(), path);

async function fill(input: Locator, value: string) {
  await input.fill(value);
  await expect(input).toHaveValue(value);
}

/**
 * DSA5 opens a modal skin-selection `<dialog>` on a new world; it makes the rest of the
 * page inert, so inputs can't take focus. Close every DSA5 window and the tour.
 */
async function closePopups(page: Page) {
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    // Foundry's welcome tour overlays the page too.
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout')) el.remove();
  });
}

test('Canon window: Campaigns, start an Adventure, history and Revelation Map', async ({ gm }) => {
  test.setTimeout(180_000);
  // `ready` is async: wait for the session.
  await gm.waitForFunction(() => {
    try {
      (game.modules?.get('silk') as unknown as { session(): unknown }).session();
      return true;
    } catch {
      return false;
    }
  });
  // The World may already be bound by an earlier test in this worker; then use that Canon.
  const canonId = await silk(gm, async ({ api, session }) => {
    const bound = session.workingCopy.binding;
    if (bound) return bound.canonId;
    return (await api.run<{ canonId: string }>('canon.create', { name: 'E2E' })).canonId;
  });
  await silk(gm, async ({ api, session }) => {
    await session.workingCopy.set([{ kind: 'element', id: 'el-t15', data: { name: 'T15' } }]);
    await api.run('history.commit', { label: 'T15 start' });
  });

  await closePopups(gm);
  await silk(gm, ({ api }) => api.run('canon.openWindow'));
  const win = gm.locator('[data-silk-canon]');
  await expect(win).toBeVisible();
  await expect(win.locator('[data-silk-checkout]')).toContainText('main');
  await expect(win.locator('[data-silk-history]')).toContainText('T15 start');

  // Campaign lifecycle through the UI.
  await fill(win.locator('[data-silk-campaign-name]'), 'Phileasson');
  await win.locator('[data-silk-campaign-create]').click();
  const created = win.locator('[data-silk-campaign]', { hasText: 'Phileasson' });
  await expect(created).toBeVisible();
  const campaignId = (await created.getAttribute('data-silk-campaign')) ?? '';
  const campaign = win.locator(`[data-silk-campaign="${campaignId}"]`);
  await campaign.locator('[data-silk-campaign-rename]').click();
  await fill(campaign.locator('[data-silk-campaign-rename-input]'), 'Phileasson-Saga');
  await campaign.locator('[data-silk-campaign-rename-confirm]').click();
  await campaign.locator('[data-silk-campaign-close]').click();
  await expect(campaign.locator('[data-silk-campaign-reopen]')).toBeVisible();
  expect(
    await fetchJson(gm, `/silk/${canonId}/campaigns/${campaignId}/campaign.json`),
  ).toMatchObject({ id: campaignId, name: 'Phileasson-Saga', closed: true, formatVersion: 1 });
  // A closed Campaign is not offered for new Adventures.
  await expect(
    win.locator(`[data-silk-adventure-campaign] option[value="${campaignId}"]`),
  ).toHaveCount(0);
  await campaign.locator('[data-silk-campaign-reopen]').click();
  await expect(campaign.locator('[data-silk-campaign-close]')).toBeVisible();

  // Revelation Map read/write API, stored next to campaign.json.
  await silk(
    gm,
    ({ session }, id) =>
      session.campaigns.writeRevelationMap(id, {
        elements: ['el-t15'],
        appearance: [],
        infoBlocks: [],
        connections: [],
        playerNotes: [],
      }),
    campaignId,
  );
  expect(
    await fetchJson(gm, `/silk/${canonId}/campaigns/${campaignId}/revelation-map.json`),
  ).toMatchObject({ formatVersion: 1, elements: ['el-t15'] });

  // Start an Adventure through the UI.
  await fill(win.locator('[data-silk-adventure-name]'), 'Chapter 1');
  await win.locator('[data-silk-adventure-campaign]').selectOption(campaignId);
  await win.locator('[data-silk-adventure-start]').click();
  await expect(win.locator('[data-silk-checkout]')).toContainText('Chapter 1');
  await expect(win.locator('[data-silk-checkout]')).toContainText('Phileasson-Saga');
  await expect(win.locator('[data-silk-adventure-start]')).toHaveCount(0);

  const binding = await silk(gm, ({ session }) => session.workingCopy.binding);
  const checkout = binding?.checkout as { adventure: string };
  const main = (await fetchJson(gm, `/silk/${canonId}/refs/main.json`)) as { head: string };
  expect(
    await fetchJson(gm, `/silk/${canonId}/refs/adventures/${checkout.adventure}.json`),
  ).toEqual({
    id: checkout.adventure,
    name: 'Chapter 1',
    campaignId,
    base: main.head,
    head: main.head,
  });
});
