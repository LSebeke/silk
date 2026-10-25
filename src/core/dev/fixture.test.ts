import { describe, expect, it } from 'vitest';
import { check, duplicateOf, readConnection } from '../connections';
import { elementClass, isGhost, readElement } from '../elements';
import { generateFixture } from './fixture';

describe('generateFixture', () => {
  it('is deterministic per seed', () => {
    const a = generateFixture({ count: 50, seed: 7 });
    expect(generateFixture({ count: 50, seed: 7 })).toEqual(a);
    expect(generateFixture({ count: 50, seed: 8 })).not.toEqual(a);
  });

  it.each([500, 1000, 2000])('%i: count Elements, ~1.4 Connections each, all valid', (count) => {
    const records = generateFixture({ count, seed: 1 });
    const snapshot = new Map(records.map((r) => [r.id, r]));
    expect(snapshot.size).toBe(records.length);
    const elements = records.flatMap((r) => readElement(r) ?? []);
    const connections = records.flatMap((r) => readConnection(r) ?? []);
    expect(elements).toHaveLength(count);
    expect(connections.length).toBeGreaterThan(count * 1.2);
    expect(connections.length).toBeLessThan(count * 1.5);
    for (const e of elements) {
      expect(e.id).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/);
      expect(elementClass(e.class)?.creatable).toBe(true);
      expect(isGhost(e)).toBe(true);
      expect(e.name).not.toBe('');
    }
    // No two Nodes on one spot.
    expect(new Set(elements.map((e) => `${e.position.x},${e.position.y}`)).size).toBe(count);
    expect(connections.some((c) => c.type !== 'free')).toBe(true);
    for (const c of connections) {
      expect(snapshot.has(c.from) && snapshot.has(c.to) && c.from !== c.to).toBe(true);
      const others = new Map(snapshot);
      others.delete(c.id);
      expect(check(others, c)).toEqual({ ok: true, replaces: [] });
      expect(duplicateOf(others, c)).toBeUndefined();
    }
  });
});
