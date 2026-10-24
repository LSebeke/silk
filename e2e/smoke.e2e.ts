import { expect, test } from './fixtures';

test('silk loads with its api for GM and player', async ({ gm, player }) => {
  for (const page of [gm, player]) {
    const state = await page.evaluate(() => {
      const silk = game.modules?.get('silk');
      return { active: silk?.active, hasRun: typeof silk?.api?.run === 'function' };
    });
    expect(state).toEqual({ active: true, hasRun: true });
  }
  expect(await gm.evaluate(() => game.user?.isGM)).toBe(true);
  expect(await player.evaluate(() => game.user?.isGM)).toBe(false);
});
