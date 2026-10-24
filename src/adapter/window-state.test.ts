import { describe, expect, it } from 'vitest';
import { readWindowState, withWindowState } from './window-state';

describe('window state', () => {
  it('reads a window entry, dropping malformed fields', () => {
    const all = {
      'silk-canvas': { position: { left: 10, top: 20, width: 800, height: 600 }, detached: true },
      broken: { position: { left: 'x' }, detached: 'yes' },
    };
    expect(readWindowState(all, 'silk-canvas')).toEqual({
      position: { left: 10, top: 20, width: 800, height: 600 },
      detached: true,
    });
    expect(readWindowState(all, 'broken')).toEqual({ detached: false });
    expect(readWindowState(undefined, 'silk-canvas')).toEqual({ detached: false });
  });

  it('updates one window without touching others', () => {
    const all = { other: { detached: true } };
    const next = withWindowState(all, 'silk-canvas', {
      position: { left: 1, top: 2, width: 3, height: 4 },
    });
    expect(next).toEqual({
      other: { detached: true },
      'silk-canvas': { position: { left: 1, top: 2, width: 3, height: 4 } },
    });
    expect(withWindowState(next, 'silk-canvas', { detached: true })['silk-canvas']).toEqual({
      position: { left: 1, top: 2, width: 3, height: 4 },
      detached: true,
    });
  });
});
