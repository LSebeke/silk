import type { Page } from '@playwright/test';
import type { Session } from '../src/adapter/session';
import type { CommandRegistry } from '../src/core/commands/registry';
import { expect, test, waitForGarn } from './fixtures';

/** Runs `fn` in the page with Garn's api and session. */
function garn<A, R>(
  page: Page,
  fn: (s: { api: CommandRegistry; session: Session }, arg: A) => R | Promise<R>,
  arg?: A,
): Promise<R> {
  return page.evaluate(
    ([src, a]) => {
      const mod = game.modules?.get('garn') as unknown as {
        api: CommandRegistry;
        session(): Session;
      };
      const f = new Function(`return (${src})`)() as typeof fn;
      return f({ api: mod.api, session: mod.session() }, a as A);
    },
    [fn.toString(), arg] as const,
  );
}

const state = (page: Page) =>
  garn(page, ({ session }) => ({
    binding: session.workingCopy.binding,
    ids: [...session.workingCopy.records().keys()].sort(),
  }));

// Socket delivery to the player takes seconds under load: use the configured timeout.
const waitForIds = (page: Page, ids: string[]) =>
  expect.poll(async () => (await state(page)).ids).toEqual(ids);

// Needs an unbound World: other files bind the shared one.
test.use({ worldKey: 'canon-binding' });

test('bind a Canon, sync the working copy to players, commit and discard', async ({
  gm,
  player,
}) => {
  expect((await state(gm)).binding).toBeNull();

  // Hidden journal in the internal folder, NONE for players.
  const journal = await gm.evaluate(() => {
    const j = game.journal?.find(
      (e) => (e.flags as { garn?: { workingCopy?: boolean } }).garn?.workingCopy === true,
    );
    return { folder: j?.folder?.name, ownership: j?.ownership.default };
  });
  expect(journal).toEqual({ folder: 'Garn (internal)', ownership: 0 });

  // v1.1 §H: unbound, the canvas offers "No Canon yet" → Canon window; bound, the Canon chip.
  await garn(gm, ({ api }) => api.run('canvas.open'));
  const noCanon = gm.locator('[data-garn-no-canon]');
  await expect(noCanon).toBeVisible();
  await noCanon.locator('[data-garn-action="open-canon"]').click();
  await expect(gm.locator('#garn-canon')).toBeVisible();

  const { canonId } = await garn(gm, ({ api }) =>
    api.run<{ canonId: string }>('canon.create', { name: 'E2E' }),
  );
  await expect(noCanon).toHaveCount(0);
  await expect(gm.locator('[data-garn-canon-chip]')).toHaveText('E2E · main');
  await gm.evaluate(async () => {
    await foundry.applications.instances.get('garn-canon')?.close();
    // Toasts sit over the toolbar's top right.
    document.getElementById('notifications')?.style.setProperty('display', 'none');
  });
  await expect(gm.locator('#garn-canon')).toHaveCount(0);
  await gm.locator('[data-garn-canon-chip]').click();
  await expect(gm.locator('#garn-canon')).toBeVisible();

  // Module Settings: "Open Canon window" (GM).
  await gm.evaluate(async () => {
    await foundry.applications.instances.get('garn-canon')?.close();
    await new foundry.applications.settings.SettingsConfig().render({ force: true });
  });
  await expect(gm.locator('#garn-canon')).toHaveCount(0);
  await gm.locator('#settings-config [data-tab="garn"]').first().click();
  await gm.locator('button[data-action="openSubmenu"][data-key="garn.canonWindow"]').click();
  await expect(gm.locator('#garn-canon')).toBeVisible();
  expect(canonId).toMatch(/^[0-9a-f]{32}$/);
  await expect(
    garn(gm, ({ api }, id) => api.run('canon.bind', { canonId: id }), canonId),
  ).rejects.toThrow(/bound/);

  // GM writes records; the player's client receives them.
  await garn(gm, ({ session }) =>
    session.workingCopy.set([
      { kind: 'element', id: 'el-a', data: { name: 'A' } },
      { kind: 'element', id: 'el-b', data: { name: 'B' } },
    ]),
  );
  await waitForIds(player, ['el-a', 'el-b']);
  await expect(
    garn(player, ({ session }) =>
      session.workingCopy.set([{ kind: 'element', id: 'x', data: {} }]),
    ),
  ).rejects.toThrow(/active GM/);

  // Commit lands under Data/garn/<id>/ and is readable back over HTTP.
  const head = await garn(gm, ({ api }) => api.run<string>('history.commit', { label: 'One' }));
  const main = await gm.evaluate(
    async (id) => (await fetch(`/garn/${id}/refs/main.json`, { cache: 'no-store' })).json(),
    canonId,
  );
  expect(main).toEqual({ head });

  // Delete reaches the player; discard restores it.
  await garn(gm, ({ session }) => session.workingCopy.delete(['el-b']));
  await waitForIds(player, ['el-a']);
  await garn(gm, ({ api }) => api.run('history.discard'));
  await waitForIds(player, ['el-a', 'el-b']);

  // Survives a reload.
  await gm.reload();
  await waitForGarn(gm);
  expect(await state(gm)).toEqual({
    binding: { canonId, checkout: { main: true }, head },
    ids: ['el-a', 'el-b'],
  });
});
