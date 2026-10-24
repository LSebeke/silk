/**
 * Per-World, unversioned canvas view state (spec §10.1, §11.2): pan/zoom now; last view,
 * Canvas Filters (T23) and Focus Pins (T24) add fields here. Stored as one world setting
 * by the adapter; unknown stored fields are kept on save.
 */
import { canonicalJson } from '../canon';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewState {
  viewport?: Viewport;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The well-formed fields of a stored value. */
export function readViewState(stored: unknown): ViewState {
  const out: ViewState = {};
  const raw = (stored ?? {}) as Record<string, unknown>;
  const vp = raw['viewport'] as Partial<Viewport> | undefined;
  if (vp && finite(vp.x) && finite(vp.y) && finite(vp.zoom) && vp.zoom > 0)
    out.viewport = { x: vp.x, y: vp.y, zoom: vp.zoom };
  return out;
}

export interface ViewStateStore {
  get(): ViewState;
  update(patch: Partial<ViewState>): Promise<void>;
}

export function createViewState(io: {
  load(): unknown;
  save(value: Record<string, unknown>): Promise<void>;
}): ViewStateStore {
  return {
    get: () => readViewState(io.load()),
    async update(patch) {
      const stored = (io.load() ?? {}) as Record<string, unknown>;
      const next = { ...stored, ...patch };
      if (canonicalJson(next) === canonicalJson(stored)) return;
      await io.save(next);
    },
  };
}
