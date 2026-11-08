/**
 * Silk's token frame (v1.1 §G.3 "Ring composition", #134). Foundry's dynamic ring draws the
 * token image over the ring, never crops it, and sizes and centres the ring on the image
 * mesh, so texture fit, scale and anchor move and shrink it. For the tokens of Silk actors
 * with the ring on, Silk's ring shader (a subclass of the world's) instead:
 *
 * - draws the ring centred on the token at the full token size, in front;
 * - crops the image to the ring's inner circle (the middle of its colour band);
 * - keeps the background colour behind.
 *
 * The image itself stays where the token geometry (core/portrait/geometry.ts) puts it. The
 * world's ring style is kept: same spritesheet, colours and effects. Other tokens keep
 * Foundry's ring.
 */

/** The GLSL lines the frame replaces in Foundry's TokenRingSamplerShader (v14). */
const DIST = 'vec2 scaledDistVec = (vOrigTextureCoord - 0.5) * 2.0 * vScaleCorrection;';
const BLEND =
  'vec4 blendedResult = blend(processedColor, blend(ringColor, backgroundColor) * rectangularMask);';
const VARYING = 'vRingTextureCoord = aRingTextureCoord;';

/**
 * Foundry's ring shader sources with the frame. WebGL has no attribute to spare, so the
 * per-vertex `aScaleCorrection` (Foundry's ring scale, used only for the distance) carries
 * the vertex's position in ring space (0 at the token centre, 1 at the ring's outer edge),
 * interpolated as `vSilkRing`; the uniform `silkCrop` is the crop radius. The ring is
 * blended over the cropped image. `undefined` when Foundry's sources changed.
 */
export function frameShaders(vertex: string, fragment: string) {
  if (!vertex.includes(VARYING) || !fragment.includes(DIST) || !fragment.includes(BLEND))
    return undefined;
  return {
    vertex: `out vec2 vSilkRing;\n${vertex.replace(
      VARYING,
      `${VARYING}\n      vSilkRing = aScaleCorrection;`,
    )}`,
    fragment: `in vec2 vSilkRing;\nuniform float silkCrop;\n${fragment
      .replace(DIST, 'vec2 scaledDistVec = vSilkRing;')
      .replace(
        BLEND,
        [
          'float silkMask = 1.0 - smoothstep(silkCrop - fwidth(dist), silkCrop, dist);',
          'vec4 blendedResult = blend(ringColor * rectangularMask,',
          '  blend(processedColor * silkMask, backgroundColor * rectangularMask));',
        ].join('\n    '),
      )}`,
  };
}

/** The image mesh as the frame needs it (Foundry SpriteMesh, before its world transform). */
export interface MeshShape {
  /** Texture size (px). */
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** Mesh scale (fit times texture scale; negative when mirrored). */
  scaleX: number;
  scaleY: number;
  paddingX: number;
  paddingY: number;
}

/** Padding (texture px) so the mesh quad covers the ring: a square of `size` px, centred. */
export function framePadding(mesh: MeshShape, size: number): { x: number; y: number } {
  const axis = (length: number, anchor: number, scale: number) =>
    Math.max(0, size / 2 / Math.abs(scale || 1) - Math.min(anchor, 1 - anchor) * length);
  return {
    x: axis(mesh.width, mesh.anchorX, mesh.scaleX),
    y: axis(mesh.height, mesh.anchorY, mesh.scaleY),
  };
}

/**
 * The quad's four corners (top left, top right, bottom right, bottom left, as Foundry's
 * vertexData) in ring space: the token centre is 0, the ring's outer edge 1.
 */
export function frameCorners(mesh: MeshShape, size: number): [number, number][] {
  const x1 = -mesh.anchorX * mesh.width - mesh.paddingX;
  const x0 = x1 + mesh.width + 2 * mesh.paddingX;
  const y1 = -mesh.anchorY * mesh.height - mesh.paddingY;
  const y0 = y1 + mesh.height + 2 * mesh.paddingY;
  const r = size / 2;
  const at = (x: number, y: number): [number, number] => [
    (x * mesh.scaleX) / r,
    (y * mesh.scaleY) / r,
  ];
  return [at(x1, y1), at(x0, y1), at(x0, y0), at(x1, y0)];
}

/** The UV of ring-space point `p` in a frame whose corner UVs (TL, TR, BR, BL) are `uvs`. */
export function ringUv(uvs: ArrayLike<number>, [px, py]: [number, number]): [number, number] {
  const u0 = uvs[0] as number;
  const u1 = uvs[2] as number;
  const v0 = uvs[1] as number;
  const v1 = uvs[7] as number;
  return [u0 + ((px + 1) / 2) * (u1 - u0), v0 + ((py + 1) / 2) * (v1 - v0)];
}

