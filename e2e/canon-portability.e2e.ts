import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Session } from '../src/adapter/session';
import type { CommandRegistry } from '../src/core/commands/registry';
import type { ImportResult } from '../src/core/canon';
import { expect as baseExpect, test } from './fixtures';

// Export and import do many sequential FilePicker round trips; slow on a loaded machine.
const expect = baseExpect.configure({ timeout: 30_000 });

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

const fetchText = (page: Page, path: string) =>
  page.evaluate(async (p) => (await fetch(p, { cache: 'no-store' })).text(), path);

/** Upload `text` as a Data file via FilePicker. */
const upload = (page: Page, dir: string, name: string, text: string) =>
  page.evaluate(
    async ([d, n, t]) => {
      const FP = foundry.applications.apps.FilePicker.implementation;
      await FP.createDirectory('data', d).catch(() => undefined);
      await FP.upload('data', d, new File([t], n), {}, { notify: false });
    },
    [dir, name, text] as const,
  );

/** See e2e/canon-window.e2e.ts: DSA5 skin dialog and the welcome tour block input. */
async function closePopups(page: Page) {
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout')) el.remove();
  });
}

/** Confirm the open Silk portability dialog (Foundry DialogV2 "Yes"). */
async function confirmDialog(page: Page, text?: RegExp) {
  const dialog = page.locator('.application:has([data-silk-portability-dialog])').last();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  if (text) await expect(dialog).toContainText(text);
  // The next dialog may open right away: wait for this one by id.
  const id = await dialog.getAttribute('id');
  await dialog.locator('button[data-action="yes"]').click();
  await expect(page.locator(`[id="${id}"]`)).toHaveCount(0);
}

/** `canon.import` through the command API with zip bytes; resolves after dialogs are answered. */
function importBytes(page: Page, path: string) {
  return silk(
    page,
    ({ api }, bytes) =>
      api.run<ImportResult | null>('canon.import', { file: new Uint8Array(bytes) }),
    [...readFileSync(path)],
  );
}

test('Canon Backup and Share: export, import round-trip with assets', async ({ gm }) => {
  test.setTimeout(240_000);
  await gm.waitForFunction(() => {
    try {
      (game.modules?.get('silk') as unknown as { session(): unknown }).session();
      return true;
    } catch {
      return false;
    }
  });
  const run = Date.now().toString(36);
  const dir = `silk-e2e-${run}`;
  await upload(gm, dir, 'hero.png', 'hero v1');
  const canonId = await silk(gm, async ({ api, session }) => {
    const bound = session.workingCopy.binding;
    if (bound) return bound.canonId;
    return (await api.run<{ canonId: string }>('canon.create', { name: 'E2E' })).canonId;
  });
  const backedUp = await silk(
    gm,
    async ({ api, session }, img) => {
      await session.workingCopy.set([
        { kind: 'element', id: 'el-t27', data: { name: 'T27', img } },
      ]);
      return api.run<string>('history.commit', { label: 'T27 backup' });
    },
    `${dir}/hero.png`,
  );

  await closePopups(gm);
  await silk(gm, ({ api }) => api.run('canon.openWindow'));
  const win = gm.locator('[data-silk-canon]');
  await expect(win.locator('[data-silk-portability]')).toBeVisible();

  // Backup through the UI: summary dialog with the orphan count, then a download.
  const backupDownload = gm.waitForEvent('download');
  await win.locator('[data-silk-canon-backup]').click();
  await confirmDialog(gm, /garbage collection|Aufräumen/);
  const backupPath = `${test.info().outputPath('backup.zip')}`;
  await (await backupDownload).saveAs(backupPath);
  expect((await backupDownload).suggestedFilename()).toMatch(/^silk-backup-.*\.zip$/);

  // Re-importing the same Backup through the UI is a fast-forward; the asset is identical.
  // Permanent notices (file browser, hardware acceleration) would hold the queue.
  await gm.evaluate(() => ui.notifications?.clear());
  await win.locator('[data-silk-canon-import]').setInputFiles(backupPath);
  await expect(gm.locator('#notifications')).toContainText(canonId, { timeout: 60_000 });

  // Local main moves on and the asset changes: the Backup has diverged.
  await silk(gm, async ({ api, session }) => {
    await session.workingCopy.set([{ kind: 'element', id: 'el-t27b', data: { name: 'later' } }]);
    await api.run('history.commit', { label: 'T27 later' });
  });
  await upload(gm, dir, 'hero.png', 'hero v2');
  const copy = importBytes(gm, backupPath);
  await confirmDialog(gm, /copy|Kopie/); // import as copy
  await confirmDialog(gm, new RegExp(`${dir}/hero.png`)); // overwrite the changed asset
  const copied = await copy;
  expect(copied).toMatchObject({ mode: 'copy', assets: { overwritten: [`${dir}/hero.png`] } });
  expect(copied?.canonId).not.toBe(canonId);
  expect(JSON.parse(await fetchText(gm, `/silk/${copied?.canonId}/refs/main.json`))).toEqual({
    head: backedUp,
  });
  expect(await fetchText(gm, `/${dir}/hero.png`)).toBe('hero v1');

  // Share the head through the UI, import it: a new Canon with one root Commit.
  await upload(gm, dir, 'hero.png', 'hero v3');
  await silk(
    gm,
    async ({ api, session }, img) => {
      await session.workingCopy.set([
        { kind: 'element', id: 'el-t27', data: { name: 'T27 shared', img } },
      ]);
      await api.run('history.commit', { label: 'T27 share' });
    },
    `${dir}/hero.png`,
  );
  await silk(gm, ({ api }) => api.run('canon.openWindow'));
  const shareDownload = gm.waitForEvent('download');
  await win.locator('[data-silk-canon-share]').click();
  await confirmDialog(gm);
  const sharePath = test.info().outputPath('share.zip');
  await (await shareDownload).saveAs(sharePath);

  // The server's file now differs from the Share's: written under a hashed name.
  await upload(gm, dir, 'hero.png', 'hero v4');
  const shared = await importBytes(gm, sharePath);
  expect(shared).toMatchObject({ mode: 'new' });
  expect(shared?.assets.renamed).toEqual([
    {
      from: `${dir}/hero.png`,
      to: expect.stringMatching(new RegExp(`^${dir}/hero\\.silk-[0-9a-f]{8}\\.png$`)),
    },
  ]);
  const renamed = shared?.assets.renamed[0]?.to ?? '';
  expect(await fetchText(gm, `/${renamed}`)).toBe('hero v3');
  const head = (
    JSON.parse(await fetchText(gm, `/silk/${shared?.canonId}/refs/main.json`)) as {
      head: string;
    }
  ).head;
  const commit = JSON.parse(
    await fetchText(gm, `/silk/${shared?.canonId}/commits/${head}.json`),
  ) as {
    parents: string[];
    label: string;
  };
  expect(commit).toMatchObject({ parents: [], label: 'T27 share' });
});
