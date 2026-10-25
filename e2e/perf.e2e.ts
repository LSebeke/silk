/**
 * Perf checks (spec §14), tagged `@perf`: local only, not in the default e2e run. Needs a
 * build with the dev commands: `npm run test:perf` (SILK_DEV=1 build + SILK_PERF=1).
 */
import type { Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CanonRecord } from '../src/core/canon';
import { benchVerdict, type BenchFile, type BenchResult } from '../src/core/dev/bench';
import { expect, test } from './fixtures';

const api = <T = unknown>(page: Page, name: string, args: object = {}) =>
  page.evaluate(([n, a]) => game.modules?.get('silk')?.api?.run(n, a), [
    name,
    args,
  ] as const) as Promise<T>;

const records = (page: Page, kind: string): Promise<CanonRecord[]> =>
  page.evaluate((k) => {
    const all = game.modules?.get('silk')?.session?.().workingCopy.records();
    return [...(all?.values() ?? [])].filter((r) => r.kind === k);
  }, kind);

async function ready(page: Page) {
  // `game.ready` precedes Silk's async `ready` hook: wait for the session.
  await page.waitForFunction(() => {
    try {
      return !!game.modules?.get('silk')?.session?.();
    } catch {
      return false;
    }
  });
  const dev = await page.evaluate(
    () => !!game.modules?.get('silk')?.api?.get('dev.fixture.generate'),
  );
  if (!dev) throw new Error('dev commands missing: run `npm run test:perf` (SILK_DEV=1 build)');
}

const closeCanvas = (page: Page) =>
  page.evaluate(async () => {
    await foundry.applications.instances.get('silk-canvas')?.close();
    while (foundry.applications.instances.get('silk-canvas'))
      await new Promise((r) => setTimeout(r, 20));
  });

/** Raw input skips Playwright's locator handlers: clear dsa5 popups and the tour first. */
async function closePopups(page: Page) {
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    for (const app of [...foundry.applications.instances.values()])
      if (app.element?.classList.contains('dsa5')) await app.close();
    for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
    document.getElementById('dsa5-patch-viewer')?.remove();
    for (const tip of document.querySelectorAll('.didYouKnow')) tip.remove();
    (foundry.nue.Tour as unknown as { activeTour?: { exit(): void } }).activeTour?.exit();
    for (const el of document.querySelectorAll('.tour, .tour-overlay, .tour-fadeout')) el.remove();
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

test(
  'reopen restores the last view in < 1 s (500 fixture, warm, median of 5)',
  { tag: '@perf' },
  async ({ gm }) => {
    test.setTimeout(300_000);
    await ready(gm);
    await closeCanvas(gm);
    await api(gm, 'dev.fixture.generate', { count: 500, seed: 1 });
    const viewport = { x: -300, y: -200, zoom: 0.8 };
    await gm.evaluate((v) => game.settings?.set('silk', 'viewState', { viewport: v }), viewport);
    const expected = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;

    // Measured in the page: `canvas.open` → viewport restored and all 500 Nodes painted.
    const times = await gm.evaluate(
      async ({ expected, count, runs }) => {
        const app = () => foundry.applications.instances.get('silk-canvas');
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        const restored = () => {
          const root = app()?.element?.querySelector('[data-silk-canvas]');
          const vp = root?.querySelector<HTMLElement>('.svelte-flow__viewport');
          const nodes = root?.querySelectorAll<HTMLElement>('.svelte-flow__node-element') ?? [];
          return (
            vp?.style.transform === expected &&
            nodes.length === count &&
            [...nodes].every((n) => n.style.visibility !== 'hidden')
          );
        };
        const close = async () => {
          await app()?.close();
          while (app()) await new Promise((r) => setTimeout(r, 20));
        };
        const out: number[] = [];
        // One warm-up open (lazy chunk loaded, caches hot), then `runs` measured.
        for (let i = 0; i <= runs; i++) {
          const t0 = performance.now();
          await game.modules?.get('silk')?.api?.run('canvas.open');
          while (!restored()) {
            if (performance.now() - t0 > 30_000) throw new Error('canvas did not restore');
            await frame();
          }
          await frame();
          if (i > 0) out.push(performance.now() - t0);
          // Don't let a pending view save overwrite the stored viewport.
          await close();
        }
        return out;
      },
      { expected, count: 500, runs: 5 },
    );
    const ms = median(times);
    console.log(
      `reopen 500: median ${Math.round(ms)} ms, runs ${times.map(Math.round).join(', ')}`,
    );
    expect(ms).toBeLessThan(1000);
  },
);

test(
  'create connected: ≤ 2 real input events per entry point',
  { tag: '@perf' },
  async ({ gm }) => {
    test.setTimeout(240_000);
    await ready(gm);
    await closeCanvas(gm);
    await gm.evaluate(async () => {
      const wc = game.modules?.get('silk')?.session?.().workingCopy;
      await wc?.delete([...(wc.records().keys() ?? [])]);
      await game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 1 } });
    });
    const { id: origin } = await api<{ id: string }>(gm, 'element.create', {
      class: 'person',
      name: 'Alrik',
      at: { x: 200, y: 250 },
    });
    await closePopups(gm);
    await api(gm, 'canvas.open');
    const alrik = gm.locator('[data-silk-node]', { hasText: 'Alrik' });
    await expect(alrik).toBeVisible();

    // Trusted pointerdown / keydown events = real user inputs.
    await gm.evaluate(() => {
      const w = window as unknown as { silkInputs: number };
      w.silkInputs = 0;
      const count = (e: Event) => {
        if (e.isTrusted && !(e as KeyboardEvent).repeat) w.silkInputs++;
      };
      window.addEventListener('pointerdown', count, true);
      window.addEventListener('keydown', count, true);
    });
    const inputs = () =>
      gm.evaluate(() => (window as unknown as { silkInputs: number }).silkInputs);
    const connected = async () =>
      (await records(gm, 'connection')).filter(
        (c) => c.data['from'] === origin || c.data['to'] === origin,
      ).length;

    async function entryPoint(name: string, act: () => Promise<void>) {
      const before = await connected();
      const start = await inputs();
      await act();
      await expect.poll(connected).toBe(before + 1);
      const used = (await inputs()) - start;
      console.log(`create connected via ${name}: ${used} inputs`);
      expect(used, name).toBeLessThanOrEqual(2);
      // Finish the pipeline (not counted): name, then close the Connection editor.
      await expect(gm.locator('[data-silk-name-input]')).toBeFocused();
      await gm.keyboard.type(name);
      await gm.keyboard.press('Enter');
      await expect(gm.locator('[data-silk-label-input]')).toBeFocused();
      await gm.keyboard.press('Escape');
      await expect(gm.locator('[data-silk-class-box]')).toHaveCount(0);
    }

    await entryPoint('drag-out', async () => {
      const point = alrik.locator('[data-silk-point="out"][data-silk-point-side="right"]');
      const p = await point.boundingBox();
      if (!p) throw new Error('no connection point');
      await gm.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
      await gm.mouse.down();
      await gm.mouse.move(p.x + 150, p.y + 200, { steps: 5 });
      await gm.mouse.move(p.x + 300, p.y + 300, { steps: 5 });
      await gm.mouse.up();
      await gm.locator('[data-silk-class-option="note"]').click();
    });

    await entryPoint('right-click', async () => {
      await alrik.click({ button: 'right' });
      await gm.locator('[data-silk-class-option="note"]').click();
    });

    await entryPoint('digit key', async () => {
      await alrik.click();
      await gm.keyboard.press('Digit1');
    });
  },
);

