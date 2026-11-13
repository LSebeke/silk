/**
 * Source Step Generator, NSC Zucht (spec 1.1 §B.3), against the real dsa5-mastersworkshop
 * when it is installed locally (it is a paid module: skipped otherwise).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { FOUNDRY_USER_DATA } from './harness';

const MODULES = ['dsa5-core', 'dsa5-mastersworkshop'];
const installed = MODULES.every((id) => existsSync(join(FOUNDRY_USER_DATA, 'Data/modules', id)));

test.use({ worldKey: 'nsc-zucht', modules: installed ? MODULES : [] });
test.skip(!installed, 'dsa5-mastersworkshop is not installed locally');

const api = (page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [name, args] as const);

async function ready(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('garn')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(() => game.settings?.set('garn', 'materializeMode', 'onDemand'));
}

const elements = (page: Page) =>
  page.evaluate(() =>
    [...(game.modules?.get('garn')?.session?.().workingCopy.records().values() ?? [])]
      .filter((r) => r.kind === 'element')
      .map((r) => ({ id: r.id, data: r.data as Record<string, any> })),
  );

/** The NPC generator window (ApplicationV2 subclass `NPCGenerator`). */
const generatorOpen = (page: Page) =>
  page.evaluate(() =>
    [...foundry.applications.instances.values()].some(
      (app) => app.constructor.name === 'NPCGenerator' && app.rendered,
    ),
  );

test('Generator: open from the compass, generate, bind the Actor on demand; closing returns', async ({
  gm,
}) => {
  test.setTimeout(240_000);
  await ready(gm);
  // The installed content packs ship cultures and professions but no species items. Two:
  // the generator's "random" loops forever on a select with a single option.
  await gm.evaluate(async () => {
    if (!game.items?.some((i) => (i.type as string) === 'species'))
      await Item.implementation.create([
        { name: 'Human', type: 'species' },
        { name: 'Elf', type: 'species' },
      ] as never);
  });
  await api(gm, 'canvas.open');
  const canvas = gm.locator('[data-garn-canvas]');
  await expect(canvas).toBeVisible();
  const compass = gm.locator('[data-garn-source-step]');
  const generator = gm.locator('[data-garn-source-choice="generator"]');

  // Available: GM, module active, import probe passed.
  await canvas.focus();
  await gm.keyboard.press('Digit1');
  await expect(compass).toHaveAttribute('data-garn-source-step', 'person');
  await expect(generator).toHaveAttribute('aria-disabled', 'false');

  // Closed without generating → back to the Source Step, nothing created.
  await gm.keyboard.press('ArrowLeft');
  await expect.poll(() => generatorOpen(gm), { timeout: 60_000 }).toBe(true);
  await gm.evaluate(async () => {
    for (const app of foundry.applications.instances.values())
      if (app.constructor.name === 'NPCGenerator') await app.close();
  });
  await expect(compass).toHaveAttribute('data-garn-source-step', 'person');
  await expect(generator).toHaveAttribute('aria-disabled', 'false');
  expect(await elements(gm)).toHaveLength(0);

  // Generate: the created Actor becomes the element; the generator closes.
  const actorsBefore = await gm.evaluate(() => game.actors?.size ?? 0);
  await generator.click();
  await expect.poll(() => generatorOpen(gm), { timeout: 60_000 }).toBe(true);
  // "Entirely random" fills name, species, culture and profession; then generate.
  // (Clicked in the page: the generator's handlers keep Playwright's click waiting.)
  const click = (action: string) =>
    gm.evaluate(
      (a) => (document.querySelector(`[data-action="${a}"]`) as HTMLElement).click(),
      action,
    );
  await click('rollAll');
  await expect
    .poll(() =>
      gm.evaluate(() =>
        ['npcname', 'species', 'culture', 'career'].every(
          (n) => !!(document.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value,
        ),
      ),
    )
    .toBe(true);
  await click('generateNPC');
  const nameInput = gm.locator('[data-garn-name-input]');
  await expect(nameInput).toBeFocused({ timeout: 90_000 });
  await expect.poll(() => generatorOpen(gm)).toBe(false);
  const prefilled = await nameInput.inputValue();
  expect(prefilled.length).toBeGreaterThan(0);
  await gm.keyboard.press('Enter');
  await expect(nameInput).toHaveCount(0);

  const [el] = await elements(gm);
  expect(el?.data).toMatchObject({
    class: 'person',
    name: prefilled,
    source: { kind: 'generator', id: 'nsc-zucht' },
  });
  // Materialized at once despite on-demand mode: bound, not copied.
  expect(el?.data['uuid']).toBe(el?.data['source'].actorUuid);
  expect(await gm.evaluate(() => game.actors?.size ?? 0)).toBe(actorsBefore + 1);
  const bound = await gm.evaluate((uuid) => {
    const actor = fromUuidSync(uuid) as any;
    const companion = game.journal?.get(actor.flags.garn.companion) as any;
    return {
      name: actor.name,
      type: actor.type,
      garnId: actor.flags.garn.id,
      folder: actor.folder?.name,
      ownership: actor.ownership.default,
      items: actor.items.size,
      hooded: actor.img === actor.flags.garn.hood,
      companionOf: companion?.flags.garn.companionOf,
      pages: [...(companion?.pages ?? [])]
        .sort((a: any, b: any) => a.sort - b.sort)
        .map((p: any) => ({ name: p.name, appearance: !!p.flags.garn?.appearance })),
    };
  }, el?.data['uuid'] as string);
  expect(bound).toMatchObject({
    name: prefilled,
    type: 'npc',
    garnId: el?.id,
    ownership: 0,
    hooded: true,
    companionOf: el?.id,
  });
  expect(bound.items).toBeGreaterThan(0);
  expect(bound.pages[0]).toEqual({ name: 'Appearance', appearance: true });
  expect(bound.pages.map((p) => p.name)).toContain('Connections');
});
