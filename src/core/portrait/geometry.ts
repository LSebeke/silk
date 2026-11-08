/**
 * Token geometry (v1.1 §G.3 "Ring composition", #134): where the token image sits in its
 * frame, for the Foundry writes and the editor preview alike. Pure.
 *
 * The frame is the token square, side 1. With the ring on, the ring has the full frame size
 * and is in front; the image covers the frame (`fit: cover`), cropped to the ring's inner
 * circle (Silk's token frame shader, src/adapter/token-frame.ts); the background colour is
 * behind. Without the ring the image is contained (Foundry's default). Either way the pose
 * scale is the texture scale and the anchor is the image point at the frame centre.
 */

/**
 * Where the token sits in its frame: the texture anchor (v14 has no offset) and the scale
 * of the image relative to the frame.
 */
export interface Pose {
  anchorX: number;
  anchorY: number;
  scale: number;
}

/** The editor's scale range (v1.1 §G.3, #137). */
export const SCALE = { min: 1, max: 8, step: 0.05 } as const;

/** Foundry's token defaults (common/documents/token.mjs). Also the editor's Reset. */
export const CENTRED: Pose = { anchorX: 0.5, anchorY: 0.5, scale: 1 };

/** The hood is shown at this scale inside the ring, so it fits its inner circle (#133). */
export const HOOD_RING_SCALE = 0.7;

/** What players see while hooded: the hood centred, smaller inside the ring. */
export const hoodPose = (ring: boolean): Pose => ({
  ...CENTRED,
  scale: ring ? HOOD_RING_SCALE : CENTRED.scale,
});

/** Mirroring of the texture: -1 keeps a mirrored axis mirrored. */
export interface Mirror {
  x: 1 | -1;
  y: 1 | -1;
}

/** The image's box in the frame (frame side 1, origin top left). */
export interface ImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the token image sits for a pose: the Foundry writes and the preview's box. */
export interface TokenGeometry {
  /**
   * Token update data (unprefixed keys): fit, anchor, texture scale and the ring subject
   * scale. Foundry's subject scale only shrinks its ring; Silk keeps it at 1.
   */
  data: Record<string, unknown>;
  /** Where the image is drawn in the frame (the editor preview). */
  box: ImageBox;
}

/**
 * The one token geometry (v1.1 §G.3): `pose` as Foundry token data and as the image's box
 * in the frame. `aspect`: image width / height (only the box depends on it).
 */
export function tokenGeometry(
  pose: Pose,
  ring: boolean,
  { aspect = 1, mirror = { x: 1, y: 1 } }: { aspect?: number; mirror?: Mirror } = {},
): TokenGeometry {
  const { width, height } = imageSize(pose.scale, ring, aspect);
  return {
    data: {
      'texture.fit': ring ? 'cover' : 'contain',
      'texture.anchorX': pose.anchorX,
      'texture.anchorY': pose.anchorY,
      'texture.scaleX': mirror.x * pose.scale,
      'texture.scaleY': mirror.y * pose.scale,
      'ring.subject.scale': 1,
    },
    box: { left: 0.5 - pose.anchorX * width, top: 0.5 - pose.anchorY * height, width, height },
  };
}

/** Image size in frame units: covering (ring) or contained, times the scale. */
function imageSize(scale: number, ring: boolean, aspect: number) {
  const wide = aspect >= 1;
  const long = ring ? Math.max(aspect, 1 / aspect) : 1;
  const short = ring ? 1 : Math.min(aspect, 1 / aspect);
  return wide
    ? { width: scale * long, height: scale * short }
    : { width: scale * short, height: scale * long };
}

/** `scale` in the editor range, 1 to 8 (#137). */
export const clampScale = (scale: number): number =>
  Math.min(SCALE.max, Math.max(SCALE.min, scale));

/**
 * `pose` with the scale in the editor range and, with the ring, the anchor kept so the
 * image still covers the frame (no empty edge inside the ring).
 */
export function clampPose(pose: Pose, ring: boolean, aspect: number): Pose {
  const scale = clampScale(pose.scale);
  const { width, height } = imageSize(scale, ring, aspect);
  const axis = (anchor: number, size: number) => {
    const margin = ring ? Math.min(0.5, 1 / (2 * size)) : 0;
    return Math.min(1 - margin, Math.max(margin, anchor));
  };
  return {
    anchorX: round(axis(pose.anchorX, width)),
    anchorY: round(axis(pose.anchorY, height)),
    scale: round(scale),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The pose after dragging the image by `dx`, `dy` (in frame units). */
export function dragPose(pose: Pose, dx: number, dy: number, ring: boolean, aspect: number) {
  const { width, height } = imageSize(pose.scale, ring, aspect);
  return clampPose(
    { ...pose, anchorX: pose.anchorX - dx / width, anchorY: pose.anchorY - dy / height },
    ring,
    aspect,
  );
}
