import { describe, expect, it } from 'vitest';
import type { PlayerView } from '../../core/player-view';
import { toPlayerEdges, toPlayerNodes } from './player-flow';

const view: PlayerView = {
  nodes: [
    { id: 'a', class: 'person', uuid: 'Actor.a', x: 10, y: 20 },
    { id: 'g', class: 'location', uuid: 'JournalEntry.g', x: 300, y: 0 },
  ],
  connections: [
    { id: 'c1', from: 'a', to: 'g', type: 'free', direction: 'directed', label: 'lives in' },
    { id: 'c2', from: 'g', to: 'a', type: 'free', direction: 'mutual', label: 'trade with' },
  ],
};

describe('Player Canvas flow model (spec §9 View)', () => {
  it('places read-only Nodes at Canon positions with the name and Cover the player can see', () => {
    const nodes = toPlayerNodes(view, (n) =>
      n.id === 'a' ? { name: 'Alrik', img: 'hooded.svg' } : { name: 'Gareth' },
    );
    expect(nodes).toEqual([
      {
        id: 'a',
        type: 'player',
        position: { x: 10, y: 20 },
        draggable: false,
        selectable: false,
        connectable: false,
        data: { class: 'person', name: 'Alrik', img: 'hooded.svg' },
      },
      {
        id: 'g',
        type: 'player',
        position: { x: 300, y: 0 },
        draggable: false,
        selectable: false,
        connectable: false,
        data: { class: 'location', name: 'Gareth' },
      },
    ]);
  });

  it('draws Revealed Connections with labels; parallel ones fan apart', () => {
    const edges = toPlayerEdges(view);
    expect(edges.map((e) => [e.id, e.source, e.target, e.data?.label])).toEqual([
      ['c1', 'a', 'g', 'lives in'],
      ['c2', 'g', 'a', 'trade with'],
    ]);
    expect(edges[0]?.markerEnd).toBeTruthy();
    expect(edges[1]?.markerEnd).toBeUndefined();
    expect(edges[0]?.data?.offset).not.toBe(0);
    expect(edges.every((e) => e.selectable === false)).toBe(true);
  });
});
