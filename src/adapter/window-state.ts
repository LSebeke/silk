/**
 * Window position and detached state per Silk window (spec §2), in the client setting
 * `windowState`: `{ [appId]: { position?, detached? } }`. v14 does not restore detached
 * windows after a reload, so Silk re-detaches on open.
 */

export interface WindowPosition {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WindowState {
  position?: WindowPosition;
  detached: boolean;
}

type Stored = Record<string, { position?: Partial<WindowPosition>; detached?: unknown }>;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function readWindowState(all: unknown, id: string): WindowState {
  const entry = ((all ?? {}) as Stored)[id];
  const p = entry?.position;
  const out: WindowState = { detached: entry?.detached === true };
  if (p && finite(p.left) && finite(p.top) && finite(p.width) && finite(p.height))
    out.position = { left: p.left, top: p.top, width: p.width, height: p.height };
  return out;
}

export function withWindowState(
  all: unknown,
  id: string,
  patch: Partial<WindowState>,
): Record<string, object> {
  const stored = (all ?? {}) as Stored;
  return { ...stored, [id]: { ...stored[id], ...patch } };
}