/** A rectangle in the spritesheet image (px). */
export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The world ring style as the editor preview draws it (v1.1 §G.3, #135). */
export interface RingPreview {
  /** Spritesheet image URL and size (px). */
  src: string;
  sheet: { w: number; h: number };
  ring: SheetRect;
  background?: SheetRect;
  /** Crop radius of the image, as a fraction of the ring radius. */
  crop: number;
  /** The ring's colour band (fractions of the ring radius), where the ring colour shows. */
  band: { start: number; end: number };
  /** The style's own colours, when the token sets none. */
  colors: { ring?: string; background?: string };
}

interface SheetJson {
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
  const colorBand = ring.colorBand ?? json.config?.defaultColorBand ?? {};
  const band = { start: colorBand.startRadius ?? 0.59, end: colorBand.endRadius ?? 0.7225 };
  return {
    src: new URL(json.meta.image, url).href,
    sheet: json.meta.size,
    ring: ring.frame,
    background: json.frames[`${name}-bkg`]?.frame,
    crop: (band.start + band.end) / 2,
    band,
    colors: {
      ring: ring.ringColor ?? json.config?.defaultRingColor,
      background: ring.backgroundColor ?? json.config?.defaultBackgroundColor,
    },
  };
}

/** The world's ring style for the preview; `undefined` without one (or on a load error). */
export async function loadRingPreview(): Promise<RingPreview | undefined> {
  const path = (CONFIG.Token as { ring?: { spritesheet?: string } }).ring?.spritesheet;
  if (!path) return undefined;
  try {
    const url = new URL(path, window.location.href).href;
    const response = await fetch(url);
    return response.ok ? ringPreview((await response.json()) as SheetJson, url) : undefined;
  } catch (error) {
    console.warn('Silk | ring style not loaded', error);
    return undefined;
  }
}

/* ------------------------------------------------------------------------------------- */
/*  Foundry glue                                                                          */
/* ------------------------------------------------------------------------------------- */

/* eslint-disable @typescript-eslint/no-explicit-any -- Foundry's canvas internals are untyped */
type FoundryToken = any;

/**
 * Installs the frame. `framed(document)`: the token document is a Silk actor's. Call at
 * init; the shader is built when the canvas is configured (after systems set their ring).
 */
export function installTokenFrame(framed: (document: FoundryToken) => boolean): void {
  let shader: any;
  // DSA5's auto size sets the texture scale of a new token; a posed Silk token keeps its pose.
  Hooks.on(
    'preCreateToken' as never,
    ((doc: FoundryToken) => {
      const texture = doc.actor?.prototypeToken?.texture;
      if (!texture || !framed(doc)) return;
      if (Math.abs(texture.scaleX) === 1 && Math.abs(texture.scaleY) === 1) return;
      doc.updateSource({ texture: { scaleX: texture.scaleX, scaleY: texture.scaleY } });
    }) as never,
  );
  Hooks.once(
    'canvasConfig' as never,
    (() => {
      try {
        shader = frameShaderClass();
      } catch (error) {
        console.error('Silk | token frame unavailable', error);
      }
    }) as never,
  );
  Hooks.on(
    'refreshToken' as never,
    ((token: FoundryToken) => {
      if (!shader || !token.hasDynamicRing || !token.mesh || !framed(token.document)) return;
      const { width, height } = token.document.getSize();
      const pad = framePadding(meshShape(token.mesh), Math.min(width, height));
      token.mesh.paddingX = pad.x;
      token.mesh.paddingY = pad.y;
      token.mesh.setShaderClass(shader);
    }) as never,
  );
}

function meshShape(mesh: any): MeshShape {
  const orig = mesh.texture?.orig ?? { width: 1, height: 1 };
  return {
    width: orig.width,
    height: orig.height,
    anchorX: mesh.anchor.x,
    anchorY: mesh.anchor.y,
    scaleX: mesh.scale.x,
    scaleY: mesh.scale.y,
    paddingX: mesh.paddingX,
    paddingY: mesh.paddingY,
  };
}

function frameShaderClass() {
  const g = globalThis as any;
  const Base = g.CONFIG.Token.ring.shaderClass;
  const Primary = g.foundry.canvas.rendering.shaders.PrimaryBaseSamplerShader;
  const found = frameShaders(Base._batchVertexShader, Base._batchFragmentShader);
  if (!found) throw new Error("Foundry's ring shader changed");
  const sources = found;
  // Foundry's ring attributes per vertex: ring, background, mask UVs (2 each), ring and
  // background colour, states, then the scale correction (2).
  const ringOffset = Primary.batchVertexSize;
  const ringSpaceOffset = ringOffset + 9;
  const ringClass = () => g.CONFIG.Token.ring.ringClass;
  const crop = () => {
    const band = ringClass().getRingDataBySize?.(1)?.colorBand ?? {};
    return ((band.startRadius || 0.59) + (band.endRadius || 0.7225)) / 2;
  };

  class SilkTokenFrameShader extends Base {
    static classPluginName = 'silkTokenFrame';
    static _batchVertexShader = sources.vertex;
    static _batchFragmentShader = sources.fragment;

    static batchDefaultUniforms(maxTex: number) {
      return { ...Base.batchDefaultUniforms(maxTex), silkCrop: 0.66 };
    }

    static _preRenderBatch(this: any, batchRenderer: any) {
      Base._preRenderBatch.call(this, batchRenderer);
      batchRenderer.uniforms.silkCrop = crop();
    }

    static _packInterleavedGeometry(
      this: any,
      element: any,
      attributes: any,
      indices: any,
      aIndex: number,
      iIndex: number,
    ) {
      Base._packInterleavedGeometry.call(this, element, attributes, indices, aIndex, iIndex);
      const mesh = element.object;
      const token = mesh?.object;
      const ring = token?.ring;
      const data = ringClass().texturesData;
      if (!ring || !data || !token.document) return;
      const { width, height } = token.document.getSize();
      const corners = frameCorners(meshShape(mesh), Math.min(width, height));
      const uvs = [ring.ringName, ring.bkgName, ring.maskName].map((n) => data[n]?.UVs);
      const { float32View } = attributes;
      const size = this.vertexSize;
      corners.forEach((p, v) => {
        const k = aIndex + v * size;
        uvs.forEach((frame, i) => {
          if (!frame) return;
          const [u, w] = ringUv(frame, p);
          float32View[k + ringOffset + i * 2] = u;
          float32View[k + ringOffset + i * 2 + 1] = w;
        });
        float32View[k + ringSpaceOffset] = p[0];
        float32View[k + ringSpaceOffset + 1] = p[1];
      });
    }
  }
  SilkTokenFrameShader.registerPlugin();
  return SilkTokenFrameShader;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
