/**
 * Token Box (spec 1.1 §I): the marked area beside an Event Scene, in the Scene padding just
 * outside the map's top-left corner, where present at actors' tokens are placed hidden.
 *
 * - Silk's box is anchored a grid square up-left of the map corner and grows leftwards with
 *   its tokens, one row. Without room it asks for the Scene's `padding` raised just enough, up
 *   to 0.5; beyond that it wraps into more rows (upwards, along the top edge).
 * - Cells fill from the box's bottom-right, so growing never moves a placed token.
 * - Silk records the rect it wrote (`flags.silk.rect`). A box whose rect differs (the GM moved
 *   or resized it; v1 Narrative boxes have none) keeps its place: Silk only places into it.
 *
 * Pure: `planBox` says what to write, the Event Scenes core writes it.
 */
import type { SceneData } from './port';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A box Drawing as Silk reads it. */
export interface BoxDrawing {
  _id: string;
  x: number;
  y: number;
  shape: { type?: string; width: number; height: number; [key: string]: unknown };
  flags: { silk: { box: true; rect?: Rect }; [scope: string]: unknown };
  [key: string]: unknown;
}

export interface BoxPlan {
  /** Raise the Scene's padding first (placeables follow the map). */
  padding?: number;
  /** The box Drawing to write. */
  box?: BoxDrawing;
  /** True when `box` is new. */
  create?: boolean;
  /** Where the new token goes (when placing). */
  slot?: Point;
}

/** Foundry `Scene` field defaults. */
const DEFAULTS = { width: 4000, height: 3000, padding: 0.25, grid: 100 } as const;
const MAX_PADDING = 0.5;
/** Foundry's `padding` step (0.05) as steps per 1. */
const STEPS = 20;

const gridOf = (scene: SceneData) =>
  (scene['grid'] as { size?: number } | undefined)?.size || DEFAULTS.grid;
const num = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);

/**
 * The map's top-left on the canvas (Foundry `dimensions.sceneX/Y`), with the given padding.
 * Square/gridless formula; on a hex grid Foundry may put it up to half a hex further.
 */
export function mapOrigin(scene: SceneData, padding = num(scene['padding'], DEFAULTS.padding)) {
  const g = gridOf(scene);
  const pad = (side: number) => Math.ceil(padding * side * (1 / g)) * g;
  return {
    x: pad(num(scene['width'], DEFAULTS.width)) - num(scene['shiftX'], 0),
    y: pad(num(scene['height'], DEFAULTS.height)) - num(scene['shiftY'], 0),
  };
}

export const isBox = (d: unknown): d is BoxDrawing =>
  (d as { flags?: { silk?: { box?: unknown } } } | null)?.flags?.silk?.box === true;

export const boxOf = (scene: SceneData) => (scene.drawings ?? []).find(isBox);

const rectOf = (d: BoxDrawing): Rect => ({
  x: d.x,
  y: d.y,
  width: d.shape.width,
  height: d.shape.height,
});
const same = (a: Rect, b: Rect | undefined) =>
  !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** The box's cells, from its bottom-right corner, row by row. */
function cells(rect: Rect, g: number): Point[] {
  const m = g / 2;
  const cols = Math.max(1, Math.floor((rect.width - 2 * m) / g));
  const rows = Math.max(1, Math.floor((rect.height - 2 * m) / g));
  const right = rect.x + rect.width - m;
  const bottom = rect.y + rect.height - m;
  return Array.from({ length: cols * rows }, (_, i) => ({
    x: right - ((i % cols) + 1) * g,
    y: bottom - (Math.floor(i / cols) + 1) * g,
  }));
}

/** Silk's box for `n` cells: its rect and the padding it needs (undefined = as is). */
function layout(scene: SceneData, n: number): { rect: Rect; padding?: number } {
  const g = gridOf(scene);
  const m = g / 2;
  const current = num(scene['padding'], DEFAULTS.padding);
  const room = (padding: number) => {
    const o = mapOrigin(scene, padding);
    const cols = Math.floor((o.x - g - 2 * m) / g);
    const rows = Math.floor((o.y - g - 2 * m) / g);
    return { o, cols, rows };
  };
  const at = (padding: number, cols: number, rows: number) => {
    const { o } = room(padding);
    const width = cols * g + 2 * m;
    const height = rows * g + 2 * m;
    return {
      rect: { x: o.x - g - width, y: o.y - g - height, width, height },
      ...(padding !== current ? { padding } : {}),
    };
  };
  for (let k = Math.round(current * STEPS); k <= MAX_PADDING * STEPS; k++) {
    const padding = k === Math.round(current * STEPS) ? current : k / STEPS;
    const { cols, rows } = room(padding);
    if (cols >= n && rows >= 1) return at(padding, n, 1);
  }
  const padding = Math.max(current, MAX_PADDING);
  const { cols, rows } = room(padding);
  const c = Math.max(1, cols);
  return at(padding, c, Math.max(1, Math.min(Math.ceil(n / c), rows)));
}

function newBox(id: string, label: string, rect: Rect): BoxDrawing {
  return {
    _id: id,
    x: rect.x,
    y: rect.y,
    shape: { type: 'r', width: rect.width, height: rect.height },
    text: label,
    fontSize: 24,
    textColor: '#000000',
    strokeWidth: 4,
    strokeColor: '#000000',
    strokeAlpha: 1,
    fillType: 1,
    fillColor: '#ffffff',
    fillAlpha: 1,
    flags: { silk: { box: true, rect } },
  };
}

const resized = (box: BoxDrawing, rect: Rect): BoxDrawing => ({
  ...box,
  x: rect.x,
  y: rect.y,
  shape: { ...box.shape, width: rect.width, height: rect.height },
  flags: { ...box.flags, silk: { ...box.flags.silk, rect } },
});

/**
 * What to write so the Scene has its box (`place: false`), or so a new token has a free slot
 * in it (`place: true`): the box is made or grown as needed, the padding raised for it.
 */
export function planBox(
  scene: SceneData,
  opts: { newId(): string; label: string; place: boolean },
): BoxPlan {
  const g = gridOf(scene);
  const existing = boxOf(scene);
  if (!existing) {
    const { rect, padding } = layout(scene, 1);
    return {
      ...(padding !== undefined ? { padding } : {}),
      box: newBox(opts.newId(), opts.label, rect),
      create: true,
      ...(opts.place ? { slot: cells(rect, g)[0] } : {}),
    };
  }
  if (!opts.place) return {};
  const rect = rectOf(existing);
  const have = cells(rect, g);
  const tokens = (scene['tokens'] ?? []) as Point[];
  const taken = (c: Point) =>
    tokens.some((t) => Math.abs(t.x - c.x) < g / 2 && Math.abs(t.y - c.y) < g / 2);
  const free = have.find((c) => !taken(c));
  if (free) return { slot: free };
  const wrap = { slot: have[tokens.length % have.length] };
  if (!same(rect, existing.flags.silk.rect)) return wrap;
  const grown = layout(scene, have.length + 1);
  const next = cells(grown.rect, g);
  if (next.length <= have.length) return wrap;
  return {
    ...(grown.padding !== undefined ? { padding: grown.padding } : {}),
    box: resized(existing, grown.rect),
    slot: next[have.length],
  };
}
