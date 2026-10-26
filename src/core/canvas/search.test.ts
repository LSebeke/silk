import { describe, expect, it } from 'vitest';
import type { CanonRecord, Snapshot } from '../canon';
import { buildSearchIndex, searchIndex } from './search';

const el = (id: string, name: string, extra: Record<string, unknown> = {}): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: 'person', name, position: { x: 0, y: 0 }, ...extra },
});
const snap = (records: CanonRecord[]): Snapshot => new Map(records.map((r) => [r.id, r]));
const run = (records: CanonRecord[], query: string) =>
  searchIndex(buildSearchIndex(snap(records)), query);

describe('search', () => {
  it('finds Nodes by name, case- and accent-insensitive, Ghosts included', () => {
    const hits = run(
      [el('a', 'Alrik'), el('b', 'Bärbel', { uuid: 'Actor.x' }), el('c', 'Rondra')],
      'BAR',
    );
    expect(hits).toEqual([
      { kind: 'node', id: 'b', name: 'Bärbel', class: 'person', ghost: false },
    ]);
    expect(run([el('a', 'Alrik')], 'alr')[0]).toMatchObject({ id: 'a', ghost: true });
  });

  it('orders Nodes, then Tags, then Info Block text; prefix matches first', () => {
    const records = [
      el('a', 'Old Gate', { tags: ['gatekeeper'] }),
      el('b', 'Gatehouse'),
      el('c', 'Tavern', {
        infoBlocks: [{ _id: 'i1', name: 'Notes', text: '<p>Meet at the <b>gate</b> at dawn</p>' }],
      }),
    ];
    const hits = run(records, 'gate');
    expect(hits.map((h) => h.kind)).toEqual(['node', 'node', 'tag', 'info']);
    expect(hits[0]).toMatchObject({ id: 'b' });
    expect(hits[1]).toMatchObject({ id: 'a' });
    expect(hits[3]).toMatchObject({
      kind: 'info',
      id: 'c',
      name: 'Tavern',
      block: 'Notes',
      snippet: 'Meet at the gate at dawn',
    });
  });

  it('a Tag result expands into its elements', () => {
    const hits = run(
      [el('a', 'Alrik', { tags: ['noble'] }), el('b', 'Bosper', { tags: ['noble', 'x'] })],
      'nob',
    );
    expect(hits).toEqual([
      {
        kind: 'tag',
        tag: 'noble',
        elements: [
          { id: 'a', name: 'Alrik', class: 'person', ghost: true },
          { id: 'b', name: 'Bosper', class: 'person', ghost: true },
        ],
      },
    ]);
  });

  it('ignores Connection labels and empty queries', () => {
    const records: CanonRecord[] = [
      el('a', 'Alrik'),
      el('b', 'Bosper'),
      {
        kind: 'connection',
        id: 'c',
        data: { from: 'a', to: 'b', type: 'free', direction: 'directed', label: 'hates' },
      },
    ];
    expect(run(records, 'hates')).toEqual([]);
    expect(run(records, '  ')).toEqual([]);
  });

  it('is fast at 2000 Nodes', () => {
    const records = Array.from({ length: 2000 }, (_, i) =>
      el(`n${i}`, `Node ${i}`, {
        tags: [`tag${i % 50}`],
        infoBlocks: [{ _id: `i${i}`, name: 'Bio', text: `<p>Lorem ipsum ${i} dolor sit amet</p>` }],
      }),
    );
    let t = performance.now();
    const index = buildSearchIndex(snap(records));
    const build = performance.now() - t;
    t = performance.now();
    for (const q of ['node 1', 'tag4', 'dolor', 'zzz', 'o']) searchIndex(index, q);
    const query = (performance.now() - t) / 5;
    expect(build).toBeLessThan(150);
    expect(query).toBeLessThan(20);
    expect(searchIndex(index, 'node 1999')).toHaveLength(1);
  });
});
