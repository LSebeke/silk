import { describe, expect, it } from 'vitest';
import type { CanonRecord, Snapshot } from '../canon';
import { emptyRevelationMap, setRevealed, type RevelationMap } from '../campaigns';
import { buildPlayerView, parsePlayerView } from './player-view';

const element = (id: string, data: Record<string, unknown>): CanonRecord => ({
  kind: 'element',
  id,
  data: { name: id, position: { x: 0, y: 0 }, ...data } as never,
});
const connection = (id: string, data: Record<string, unknown>): CanonRecord => ({
  kind: 'connection',
  id,
  data: { type: 'free', direction: 'directed', label: '', ...data } as never,
});
const snapshot = (...records: CanonRecord[]): Snapshot => new Map(records.map((r) => [r.id, r]));
const reveal = (...entries: [Parameters<typeof setRevealed>[1], string][]): RevelationMap =>
  entries.reduce((m, [k, id]) => setRevealed(m, k, id, true), emptyRevelationMap());

describe('buildPlayerView (spec §9 Player Canvas data)', () => {
  const records = snapshot(
    element('gareth', {
      class: 'location',
      name: 'Gareth (secret name)',
      uuid: 'JournalEntry.g',
      position: { x: 10, y: 20 },
      status: 'visited',
      tags: ['villain-base'],
      group: 'grp',
      infoBlocks: [{ _id: 'b1', name: 'Secrets', text: 'boss lives here' }],
    }),
    element('alrik', { class: 'person', uuid: 'Actor.a', position: { x: 300, y: 40 } }),
    element('hidden', { class: 'person', uuid: 'Actor.h', position: { x: 5, y: 5 } }),
    element('ghost', { class: 'note', position: { x: 1, y: 1 } }),
    connection('c1', { from: 'alrik', to: 'gareth', label: 'lives in' }),
    connection('c2', { from: 'alrik', to: 'hidden', label: 'serves' }),
    connection('c3', { from: 'gareth', to: 'alrik', type: 'locatedIn' }),
    { kind: 'layoutGroup', id: 'grp', data: { label: 'Villains' } } as never,
  );

  it('holds Revealed Nodes with class, doc uuid and Canon position only', () => {
    const view = buildPlayerView(
      records,
      reveal(['element', 'gareth'], ['element', 'alrik'], ['infoBlock', 'b1']),
    );
    expect(view.nodes).toEqual([
      { id: 'alrik', class: 'person', uuid: 'Actor.a', x: 300, y: 40 },
      { id: 'gareth', class: 'location', uuid: 'JournalEntry.g', x: 10, y: 20 },
    ]);
    // No names (they come from the docs the player sees), Status, Info Blocks, Tags, Groups.
    const json = JSON.stringify(view);
    for (const secret of ['secret name', 'visited', 'villain', 'boss', 'Villains', 'grp'])
      expect(json).not.toContain(secret);
  });

  it('holds Revealed Connections between shown Nodes, with type, direction and label', () => {
    const view = buildPlayerView(
      records,
      reveal(
        ['element', 'gareth'],
        ['element', 'alrik'],
        ['connection', 'c1'],
        ['connection', 'c2'],
      ),
    );
    // c2's other end is unrevealed; c3 is not Revealed.
    expect(view.connections).toEqual([
      {
        id: 'c1',
        from: 'alrik',
        to: 'gareth',
        type: 'free',
        direction: 'directed',
        label: 'lives in',
      },
    ]);
  });

  it('omits Revealed ids that are Ghosts or gone from the working copy', () => {
    const view = buildPlayerView(records, reveal(['element', 'ghost'], ['element', 'deleted']));
    expect(view).toEqual({ nodes: [], connections: [] });
  });
});

describe('parsePlayerView', () => {
  it('reads a stored view and drops malformed entries', () => {
    const stored = {
      nodes: [
        { id: 'a', class: 'person', uuid: 'Actor.a', x: 1, y: 2 },
        { id: 'b', class: 'person', x: 'nope' },
      ],
      connections: [
        { id: 'c', from: 'a', to: 'a', type: 'free', direction: 'mutual', label: 'x' },
        { id: 'd' },
      ],
    };
    expect(parsePlayerView(stored)).toEqual({
      nodes: [{ id: 'a', class: 'person', uuid: 'Actor.a', x: 1, y: 2 }],
      connections: [{ id: 'c', from: 'a', to: 'a', type: 'free', direction: 'mutual', label: 'x' }],
    });
  });

  it('is empty for the unset default', () => {
    expect(parsePlayerView({})).toEqual({ nodes: [], connections: [] });
    expect(parsePlayerView(undefined)).toEqual({ nodes: [], connections: [] });
  });
});
