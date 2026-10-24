import { describe, expect, it } from 'vitest';
import { compareSizes } from './bundle-size.mjs';

const sizes = (entry: number, lazy: Record<string, number> = {}) => ({ entry, lazy });

describe('bundle-size gate (spec §14)', () => {
  it('passes when the gzipped entry grows by at most 10%', () => {
    expect(compareSizes(sizes(1000), sizes(1100)).ok).toBe(true);
  });

  it('fails when the entry grows by more than 10%', () => {
    const result = compareSizes(sizes(1000), sizes(1101));
    expect(result.ok).toBe(false);
    expect(result.report).toContain('+10.1%');
  });

  it('lets the allow-size label override the gate', () => {
    expect(compareSizes(sizes(1000), sizes(5000), { allowSize: true }).ok).toBe(true);
  });

  it('reports lazy chunks without gating on them', () => {
    const result = compareSizes(sizes(1000, { canvas: 100 }), sizes(1000, { canvas: 900 }));
    expect(result.ok).toBe(true);
    expect(result.report).toContain('canvas');
  });
});
