import { describe, expect, it } from 'vitest';
import {
  clampPose,
  clampScale,
  dragPose,
  hoodPose,
  SCALE,
  subjectBox,
  subjectCrop,
  tokenData,
} from './geometry';

const centred = { anchorX: 0.5, anchorY: 0.5, scale: 1 };

describe('Token geometry: Foundry writes (v1.1 §G.3, #171, #168)', () => {
  it('ring on: the subject file carries the pose; the texture stays centred, unscaled', () => {
    expect(tokenData({ anchorX: 0.4, anchorY: 0.3, scale: 2 }, true)).toEqual({
      'texture.fit': 'contain',
      'texture.anchorX': 0.5,
      'texture.anchorY': 0.5,
      'ring.subject.scale': 1,
    });
  });

  it('ring off: the anchor is the pose anchor; never the texture scale (size factor)', () => {
    const data = tokenData({ anchorX: 0.4, anchorY: 0.3, scale: 2 }, false);
    expect(data).toMatchObject({ 'texture.anchorX': 0.4, 'texture.anchorY': 0.3 });
    expect(data).not.toHaveProperty(['texture.scaleX']);
  });
});

describe('Token geometry: the hood (#133)', () => {
  it('centred; 0.7 of the subject inside the ring, full size without', () => {
    expect(hoodPose(true)).toEqual({ anchorX: 0.5, anchorY: 0.5, scale: 0.7 });
    expect(hoodPose(false)).toEqual(centred);
  });
});

describe('Token geometry: the subject (file and preview)', () => {
  it('ring in front: cut to the inner edge', () => {
    expect(subjectCrop({ inner: 0.666, outer: 0.72 })).toBe(0.666);
  });

  it('ring: a square image covers the crop circle; the circle is centred', () => {
    expect(subjectBox(centred, 0.6)).toEqual({
      box: { left: 0.2, top: 0.2, width: 0.6, height: 0.6 },
      circle: 0.3,
    });
  });

  it('ring: a wide image, zoomed and panned, its height covering the circle twice', () => {
    expect(subjectBox({ anchorX: 0.25, anchorY: 0.5, scale: 2 }, 0.5, 2)).toEqual({
      box: { left: 0, top: 0, width: 2, height: 1 },
      circle: 0.25,
    });
  });

  it('no ring: a tall image is contained, placed by the anchor, unscaled', () => {
    expect(subjectBox({ anchorX: 0.5, anchorY: 0.25, scale: 2 }, undefined, 0.5)).toEqual({
      box: { left: 0.25, top: 0.25, width: 0.5, height: 1 },
    });
  });
});

describe('Token geometry: editing the pose', () => {
  it('scale 1 to 8 (#137)', () => {
    expect(SCALE).toMatchObject({ min: 1, max: 8 });
    expect(clampPose({ ...centred, scale: 12 }, undefined, 1).scale).toBe(8);
    expect(clampPose({ ...centred, scale: 0.5 }, undefined, 1).scale).toBe(1);
    expect(clampScale(9)).toBe(8);
    expect(clampScale(0.2)).toBe(1);
  });

  it('ring: the image cannot be dragged off the crop circle', () => {
    // At scale 2 the image is twice the circle's square: its anchor stays within [0.25, 0.75].
    expect(dragPose({ ...centred, scale: 2 }, 5, -5, 0.6, 1)).toEqual({
      anchorX: 0.25,
      anchorY: 0.75,
      scale: 2,
    });
  });

  it('ring: a square image at scale 1 stays centred', () => {
    expect(dragPose(centred, 0.3, 0, 0.6, 1)).toEqual(centred);
  });

  it('ring: a wide image pans sideways at scale 1, in frame units', () => {
    // Image 1.0 wide in the frame (crop 0.5, aspect 2): dragging 0.125 moves the anchor 0.125.
    expect(dragPose(centred, 0.125, 0, 0.5, 2)).toEqual({ ...centred, anchorX: 0.375 });
  });

  it('no ring: drags freely within the image', () => {
    expect(dragPose(centred, 0.2, 0.1, undefined, 1)).toEqual({
      anchorX: 0.3,
      anchorY: 0.4,
      scale: 1,
    });
  });
});
