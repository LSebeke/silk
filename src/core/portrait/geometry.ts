/**
 * Token geometry (v1.1 §G.3 "Ring composition", #134, #171): where the token image sits, for
 * the Foundry writes, the subject file and the editor preview alike. Pure.
 *
 * The frame is the ring's square, side 1 (Foundry draws background, ring, then subject, all
 * in it). With the ring on, Garn renders the subject itself: the image, posed, covering the
 * crop circle and cut to it (`subjectBox`). Foundry gets that file with the texture centred.
 * Without the ring the image is contained and the pose anchor is the texture anchor. The
 * texture scale is never Garn's: it is the actor's size factor (#168).
 */

/**
 * Where the image sits: the image point at the frame centre, and its scale relative to the
 * crop circle (ring) or the frame (no ring).
 */
export interface Pose {
  anchorX: number;
  anchorY: number;
  scale: number;
}

/** The editor's scale range (v1.1 §G.3, #137, #167). */
export const SCALE = { min: 0.5, max: 8, step: 0.05 } as const;

/**
 * Draw order (v1.1 §G.3, #170): Foundry always draws the subject over the ring, so the crop
 * decides which shows in front. Default `ring`.
 */
export type Order = 'ring' | 'illustration';

/** Ring in front: the draw order without `flags.garn.order`. */
export const DEFAULT_ORDER: Order = 'ring';

/** Foundry's token defaults (common/documents/token.mjs). Also the editor's Reset. */
export const CENTRED: Pose = { anchorX: 0.5, anchorY: 0.5, scale: 1 };

/** What players see while hooded: the hood centred at 0.7 of the subject, in its ring (#133, #182). */
export const HOOD_POSE: Readonly<Pose> = { ...CENTRED, scale: 0.7 };

/**
 * The world ring style's colour band edges, as fractions of the ring radius (Foundry's
 * `colorBand.startRadius` / `endRadius`).
 */
export interface Edges {
  inner: number;
  outer: number;
}

/** Foundry's colour band when the style gives none (TokenRing). */
export const DEFAULT_EDGES: Edges = { inner: 0.59, outer: 0.7225 };

/**
 * A token's size in grid units, as Foundry picks its ring frame (`min(width, height)`): the
 * subject file and the editor preview use the same frame (v1.1 §G.3).
 */
export const tokenSize = (token: { width?: number; height?: number } | undefined): number =>
  Math.min(token?.width ?? 1, token?.height ?? 1);

/**
 * The subject's crop radius (fraction of the ring radius, #171): the ring's inner edge for
 * Ring in front, its outer edge for Illustration in front (#170).
 */
export const subjectCrop = (edges: Edges, order: Order): number =>
  order === 'illustration' ? edges.outer : edges.inner;

/** A box in the frame (side 1, origin top left). */
export interface ImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The subject: where the image is drawn and, with the ring, the circle it is cut to. */
export interface SubjectBox {
  box: ImageBox;
  /** Radius of the crop circle, centred in the frame (frame units); none without a ring. */
  circle?: number;
}

/**
 * The one subject geometry (v1.1 §G.3): for the subject file and the editor preview.
 * `crop`: the crop radius as a fraction of the ring radius; `undefined` without a ring (the
 * plain token: contained, placed by the anchor, unscaled). `aspect`: image width / height.
 */
export function subjectBox(pose: Pose, crop: number | undefined, aspect = 1): SubjectBox {
  const { width, height } = imageSize(pose.scale, crop, aspect);
  const box = {
    left: 0.5 - pose.anchorX * width,
    top: 0.5 - pose.anchorY * height,
    width,
    height,
  };
  return crop === undefined ? { box } : { box, circle: crop / 2 };
}

/**
 * Token update data (unprefixed keys) for `pose`: with the ring the subject file carries the
 * pose and the texture stays centred; without it the anchor is the pose's. Never the texture
 * scale (the size factor, #168); the ring subject scale stays 1.
 */
export function tokenData(pose: Pose, ring: boolean): Record<string, unknown> {
  const at = ring ? CENTRED : pose;
  return {
    'texture.fit': 'contain',
    'texture.anchorX': at.anchorX,
    'texture.anchorY': at.anchorY,
    'ring.subject.scale': 1,
  };
}

/**
 * Image size in frame units. Ring: covering the crop circle's square, times the scale. No
 * ring: contained in the frame (Foundry does not scale it for Garn).
 */
function imageSize(scale: number, crop: number | undefined, aspect: number) {
  const ring = crop !== undefined;
  const side = ring ? crop * scale : 1;
  const long = ring ? Math.max(aspect, 1 / aspect) : 1;
  const short = ring ? 1 : Math.min(aspect, 1 / aspect);
  return aspect >= 1
    ? { width: side * long, height: side * short }
    : { width: side * short, height: side * long };
}

/** `scale` in the editor range, 0.5 to 8 (#137, #167). */
export const clampScale = (scale: number): number =>
  Math.min(SCALE.max, Math.max(SCALE.min, scale));

/**
 * `pose` with the scale in the editor range and, with the ring, the anchor kept so the image
 * still covers the crop circle's square on each axis it is larger than it (no empty edge),
 * and stays inside that square on each axis it is smaller (below 1; the background fills).
 */
export function clampPose(pose: Pose, crop: number | undefined, aspect: number): Pose {
  const scale = clampScale(pose.scale);
  // In crop units (the circle's square is 1), so the bounds do not depend on the crop.
  const { width, height } = imageSize(scale, crop === undefined ? undefined : 1, aspect);
  const axis = (anchor: number, size: number) => {
    // The image edge meets the square's edge at anchor m or 1 - m.
    const m = crop !== undefined ? 1 / (2 * size) : 0;
    return Math.min(Math.max(m, 1 - m), Math.max(Math.min(m, 1 - m), anchor));
  };
  return {
    anchorX: round(axis(pose.anchorX, width)),
    anchorY: round(axis(pose.anchorY, height)),
    scale: round(scale),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The pose after dragging the image by `dx`, `dy` (frame units). */
export function dragPose(
  pose: Pose,
  dx: number,
  dy: number,
  crop: number | undefined,
  aspect: number,
): Pose {
  const { width, height } = imageSize(pose.scale, crop, aspect);
  return clampPose(
    { ...pose, anchorX: pose.anchorX - dx / width, anchorY: pose.anchorY - dy / height },
    crop,
    aspect,
  );
}
