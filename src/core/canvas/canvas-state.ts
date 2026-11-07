/**
 * Client-local canvas session state: what the GM has selected, and the open canvas's card
 * sizes. Not persisted. Focus View (T24) seeds from `selection`; filters/pins live in the
 * view state.
 */
import { NODE_SIZE, type NodeSizeOf, type Size } from './groups';

export interface CanvasStateValue {
  /** Selected Node ids, in selection order. */
  readonly selection: readonly string[];
}

export interface CanvasState {
  get(): CanvasStateValue;
  select(ids: readonly string[], add?: boolean): void;
  /**
   * A card's footprint for layout (spec 1.1 §E.1: cards grow to fit their name): measured
   * by the open canvas, else the default `NODE_SIZE`.
   */
  nodeSize(id: string): Size;
  /** The open canvas reports measured card sizes; returns the unregister. */
  measureWith(measure: NodeSizeOf): () => void;
  /** Svelte store contract. */
  subscribe(run: (value: CanvasStateValue) => void): () => void;
}

export function createCanvasState(): CanvasState {
  let value: CanvasStateValue = { selection: [] };
  const subscribers = new Set<(value: CanvasStateValue) => void>();
  let measure: NodeSizeOf | undefined;

  return {
    get: () => value,
    select(ids, add = false) {
      const next = [...new Set(add ? [...value.selection, ...ids] : ids)];
      const same =
        next.length === value.selection.length && next.every((id, i) => id === value.selection[i]);
      if (same) return;
      value = { ...value, selection: next };
      for (const s of subscribers) s(value);
    },
    nodeSize: (id) => measure?.(id) ?? NODE_SIZE,
    measureWith(next) {
      measure = next;
      return () => {
        if (measure === next) measure = undefined;
      };
    },
    subscribe(run) {
      subscribers.add(run);
      run(value);
      return () => subscribers.delete(run);
    },
  };
}