/** Fast-pan bench (§14): reports only; the fps gate is the GM's release check. */
test(
  'fast-pan bench: 500 / 1000 / 2000 fixture @ 8 moves per frame',
  { tag: '@perf' },
  async ({ gm }) => {
    test.setTimeout(600_000);
    await ready(gm);
    await closePopups(gm);
    const results: (BenchResult & { env: string })[] = [];
    for (const count of [500, 1000, 2000])
      results.push(await api(gm, 'dev.bench.fastPan', { count, epf: 8, ms: 3000 }));
    await closeCanvas(gm);

    const dir = resolve(import.meta.dirname, '../bench/results');
    const version = process.env['BENCH_VERSION'] ?? 'local';
    const file: BenchFile = {
      version,
      date: new Date().toISOString(),
      env: `${results[0]?.env ?? ''} · ${process.env['BENCH_MACHINE'] ?? 'unnamed machine'}`,
      results: results.map(({ count, epf, ms, fps, p99, p95, frames }) => ({
        count,
        epf,
        ms,
        fps,
        p99,
        p95,
        frames,
      })),
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${version}.json`), `${JSON.stringify(file, null, 2)}\n`);

    // Baseline: the newest committed release file (not `local`).
    const baselineName = readdirSync(dir)
      .filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f) && f !== `${version}.json`)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .at(-1);
    const baseline = baselineName
      ? (JSON.parse(readFileSync(join(dir, baselineName), 'utf8')) as BenchFile).results
      : [];
    const verdict = benchVerdict(file.results, baseline);
    console.log(
      [
        `bench ${version} vs ${baselineName ?? 'no baseline'} · ${file.env}`,
        ...file.results.map(
          (r) => `  ${r.count} @${r.epf}/f: ${r.fps} fps avg, p99 ${r.p99} ms, p95 ${r.p95} ms`,
        ),
        `  release gate: ${verdict.pass ? 'pass' : `FAIL\n    ${verdict.failures.join('\n    ')}`}`,
      ].join('\n'),
    );
    expect(file.results).toHaveLength(3);
  },
);

/** Canvas Filters (§10.5) on the 2000 fixture: narrowing stays interactive. Reports clear. */
test('filters at 2000: filter.set re-renders < 500 ms', { tag: '@perf' }, async ({ gm }) => {
  test.setTimeout(300_000);
  await ready(gm);
  await closeCanvas(gm);
  await api(gm, 'dev.fixture.generate', { count: 2000, seed: 1 });
  await gm.evaluate(() =>
    game.settings?.set('silk', 'viewState', { viewport: { x: 0, y: 0, zoom: 0.1 } }),
  );
  await api(gm, 'canvas.open');
  const times = await gm.evaluate(async () => {
    const api = game.modules?.get('silk')?.api;
    const root = () =>
      foundry.applications.instances
        .get('silk-canvas')
        ?.element?.querySelector('[data-silk-canvas]');
    const count = () => root()?.querySelectorAll('.svelte-flow__node-element').length ?? 0;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const until = async (ok: () => boolean) => {
      const t0 = performance.now();
      while (!ok()) {
        if (performance.now() - t0 > 30_000) throw new Error('canvas did not settle');
        await frame();
      }
    };
    await until(() => count() === 2000);
    const t0 = performance.now();
    await api?.run('filter.set', { dimension: 'class', values: ['location'] });
    await until(() => count() < 2000 && count() > 0);
    await frame();
    const narrow = performance.now() - t0;
    const t1 = performance.now();
    await api?.run('filter.clear');
    await until(() => count() === 2000);
    await frame();
    return { narrow, clear: performance.now() - t1 };
  });
  console.log(
    `filters 2000: narrow ${Math.round(times.narrow)} ms, clear ${Math.round(times.clear)} ms`,
  );
  await closeCanvas(gm);
  expect(times.narrow).toBeLessThan(500);
});
