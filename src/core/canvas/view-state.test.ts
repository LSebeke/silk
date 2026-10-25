import { describe, expect, it } from 'vitest';
import { createViewState, readViewState } from './view-state';

describe('view state', () => {
  it('reads only well-formed fields from the stored setting', () => {
    expect(readViewState(undefined)).toEqual({});
    expect(readViewState({ viewport: { x: 1, y: 2, zoom: 0.5 }, junk: 1 })).toEqual({
      viewport: { x: 1, y: 2, zoom: 0.5 },
    });
    expect(readViewState({ viewport: { x: 1, y: 'a', zoom: 1 } })).toEqual({});
    expect(readViewState({ viewport: { x: 1, y: 2, zoom: 0 } })).toEqual({});
  });

  it('reads well-formed Canvas Filters and expanded badges', () => {
    expect(
      readViewState({
        filters: { class: ['person'], tag: 'x', campaign: ['c'], hops: [1] },
        expanded: ['a'],
      }),
    ).toEqual({ filters: { class: ['person'] }, expanded: ['a'] });
    expect(readViewState({ expanded: [1] })).toEqual({});
  });

  it('update merges into the stored value and saves it, keeping unknown later fields', async () => {
    const saved: unknown[] = [];
    let stored: unknown = { viewport: { x: 0, y: 0, zoom: 1 }, pins: ['el-a'] };
    const view = createViewState({
      load: () => stored,
      save: async (v) => {
        saved.push(v);
        stored = v;
      },
    });
    expect(view.get().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    await view.update({ viewport: { x: 10, y: -5, zoom: 2 } });
    expect(saved).toEqual([{ viewport: { x: 10, y: -5, zoom: 2 }, pins: ['el-a'] }]);
    expect(view.get().viewport).toEqual({ x: 10, y: -5, zoom: 2 });
  });

  it('skips saving an unchanged viewport', async () => {
    const saved: unknown[] = [];
    const view = createViewState({
      load: () => ({ viewport: { x: 1, y: 1, zoom: 1 } }),
      save: async (v) => void saved.push(v),
    });
    await view.update({ viewport: { x: 1, y: 1, zoom: 1 } });
    expect(saved).toEqual([]);
  });
});
