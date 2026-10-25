/** Unmaterialize, Foundry-side deletion, element delete, reconcile on real dsa5 (spec §6, §7). */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate over untyped dsa5/Foundry docs */
import type { Page } from '@playwright/test';
import { expect, test, waitForSilk } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const record = (page: Page, id: string) =>
  page.evaluate(
    (i) =>
      (game.modules?.get('silk')?.session?.().workingCopy.get(i)?.data ?? null) as Record<
        string,
        any
      > | null,
    id,
  );

async function ready(page: Page) {
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  await page.evaluate(async () => {
    await game.settings?.set('silk', 'materializeMode', 'immediate');
    await game.settings?.set('silk', 'confirmDelete', false);
  });
}

const create = async (page: Page, cls: string, name: string) =>
  (await api<{ id: string }>(page, 'element.create', { class: cls, name })).id;

/** Actor of the element plus its Companion Journal, or nulls. */
const docs = (page: Page, id: string) =>
  page.evaluate((elementId) => {
    const data = game.modules?.get('silk')?.session?.().workingCopy.get(elementId)?.data;
    const actor = data?.['uuid'] ? (fromUuidSync(data['uuid'] as string) as any) : null;
    const companion = actor ? (game.journal?.get(actor.flags.silk.companion) as any) : null;
    return {
      uuid: (data?.['uuid'] as string | undefined) ?? null,
      actor: actor && {
        name: actor.name,
        items: [...actor.items].map((i: any) => i.name),
        wounds: actor.system.status.wounds.value,
      },
      companion: companion && {
        id: companion.id,
        pages: [...companion.pages].map((p: any) => p.name).sort(),
      },
    };
  }, id);

test('Unmaterialize snapshots the dsa5 actor; Materialize restores it', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const id = await create(gm, 'person', 'Alrik');
  const before = await docs(gm, id);
  await gm.evaluate(async (uuid) => {
    const actor = fromUuidSync(uuid) as any;
    await actor.createEmbeddedDocuments('Item', [{ name: 'Langschwert', type: 'equipment' }]);
    await actor.update({ 'system.status.wounds.value': 3 });
  }, before.uuid as string);

  await api(gm, 'materialize.unmaterialize', { ids: [id] });
  await expect.poll(async () => (await docs(gm, id)).uuid).toBeNull();
  const gone = await gm.evaluate(
    ([uuid, companion]) => ({
      actor: !!fromUuidSync(uuid),
      companion: !!game.journal?.get(companion),
    }),
    [before.uuid as string, before.companion?.id as string] as const,
  );
  expect(gone).toEqual({ actor: false, companion: false });
  const sheet = await record(gm, `${id}-sheet`);
  expect(sheet?.['doc']?.items?.map((i: any) => i.name)).toEqual(['Langschwert']);

  await api(gm, 'element.rename', { id, name: 'Alrik the Bold' });
  await api(gm, 'materialize.elements', { ids: [id] });
  const after = await docs(gm, id);
  expect(after.actor).toEqual({ name: 'Alrik the Bold', items: ['Langschwert'], wounds: 3 });
  expect(after.companion).toEqual(before.companion);
});

test('Foundry-side deletion: doc → Ghost; Companion Journal → restored', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const id = await create(gm, 'creature', 'Wolf');
  const first = await docs(gm, id);
  await gm.evaluate((cid) => (game.journal?.get(cid) as any).delete(), first.companion?.id ?? '');
  await expect.poll(async () => (await docs(gm, id)).companion).toEqual(first.companion);

  await gm.evaluate((uuid) => (fromUuidSync(uuid) as any).delete(), first.uuid as string);
  await expect.poll(async () => (await record(gm, id))?.['uuid'] ?? null).toBeNull();
  expect((await record(gm, id))?.['name']).toBe('Wolf');
  expect(await gm.evaluate((cid) => !!game.journal?.get(cid), first.companion?.id ?? '')).toBe(
    false,
  );
  expect((await record(gm, `${id}-sheet`))?.['documentName']).toBe('Actor');
});

test('element.delete: confirm dialog; Adopted keeps its doc unflagged', async ({ gm }) => {
  test.setTimeout(120_000);
  await ready(gm);
  const a = await create(gm, 'person', 'Doomed');
  const b = await create(gm, 'location', 'Keep');
  const { id: link } = await api<{ id: string }>(gm, 'connection.create', { from: a, to: b });
  const doomed = await docs(gm, a);

  await gm.evaluate(() => game.settings?.set('silk', 'confirmDelete', true));
  const run = api(gm, 'element.delete', { ids: [a] });
  const dialog = gm.locator('.application.dialog', { hasText: 'Doomed' });
  await expect(dialog).toBeVisible();
  await dialog.locator('button[data-action="delete"]').click();
  expect(await run).toEqual({ ids: [a] });
  expect(await record(gm, a)).toBeNull();
  expect(await record(gm, link)).toBeNull();
  expect(
    await gm.evaluate(([uuid, cid]) => !!fromUuidSync(uuid) || !!game.journal?.get(cid), [
      doomed.uuid as string,
      doomed.companion?.id as string,
    ] as const),
  ).toBe(false);

  // Adopted (T14 sets the flag): Keep Foundry doc is the default answer.
  const kept = (await record(gm, b))?.['uuid'] as string;
  await gm.evaluate(async (id) => {
    const wc = game.modules?.get('silk')?.session?.().workingCopy;
    const rec = wc?.get(id);
    if (rec) await wc?.set([{ ...rec, data: { ...rec.data, adopted: true } }]);
  }, b);
  const run2 = api(gm, 'element.delete', { ids: [b] });
  const dialog2 = gm.locator('.application.dialog', { hasText: 'Keep' });
  await expect(dialog2.locator('button[data-action="everything"]')).toBeVisible();
  await dialog2.locator('[data-silk-dont-ask]').check();
  await dialog2.locator('button[data-action="keep"]').click();
  await run2;
  const state = await gm.evaluate((uuid) => {
    const doc = fromUuidSync(uuid) as any;
    return { exists: !!doc, silk: doc?.flags?.silk ?? null };
  }, kept);
  expect(state).toEqual({ exists: true, silk: null });
  expect(await gm.evaluate(() => game.settings?.get('silk', 'confirmDelete'))).toBe(false);
});

test('reconcile on load restores a doc deleted behind Silk’s back from the last Commit', async ({
  gm,
}) => {
  test.setTimeout(150_000);
  await ready(gm);
  await gm.evaluate(async () => {
    const silk = game.modules?.get('silk');
    if (!silk?.session?.().workingCopy.binding)
      await silk?.api?.run('canon.create', { name: 'T9' });
  });
  const id = await create(gm, 'item', 'Ring');
  const uuid = (await record(gm, id))?.['uuid'] as string;
  const hash = await api<string>(gm, 'history.commit', { label: 'before loss' });
  // A delete Silk never hears about (its own write tag makes the hooks skip it).
  await gm.evaluate((u) => (fromUuidSync(u) as any).delete({ silk: { internal: true } }), uuid);
  expect((await record(gm, id))?.['uuid']).toBe(uuid);

  await gm.reload();
  await waitForSilk(gm);
  await ready(gm);
  await expect.poll(async () => (await record(gm, id))?.['restoredFrom'] ?? null).toBe(hash);
  expect((await record(gm, id))?.['uuid']).toBeUndefined();
  expect((await record(gm, `${id}-sheet`))?.['doc']?.name).toBe('Ring');
});
