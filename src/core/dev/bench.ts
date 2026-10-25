/**
 * Fast-pan bench numbers (spec §14): frame stats and the release gate. Pure; dev only.
 * The DOM driver is `src/ui/dev/fast-pan.ts`; results files are described in bench/README.md.
 */

export interface FrameStats {
  /** Average fps over the run. */
  fps: number;
  /** Worst-1% and worst-5% frame, ms. */
  p99: number;
  p95: number;
  frames: number;
}

export interface BenchResult extends FrameStats {
  count: number;
  /** Mousemoves per frame. */
  epf: number;
  ms: number;
}

/** `bench/results/<version>.json`. */
export interface BenchFile {
  version: string;
  date: string;
  /** Browser, viewport, GPU, machine. */
  env: string;
  results: BenchResult[];
}

export function frameStats(dts: readonly number[]): FrameStats {
  const sorted = [...dts].sort((a, b) => b - a);
  const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
  const worst = (share: number) =>
    Math.round(sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? 0);
  return { fps: Math.round(1000 / avg), p99: worst(0.01), p95: worst(0.05), frames: dts.length };
}

/** Gated: the 500 fixture. 1000 / 2000 are reported only. */
const GATED_COUNT = 500;
const MIN_FPS = 55;
const MAX_P99 = 70;
const MAX_REGRESSION = 0.15;

export function benchVerdict(
  results: readonly BenchResult[],
  baseline: readonly BenchResult[] = [],
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const r of results) {
    if (r.count !== GATED_COUNT) continue;
    const at = `${r.count} @${r.epf}/f`;
    if (r.fps < MIN_FPS) failures.push(`${at}: ${r.fps} fps < ${MIN_FPS} fps`);
    if (r.p99 > MAX_P99) failures.push(`${at}: p99 ${r.p99} ms > ${MAX_P99} ms`);
    const base = baseline.find((b) => b.count === r.count && b.epf === r.epf);
    if (base && r.fps < base.fps * (1 - MAX_REGRESSION))
      failures.push(`${at}: ${r.fps} fps is > 15% below baseline ${base.fps} fps`);
    if (base && r.p99 > base.p99 * (1 + MAX_REGRESSION))
      failures.push(`${at}: p99 ${r.p99} ms is > 15% above baseline ${base.p99} ms`);
  }
  return { pass: failures.length === 0, failures };
}
