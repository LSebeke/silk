/**
 * Image & token editor against real Foundry (v1.1 §G.3): opened from Element Detail, hooded
 * Person: the ring and Lock rotation apply at once, the hood goes through the subject crop (an
 * uploaded subject file, #171), the position waits in `flags.garn.pose`, Reset clears it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('garn')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

async function ready(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('garn')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async () => {
    const wc = game.modules?.get('garn')?.session?.().workingCopy;
    await wc?.delete([...(wc.records().keys() ?? [])]);
    await game.settings?.set('garn', 'materializeMode', 'immediate');
  });
}

/** The actor's prototype token and Garn flags. */
const actor = (page: Page, id: string) =>
  page.evaluate((i) => {
    const uuid = game.modules?.get('garn')?.session?.().workingCopy.get(i)?.data['uuid'];
    const doc = fromUuidSync(uuid as string) as any;
    const t = doc.prototypeToken;
    return {
      img: doc.img as string,
      src: t.texture.src as string,
      anchorX: t.texture.anchorX as number,
      scaleX: t.texture.scaleX as number,
      ring: t.ring.enabled as boolean,
      subject: t.ring.subject.texture as string | null,
      lockRotation: t.lockRotation as boolean,
      pose: doc.flags.garn?.pose as object | undefined,
      hood: doc.flags.garn?.hood as string | undefined,
    };
  }, id);

test('Image & token editor: hooded Person, ring at once, position waits, Reset', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const { id } = await api<{ id: string }>(gm, 'element.create', {
    class: 'person',
    name: 'Alrik',
    at: { x: 200, y: 200 },
  });
  await api(gm, 'element.setImage', { id, img: 'icons/svg/cowled.svg' });
  await expect.poll(async () => (await actor(gm, id)).hood).toBeTruthy();
  const hood = (await actor(gm, id)).hood;

  await api(gm, 'element.openDetail', { id });
  await gm.locator(`[data-garn-detail="${id}"] [data-garn-detail-image-editor]`).click();
  const editor = gm.locator(`[data-garn-image-editor="${id}"]`);
  await expect(editor.locator('[data-garn-image-hooded]')).toBeVisible();

  await editor.locator('[data-garn-image-ring-enabled]').check();
  await expect.poll(async () => (await actor(gm, id)).ring).toBe(true);
  // The hood goes through the subject crop: its own file; the texture keeps its scale (#168).
  await expect
    .poll(async () => (await actor(gm, id)).subject)
    .toMatch(/^garn\/[^/]+\/tokens\/[^/]+-[0-9a-f]{16}\.webp$/);
  const hoodSubject = (await actor(gm, id)).subject as string;
  expect(await gm.evaluate(async (p) => (await fetch(p)).ok, hoodSubject)).toBe(true);
  expect((await actor(gm, id)).scaleX).toBe(1);
  // The preview shows the world ring style (#135).
  await expect(editor.locator('[data-garn-image-preview-ring]')).toBeVisible();

  // Lock rotation applies at once, hooded or not (#136).
  await editor.locator('[data-garn-image-lock-rotation]').check();
  await expect.poll(async () => (await actor(gm, id)).lockRotation).toBe(true);

  // Scale up to 8 (#137); a square image at scale 1 fills the ring and cannot move.
  await editor.locator('[data-garn-image-scale]').fill('2');

  const preview = editor.locator('[data-garn-image-preview]');
  const box = await preview.boundingBox();
  if (!box) throw new Error('no preview');
  await gm.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await gm.mouse.down();
  await gm.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
  await gm.mouse.up();
  await expect.poll(async () => (await actor(gm, id)).pose).toBeTruthy();
  const posed = await actor(gm, id);
  expect(posed.pose).toMatchObject({ scale: 2 });
  // Players keep seeing the hood, centred: the same hood subject.
  expect(posed).toMatchObject({ img: hood, src: hood, anchorX: 0.5, subject: hoodSubject });

  await editor.locator('[data-garn-image-reset]').click();
  await expect.poll(async () => (await actor(gm, id)).pose).toBeUndefined();
});
