/**
 * The world's token ring style (`core.dynamicTokenRing`, v1.1 §G.3): its spritesheet, read
 * once per session, for the editor preview (#135) and the ring edges the subject file is cut
 * to (#171). Silk never changes the style; Foundry draws the ring.
 */
import type { Edges } from '../core/portrait';

/** A rectangle in the spritesheet image (px). */
export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The world ring style for a token size, as the editor preview draws it. */
export interface RingPreview {
  /** Spritesheet image URL and size (px). */
  src: string;
  sheet: { w: number; h: number };
  ring: SheetRect;
  background?: SheetRect;
  /** The ring's colour band (fractions of the ring radius), where the ring colour shows. */
  edges: Edges;
  /** The style's own colours, when the token sets none. */
  colors: { ring?: string; background?: string };
}

/** Foundry's colour band when the style gives none (TokenRing). */
export const DEFAULT_EDGES: Edges = { inner: 0.59, outer: 0.7225 };

export interface SheetJson {
  config?: {
    defaultColorBand?: { startRadius?: number; endRadius?: number };
    defaultRingColor?: string;
    defaultBackgroundColor?: string;
  };
  frames: Record<
    string,
    {
      frame: SheetRect;
      gridTarget?: number;
      ringColor?: string;
      backgroundColor?: string;
      colorBand?: { startRadius?: number; endRadius?: number };
    }
  >;
  meta: { image: string; size: { w: number; h: number } };
}

/**
 * The ring of a Foundry ring spritesheet for a token `size` grid units wide: the frame
 * whose `gridTarget` is closest, as Foundry picks it, with its `-bkg` frame.
 */
export function ringPreview(json: SheetJson, url: string, size = 1): RingPreview | undefined {
  const rings = Object.keys(json.frames).filter((n) => !/-(bkg|msk)$/.test(n));
  const target = (n: string) => json.frames[n]?.gridTarget ?? 1;
  const name = rings.sort((a, b) => Math.abs(target(a) - size) - Math.abs(target(b) - size))[0];
  const ring = name ? json.frames[name] : undefined;
  if (!name || !ring) return undefined;
  const band = ring.colorBand ?? json.config?.defaultColorBand ?? {};
  return {
    src: new URL(json.meta.image, url).href,
    sheet: json.meta.size,
    ring: ring.frame,
    background: json.frames[`${name}-bkg`]?.frame,
    edges: {
      inner: band.startRadius ?? DEFAULT_EDGES.inner,
      outer: band.endRadius ?? DEFAULT_EDGES.outer,
    },
    colors: {
      ring: ring.ringColor ?? json.config?.defaultRingColor,
      background: ring.backgroundColor ?? json.config?.defaultBackgroundColor,
    },
  };
}

/**
 * The world's ring style, read once per spritesheet. `fetchJson`: `undefined` when it cannot
 * be read (then tried again next time).
 */
export function createRingStyle(
  spritesheet: () => string | undefined,
  fetchJson: (url: string) => Promise<SheetJson | undefined>,
) {
  const loaded = new Map<string, Promise<SheetJson | undefined>>();
  async function load(): Promise<{ json: SheetJson; url: string } | undefined> {
    const path = spritesheet();
    if (!path) return undefined;
    const url = new URL(path, globalThis.location?.href ?? 'http://localhost/').href;
    let json = loaded.get(url);
    if (!json) loaded.set(url, (json = fetchJson(url)));
    const result = await json;
    if (!result) loaded.delete(url);
    return result && { json: result, url };
  }
  return {
    /** The style for the editor preview; `undefined` without one. */
    async preview(size = 1): Promise<RingPreview | undefined> {
      const style = await load();
      return style && ringPreview(style.json, style.url, size);
    },
    /** The edges the subject is cut to, for a token `size` grid units wide. */
    async edges(size: number): Promise<Edges> {
      const style = await load();
      return (style && ringPreview(style.json, style.url, size)?.edges) ?? DEFAULT_EDGES;
    },
  };
}

/** The world's ring style over Foundry's `CONFIG.Token.ring` and `fetch`. */
export function foundryRingStyle() {
  return createRingStyle(
    () => (CONFIG.Token as { ring?: { spritesheet?: string } }).ring?.spritesheet,
    async (url) => {
      try {
        const response = await fetch(url);
        return response.ok ? ((await response.json()) as SheetJson) : undefined;
      } catch (error) {
        console.warn('Silk | ring style not loaded', error);
        return undefined;
      }
    },
  );
}
