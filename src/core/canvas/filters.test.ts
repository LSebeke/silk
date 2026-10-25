import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../canon';
import { generateFixture } from '../dev/fixture';
import { applyFilters, type FilterInput } from './filters';

const el = (id: string, data: Record<string, unknown> = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: 'person', name: id, position: { x: 0, y: 0 }, ...data },
});
const link = (id: string, from: string, to: string, type = 'free'): CanonRecord => ({
  kind: 'connection',
  id,
  data: { from, to, type, direction: 'directed', label: '' },
});
const group = (id: string, parent: string | null = null): CanonRecord => ({
  kind: 'layoutGroup',
  id,
  data: { label: id, parent, position: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
});
const snap = (...records: CanonRecord[]) => new Map(records.map((r) => [r.id, r]));
const run = (records: CanonRecord[], input: Partial<FilterInput>) =>
  applyFilters(snap(...records), { filters: {}, revealed: () => false, ...input });
const visible = (records: CanonRecord[], input: Partial<FilterInput>) =>
  [...run(records, input).visible].sort();

describe('Canvas Filters engine', () => {
  it('shows every element without filters and counts M', () => {
    const r = run([el('a'), el('b'), link('c1', 'a', 'b'), group('g')], {});
    expect([...r.visible].sort()).toEqual(['a', 'b']);
    expect(r.total).toBe(2);
    expect(r.active).toBe(false);
  });

  it('ORs values within a dimension and ANDs across dimensions', () => {
    const records = [
      el('p', { class: 'person', tags: ['noble'] }),
      el('l', { class: 'location', tags: ['noble'] }),
      el('i', { class: 'item', tags: ['cursed'] }),
      el('q', { class: 'person' }),
    ];
    expect(visible(records, { filters: { class: ['person', 'location'] } })).toEqual([
      'l',
      'p',
      'q',
    ]);
    expect(
      visible(records, { filters: { class: ['person', 'item'], tag: ['noble', 'cursed'] } }),
    ).toEqual(['i', 'p']);
    // An empty value list leaves the dimension inactive.
    expect(visible(records, { filters: { class: [] } })).toHaveLength(4);
  });

  it('filters by Status (class default when unset); status-less classes never match', () => {
    const records = [
      el('alive', { class: 'person' }),
      el('dead', { class: 'person', status: 'dead' }),
      el('done', { class: 'quest', status: 'done' }),
      el('note', { class: 'note' }),
    ];
    expect(visible(records, { filters: { status: ['alive', 'done'] } })).toEqual(['alive', 'done']);
  });

  it('filters Materialized vs Ghost', () => {
    const records = [el('ghost'), el('mat', { uuid: 'Actor.x' })];
    expect(visible(records, { filters: { materialized: ['ghost'] } })).toEqual(['ghost']);
    expect(visible(records, { filters: { materialized: ['materialized'] } })).toEqual(['mat']);
  });

  it('reads Revealed through the injected predicate', () => {
    const records = [el('a'), el('b')];
    const revealed = (e: { id: string }) => e.id === 'b';
    expect(visible(records, { filters: { revealed: ['revealed'] }, revealed })).toEqual(['b']);
    expect(visible(records, { filters: { revealed: ['hidden'] }, revealed })).toEqual(['a']);
  });

  it('filters by Visual Group including nested groups', () => {
    const records = [
      group('outer'),
      group('inner', 'outer'),
      group('other'),
      el('a', { group: 'outer' }),
      el('b', { group: 'inner' }),
      el('c', { group: 'other' }),
      el('d'),
    ];
    const r = run(records, { filters: { group: ['outer'] } });
    expect([...r.visible].sort()).toEqual(['a', 'b']);
    // Frames holding visible Nodes stay (with their ancestors); others go.
    expect([...r.frames].sort()).toEqual(['inner', 'outer']);
  });

  it('keeps every frame when no filter is active', () => {
    const r = run([group('g'), group('h', 'g'), el('a')], {});
    expect([...r.frames].sort()).toEqual(['g', 'h']);
  });

  it('N-hop: within n Connections (either direction) of any seed', () => {
    const records = [
      el('a'),
      el('b'),
      el('c'),
      el('d'),
      el('x'),
      link('ab', 'a', 'b'),
      link('cb', 'c', 'b'),
      link('cd', 'c', 'd'),
    ];
    expect(visible(records, { filters: { hops: ['a'] } })).toEqual(['a', 'b', 'c']);
    expect(visible(records, { filters: { hops: ['a'] }, hops: 1 })).toEqual(['a', 'b']);
    expect(visible(records, { filters: { hops: ['a', 'x'] }, hops: 0 })).toEqual(['a', 'x']);
  });

  it('"show contents": the Location and everything located in it, transitively', () => {
    const records = [
      el('city', { class: 'location' }),
      el('inn', { class: 'location' }),
      el('sword', { class: 'item' }),
      el('far', { class: 'location' }),
      el('ring', { class: 'item' }),
      link('l1', 'inn', 'city', 'locatedIn'),
      link('l2', 'sword', 'inn', 'locatedIn'),
      link('l3', 'ring', 'far', 'locatedIn'),
    ];
    expect(visible(records, { filters: { contents: ['city'] } })).toEqual(['city', 'inn', 'sword']);
  });

  it('counts hidden neighbours per visible Node (+N badge) and lists them', () => {
    const records = [
      el('a', { class: 'person' }),
      el('b', { class: 'item' }),
      el('c', { class: 'item' }),
      el('d', { class: 'person' }),
      link('ab', 'a', 'b'),
      link('ab2', 'b', 'a'),
      link('ac', 'a', 'c'),
      link('ad', 'a', 'd'),
    ];
    const r = run(records, { filters: { class: ['person'] } });
    expect(r.badges.get('a')).toBe(2);
    expect(r.badges.has('d')).toBe(false);
    expect(r.hiddenNeighbours('a').sort()).toEqual(['b', 'c']);
  });

  it('always shows `include` ids (expanded badges, pins), counted as visible', () => {
    const records = [
      el('a', { class: 'person' }),
      el('b', { class: 'item' }),
      link('ab', 'a', 'b'),
    ];
    const r = run(records, { filters: { class: ['person'] }, include: ['b', 'gone'] });
    expect([...r.visible].sort()).toEqual(['a', 'b']);
    expect(r.badges.size).toBe(0);
    expect(r.matches('b')).toBe(false);
    expect(r.matches('a')).toBe(true);
  });

  it('stays fast at 2000 Nodes', () => {
    const records = snap(...generateFixture({ count: 2000, seed: 3 }));
    const ids = [...records.values()].filter((r) => r.kind === 'element').map((r) => r.id);
    const input: FilterInput = {
      filters: { class: ['person', 'location', 'item'], hops: ids.slice(0, 20), status: ['alive'] },
      revealed: () => true,
      hops: 3,
    };
    applyFilters(records, input);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) applyFilters(records, input);
    expect((performance.now() - t0) / 10).toBeLessThan(20);
  });
});
