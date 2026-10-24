import type { Page } from '@playwright/test';
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

const state = (page: Page) =>
  silk(page, ({ session }) => ({
    binding: session.workingCopy.binding,
    ids: [...session.workingCopy.records().keys()].sort(),
  }));

const waitForIds = (page: Page, ids: string[]) =>
  expect.poll(async () => (await state(page)).ids, { timeout: 10_000 }).toEqual(ids);

test('bind a Canon, sync the working copy to players, commit and discard', async ({
  gm,
  player,
}) => {
  expect((await state(gm)).binding).toBeNull();

  // Hidden journal in the internal folder, NONE for players.
  const journal = await gm.evaluate(() => {
    const j = game.journal?.find(
      (e) => (e.flags as { silk?: { workingCopy?: boolean } }).silk?.workingCopy === true,
    );
    return { folder: j?.folder?.name, ownership: j?.ownership.default };
  });
  expect(journal).toEqual({ folder: 'Silk (internal)', ownership: 0 });

  const { canonId } = await silk(gm, ({ api }) =>
    api.run<{ canonId: string }>('canon.create', { name: 'E2E' }),
  );
  expect(canonId).toMatch(/^[0-9a-f]{32}$/);
  await expect(
    silk(gm, ({ api }, id) => api.run('canon.bind', { canonId: id }), canonId),
  ).rejects.toThrow(/bound/);

  // GM writes records; the player's client receives them.
  await silk(gm, ({ session }) =>
    session.workingCopy.set([
      { kind: 'element', id: 'el-a', data: { name: 'A' } },
      { kind: 'element', id: 'el-b', data: { name: 'B' } },
    ]),
  );
  await waitForIds(player, ['el-a', 'el-b']);
  await expect(
    silk(player, ({ session }) =>
      session.workingCopy.set([{ kind: 'element', id: 'x', data: {} }]),
    ),
  ).rejects.toThrow(/active GM/);

  // Commit lands under Data/silk/<id>/ and is readable back over HTTP.
  const head = await silk(gm, ({ api }) => api.run<string>('history.commit', { label: 'One' }));
  const main = await gm.evaluate(
    async (id) => (await fetch(`/silk/${id}/refs/main.json`, { cache: 'no-store' })).json(),
    canonId,
  );
  expect(main).toEqual({ head });

  // Delete reaches the player; discard restores it.
  await silk(gm, ({ session }) => session.workingCopy.delete(['el-b']));
  await waitForIds(player, ['el-a']);
  await silk(gm, ({ api }) => api.run('history.discard'));
  await waitForIds(player, ['el-a', 'el-b']);

  // Survives a reload.
  await gm.reload();
  await gm.waitForFunction(() => game.ready === true);
  expect(await state(gm)).toEqual({
    binding: { canonId, checkout: { main: true }, head },
    ids: ['el-a', 'el-b'],
  });
});
