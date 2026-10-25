/** Event Scenes against real Foundry/dsa5 (spec §4 Event Scenes, §6, §7 present at ↔ tokens). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
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
}

const create = async (page: Page, cls: string, name: string, from?: string) =>
  (
    await api<{ id: string }>(page, 'element.create', {
      class: cls,
      name,
      ...(from ? { from } : {}),
    })
  ).id;

/** The element's Scene and journal link, as Foundry has them. */
const sceneOf = (page: Page, id: string) =>
  page.evaluate((elementId) => {
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    const el = wc?.get(elementId)?.data as any;
    const journal = el?.uuid ? (fromUuidSync(el.uuid) as any) : null;
    const scene = (game.scenes as any)?.find((s: any) => s.flags.silk?.sceneOf === elementId);
    return {
      link: journal?.flags.silk?.scene ?? null,
      status: (el?.status as string | undefined) ?? null,
      scene: scene
        ? {
            id: scene.id as string,
            name: scene.name as string,
            grid: scene.grid.type as number,
            drawings: scene.drawings.size as number,
            active: scene.active as boolean,
            tokens: scene.tokens.map((t: any) => ({ actorId: t.actorId, hidden: t.hidden })),
          }
        : null,
    };
  }, id);

const actorId = (page: Page, id: string) =>
  page.evaluate((elementId) => {
    const uuid = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data['uuid'];
    return (fromUuidSync(uuid as string) as any).id as string;
  }, id);

const presentAt = (page: Page, event: string) =>
  page.evaluate((eventId) => {
    const records = game.modules?.get('silk')?.session?.().workingCopy.records() as Map<
      string,
      any
    >;
    return [...records.values()]
      .filter(
        (r) => r.kind === 'connection' && r.data.type === 'presentAt' && r.data.to === eventId,
      )
      .map((r) => r.data.from as string)
      .sort();
  }, event);

test('Event Scene: Narrative preset, present at ↔ hidden tokens, Happened, deletion', async ({
  gm,
}) => {
  test.setTimeout(180_000);
  await ready(gm);

  // Create Event → Scene from the Narrative preset, linked from the journal.
  const ambush = await create(gm, 'event', 'Scene Ambush');
  await expect.poll(async () => (await sceneOf(gm, ambush)).scene?.name).toBe('Scene Ambush');
  const first = await sceneOf(gm, ambush);
  expect(first.scene).toMatchObject({ grid: 0, drawings: 1, active: false });
  expect(first.link).toBe(first.scene?.id);

  // Add present at → one hidden token.
  const alrik = await create(gm, 'person', 'Scene Alrik', ambush);
  const alrikActor = await actorId(gm, alrik);
  await expect
    .poll(async () => (await sceneOf(gm, ambush)).scene?.tokens)
    .toEqual([{ actorId: alrikActor, hidden: true }]);

  // Place a token in Foundry → present at; remove it → present at gone.
  const wolf = await create(gm, 'creature', 'Scene Wolf');
  const wolfActor = await actorId(gm, wolf);
  const tokenId = await gm.evaluate(
    async ([sceneId, aId]) => {
      const scene = game.scenes?.get(sceneId) as any;
      const actor = game.actors?.get(aId) as any;
      const token = await actor.getTokenDocument({ x: 1500, y: 1500 }, { parent: scene });
      const [created] = await scene.createEmbeddedDocuments('Token', [token.toObject()]);
      return created.id as string;
    },
    [first.scene?.id as string, wolfActor] as const,
  );
  await expect.poll(() => presentAt(gm, ambush)).toEqual([alrik, wolf].sort());
  await gm.evaluate(
    async ([sceneId, id]) =>
      (game.scenes?.get(sceneId) as any).deleteEmbeddedDocuments('Token', [id]),
    [first.scene?.id as string, tokenId] as const,
  );
  await expect.poll(() => presentAt(gm, ambush)).toEqual([alrik]);

  // Journal: Scene link + Activate (GM). Activate → active + Happened.
  await api(gm, 'element.openSheet', { id: ambush });
  const bar = gm.locator('[data-silk-scene-bar]').first();
  await expect(bar.locator('[data-silk-scene-link]')).toContainText('Scene Ambush');
  // dispatchEvent: a real click on the journal sheet never settles here (Playwright hangs).
  await bar.locator('[data-silk-activate-scene]').dispatchEvent('click');
  await expect
    .poll(async () => (await sceneOf(gm, ambush)).scene?.active, { timeout: 30_000 })
    .toBe(true);
  await expect.poll(async () => (await sceneOf(gm, ambush)).status).toBe('happened');

  // Delete the Scene in Foundry → "no Scene" with Create / Restore; present at stays.
  await gm.evaluate((id) => (game.scenes?.get(id) as any).delete(), first.scene?.id as string);
  await expect.poll(async () => (await sceneOf(gm, ambush)).link).toBeNull();
  expect(await presentAt(gm, ambush)).toEqual([alrik]);
  await api(gm, 'element.openSheet', { id: ambush });
  const none = gm.locator('[data-silk-scene-bar]').first();
  await expect(none.locator('[data-silk-no-scene]')).toBeVisible();
  await expect(none.locator('[data-silk-restore-scene]')).toBeVisible();
  await none.locator('[data-silk-create-scene]').dispatchEvent('click');
  await expect
    .poll(async () => (await sceneOf(gm, ambush)).scene?.tokens, { timeout: 30_000 })
    .toEqual([{ actorId: alrikActor, hidden: true }]);
  const fresh = await sceneOf(gm, ambush);
  expect(fresh.scene?.id).not.toBe(first.scene?.id);
  expect(fresh.link).toBe(fresh.scene?.id);
});
