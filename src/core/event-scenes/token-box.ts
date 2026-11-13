/**
 * Token Box (spec 1.1 §I): the marked area beside an Event Scene, in the Scene padding just
 * outside the map's top-left corner, where present at actors' tokens are placed hidden.
 *
 * - Garn's box is anchored a grid square up-left of the map corner and grows leftwards with
 *   its tokens, one row. Without room it asks for the Scene's `padding` raised just enough, up
 *   to 0.5; beyond that it keeps adding rows (upwards, along the top edge).
 * - Cells fill from the box's bottom-right, so growing never moves a placed token. A full box
 *   always grows: tokens are never stacked.
 * - Garn records the rect it wrote (`flags.garn.rect`). A box whose rect differs (the GM moved
 *   or resized it) keeps its place: Garn only places into it, adding rows above when full.
 * - v1's Narrative box (no `flags.garn.rect`, at v1's fixed rect) is Garn's: the load-time
 *   migration moves it, and the tokens in it, into the padding.
 *
 * Pure: `ensureBox`, `boxSlot` and `migrateBox` say what to write, the Event Scenes core
 * writes it.
 */
import type { Rect } from '../canvas/groups';
import type { Point } from '../elements/element';
import type { SceneData, TokenData } from './port';
import { GRID_SIZE, HEIGHT, WIDTH } from './presets';

/** A box Drawing as Garn reads it. */
export interface BoxDrawing {
  _id: string;
  x: number;
  y: number;
  shape: { type?: string; width: number; height: number; [key: string]: unknown };
  flags: { garn: { box: true; rect?: Rect }; [scope: string]: unknown };
  [key: string]: unknown;
}

/** What to write, in order: the padding, the box, then the moved tokens. */
export interface BoxPlan {
  /** Raise the Scene's padding first (placeables follow the map). */
  padding?: number;
  /** A new box Drawing. */
  create?: BoxDrawing;
  /** The existing box Drawing, changed. */
  update?: BoxDrawing;
  /** Tokens moved (whole token data, new `x`/`y`). */
  tokens?: TokenData[];
}

/** Foundry `Scene` field defaults. */
const DEFAULTS = { width: WIDTH, height: HEIGHT, padding: 0.25, grid: GRID_SIZE } as const;
const MAX_PADDING = 0.5;
/** Foundry's `padding` step (0.05) as steps per 1. */
const STEPS = 20;
/** v1's Narrative box rect (v1 presets.ts `BOX`), written without `flags.garn.rect`. */
const V1_RECT: Rect = { x: 100, y: 100, width: 1000, height: 400 };

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
  (d as { flags?: { garn?: { box?: unknown } } } | null)?.flags?.garn?.box === true;

export const boxOf = (scene: SceneData) => (scene.drawings ?? []).find(isBox);

const rectOf = (d: BoxDrawing): Rect => ({
  x: d.x,
  y: d.y,
  width: d.shape.width,
  height: d.shape.height,
});
const sameRect = (a: Rect, b: Rect | undefined) =>
  !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const inside = (p: Point, r: Rect) =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

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

/** `rect` one row taller, its bottom-right kept (the cells already used stay put). */
function withRow(rect: Rect, g: number): Rect {
  const m = g / 2;
  const rows = Math.max(1, Math.floor((rect.height - 2 * m) / g));
  const height = Math.max(rect.height, (rows + 1) * g + 2 * m);
  return { ...rect, y: rect.y + rect.height - height, height };
}

/** Garn's box for `n` cells: its rect and the padding it needs (undefined = as is). */
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
  // Past 0.5: as many rows as it takes (never stack).
  const padding = Math.max(current, MAX_PADDING);
  const cols = Math.max(1, room(padding).cols);
  return at(padding, cols, Math.ceil(n / cols));
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
    flags: { garn: { box: true, rect } },
  };
}

/** `box` at `rect`; Garn's own box (`own`) records it as Garn's rect. */
const resized = (box: BoxDrawing, rect: Rect, own: boolean): BoxDrawing => ({
  ...box,
  x: rect.x,
  y: rect.y,
  shape: { ...box.shape, width: rect.width, height: rect.height },
  flags: own ? { ...box.flags, garn: { ...box.flags.garn, rect } } : box.flags,
});

const padded = (padding: number | undefined) => (padding !== undefined ? { padding } : {});

export interface BoxOptions {
  newId(): string;
  /** The box's label ("Tokens", localised). */
  label: string;
}

/** What to write so the Scene has its box: a new one, the padding raised for it, or nothing. */
export function ensureBox(scene: SceneData, opts: BoxOptions): BoxPlan {
  if (boxOf(scene)) return {};
  const { rect, padding } = layout(scene, 1);
  return { ...padded(padding), create: newBox(opts.newId(), opts.label, rect) };
}

/**
 * A free slot for one more token, and what to write for it: the box made, or grown when full
 * (Garn's box by its layout, a GM's box by a row above), the padding raised as needed.
 */
export function boxSlot(scene: SceneData, opts: BoxOptions): BoxPlan & { slot: Point } {
  const g = gridOf(scene);
  const existing = boxOf(scene);
  if (!existing) {
    const { rect, padding } = layout(scene, 1);
    const create = newBox(opts.newId(), opts.label, rect);
    return { ...padded(padding), create, slot: cells(rect, g)[0] as Point };
  }
  const rect = rectOf(existing);
  const have = cells(rect, g);
  const tokens = (scene.tokens ?? []) as Point[];
  const taken = (c: Point) =>
    tokens.some((t) => Math.abs(t.x - c.x) < g / 2 && Math.abs(t.y - c.y) < g / 2);
  const free = have.find((c) => !taken(c));
  if (free) return { slot: free };
  const own = sameRect(rect, existing.flags.garn.rect);
  const laid = own ? layout(scene, have.length + 1) : undefined;
  const grown =
    laid && cells(laid.rect, g).length > have.length ? laid : { rect: withRow(rect, g) };
  return {
    ...padded(grown.padding),
    update: resized(existing, grown.rect, own),
    slot: cells(grown.rect, g)[have.length] as Point,
  };
}

/**
 * Load-time migration (1.1 §I): v1's Narrative box, known by its v1 rect, becomes Garn's box
 * in the padding, in the 1.1 look; the tokens in it move into its cells. `undefined` when
 * there is nothing to migrate.
 */
export function migrateBox(scene: SceneData, opts: BoxOptions): BoxPlan | undefined {
  const existing = boxOf(scene);
  if (!existing || existing.flags.garn.rect || !sameRect(rectOf(existing), V1_RECT))
    return undefined;
  const held = (scene.tokens ?? []).filter((t) => inside(t, V1_RECT));
  const { rect, padding } = layout(scene, Math.max(1, held.length));
  const slots = cells(rect, gridOf(scene));
  return {
    ...padded(padding),
    update: { ...newBox(existing._id, opts.label, rect), locked: false },
    tokens: held.map((t, i) => ({ ...t, ...(slots[i] as Point) })),
  };
}
