/**
 * Client-local canvas session state: what the GM has selected. Not persisted.
 * Focus View (T24) seeds from `selection`; filters/pins live in the view state.
 */

export interface CanvasStateValue {
  /** Selected Node ids, in selection order. */
  readonly selection: readonly string[];
}

export interface CanvasState {
  get(): CanvasStateValue;
  select(ids: readonly string[], add?: boolean): void;
  /** Svelte store contract. */
  subscribe(run: (value: CanvasStateValue) => void): () => void;
}

export function createCanvasState(): CanvasState {
  let value: CanvasStateValue = { selection: [] };
  const subscribers = new Set<(value: CanvasStateValue) => void>();

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
    subscribe(run) {
      subscribers.add(run);
      run(value);
      return () => subscribers.delete(run);
    },
  };
}
