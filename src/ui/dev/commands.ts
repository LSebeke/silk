/**
 * Dev-only UI commands (spec §14, §15 "Dev only"): the fast-pan bench on the real canvas.
 * Registered only in dev builds (`__SILK_DEV__`), never in a release.
 */
import type { ViewStateStore } from '../../core/canvas';
import type { Command } from '../../core/commands/registry';
import { frameStats, type BenchResult } from '../../core/dev/bench';
import { readElement } from '../../core/elements';
import type { WorkingCopy } from '../../core/working-copy';
import { benchEnv, fastPan } from './fast-pan';

export interface DevUiDeps {
  run(name: string, args?: object): Promise<unknown>;
  workingCopy(): WorkingCopy;
  viewState: ViewStateStore;
}

/** Seed of the shared perf fixture. */
export const BENCH_SEED = 1;
const CANVAS_ID = 'silk-canvas';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function canvasRoot(): HTMLElement {
  const root = findCanvasRoot();
  if (!root) throw new Error('Silk bench: canvas not open');
  return root;
}

const findCanvasRoot = () =>
  foundry.applications.instances
    .get(CANVAS_ID)
    ?.element?.querySelector<HTMLElement>('[data-silk-canvas]') ?? null;

/** Every Node rendered and measured (Svelte Flow hides unmeasured Nodes). */
export function canvasPainted(root: HTMLElement | null, count: number): boolean {
  if (!root) return false;
  const nodes = root.querySelectorAll<HTMLElement>('.svelte-flow__node-element');
  return nodes.length === count && [...nodes].every((n) => n.style.visibility !== 'hidden');
}

async function until(test: () => boolean, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('Silk bench: timed out');
    await wait(50);
  }
}

export function devUiCommands(deps: DevUiDeps): Command[] {
  const closeCanvas = async () => {
    await foundry.applications.instances.get(CANVAS_ID)?.close();
    await until(() => !foundry.applications.instances.get(CANVAS_ID));
  };

  const fastPanBench: Command<
    { count?: number; epf?: number; ms?: number },
    BenchResult & { env: string }
  > = {
    name: 'dev.bench.fastPan',
    title: 'dev.bench.fastPan',
    available: (ctx) => ctx.isGM,
    async run({ count = 500, epf = 8, ms = 3000 }) {
      await deps.run('dev.fixture.generate', { count, seed: BENCH_SEED });
      // Prototype `view1`: zoom 1, centred on the fixture. Measure the pane, then reopen there.
      await deps.run('canvas.open');
      await until(() => !!findCanvasRoot());
      const rect = canvasRoot().getBoundingClientRect();
      const points = [...deps.workingCopy().records().values()].flatMap(
        (r) => readElement(r)?.position ?? [],
      );
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      await closeCanvas();
      await deps.viewState.update({
        viewport: { x: rect.width / 2 - cx, y: rect.height / 2 - cy, zoom: 1 },
      });
      await deps.run('canvas.open');
      await until(() => canvasPainted(findCanvasRoot(), points.length));
      await wait(800);
      const root = canvasRoot();
      const pane = root.querySelector<HTMLElement>('.svelte-flow__pane');
      if (!pane) throw new Error('Silk bench: no canvas pane');
      const stats = frameStats(await fastPan(pane, { ms, epf }));
      const result = {
        count,
        epf,
        ms,
        ...stats,
        env: benchEnv(root.ownerDocument.defaultView ?? window),
      };
      console.log('silk bench', result);
      return result;
    },
  };
  return [fastPanBench];
}
