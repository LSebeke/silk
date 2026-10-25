import { describe, expect, it } from 'vitest';
import { ownershipRevealed } from './revealed';

describe('ownershipRevealed (Revealed filter under main, §8)', () => {
  const players = new Set(['p1']);
  const check = (ownership: Record<string, number> | undefined) =>
    ownershipRevealed(ownership, (id) => players.has(id));

  it('is Revealed when players get at least LIMITED by default or per player', () => {
    expect(check({ default: 1 })).toBe(true);
    expect(check({ default: 0, p1: 2 })).toBe(true);
  });

  it('is not Revealed at NONE, for GM-only entries, or without a doc', () => {
    expect(check({ default: 0 })).toBe(false);
    expect(check({ default: 0, gm: 3 })).toBe(false);
    expect(check(undefined)).toBe(false);
  });
});
