/**
 * Untangle tween (spec §10.7): the layout commands announce old positions before writing new
 * ones; an open canvas animates from them to the records' positions (~450 ms).
 */
import type { Point } from '../elements/element';

export const TWEEN_MS = 450;

export interface LayoutTween {
  start(from: ReadonlyMap<string, Point>): void;
  subscribe(listener: (from: ReadonlyMap<string, Point>) => void): () => void;
}

export function createLayoutTween(): LayoutTween {
  const listeners = new Set<(from: ReadonlyMap<string, Point>) => void>();
  return {
    start: (from) => listeners.forEach((l) => l(from)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
