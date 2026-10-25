import { describe, expect, it } from 'vitest';
import { benchVerdict, frameStats, type BenchResult } from './bench';

describe('frameStats', () => {
  it('avg fps and worst-1% / worst-5% frame from frame durations', () => {
    // 100 frames: 94 × 10 ms, 5 × 20 ms, 1 × 100 ms → avg 11.4 ms.
    const dts = [...Array<number>(94).fill(10), ...Array<number>(5).fill(20), 100];
    expect(frameStats(dts)).toEqual({ fps: 88, p99: 100, p95: 20, frames: 100 });
  });
});

const result = (count: number, fps: number, p99: number): BenchResult => ({
  count,
  epf: 8,
  ms: 3000,
  fps,
  p99,
  p95: p99,
  frames: 180,
});

describe('benchVerdict (§14 release gate)', () => {
  it('passes the 500 run at ≥ 55 fps and p99 ≤ 70 ms', () => {
    expect(benchVerdict([result(500, 58, 40)])).toEqual({ pass: true, failures: [] });
  });

  it('fails the 500 run below 55 fps or above 70 ms p99', () => {
    expect(benchVerdict([result(500, 54, 40)]).pass).toBe(false);
    expect(benchVerdict([result(500, 60, 71)]).failures).toEqual(['500 @8/f: p99 71 ms > 70 ms']);
  });

  it('fails when > 15% worse than the baseline', () => {
    const baseline = [result(500, 80, 30)];
    expect(benchVerdict([result(500, 69, 30)], baseline).pass).toBe(true);
    expect(benchVerdict([result(500, 67, 30)], baseline).failures).toEqual([
      '500 @8/f: 67 fps is > 15% below baseline 80 fps',
    ]);
  });

  it('only reports 1000 / 2000 runs', () => {
    expect(benchVerdict([result(1000, 20, 200), result(2000, 10, 400)]).pass).toBe(true);
  });
});
