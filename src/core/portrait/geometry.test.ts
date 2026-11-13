import { describe, expect, it } from 'vitest';
import {
  clampPose,
  clampScale,
  dragPose,
  HOOD_POSE,
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
  it('centred at 0.7 of the subject (always in its ring, #182)', () => {
    expect(HOOD_POSE).toEqual({ anchorX: 0.5, anchorY: 0.5, scale: 0.7 });
  });
});

describe('Token geometry: the subject (file and preview)', () => {
  it('ring in front: cut to the inner edge; illustration in front: the outer edge (#170)', () => {
    expect(subjectCrop({ inner: 0.666, outer: 0.72 }, 'ring')).toBe(0.666);
    expect(subjectCrop({ inner: 0.666, outer: 0.72 }, 'illustration')).toBe(0.72);
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
  it('scale 0.5 to 8 (#137, #167)', () => {
    expect(SCALE).toMatchObject({ min: 0.5, max: 8 });
    expect(clampPose({ ...centred, scale: 12 }, undefined, 1).scale).toBe(8);
    expect(clampPose({ ...centred, scale: 0.2 }, undefined, 1).scale).toBe(0.5);
    expect(clampScale(9)).toBe(8);
    expect(clampScale(0.2)).toBe(0.5);
  });

  it('ring, below 1: the image moves freely inside the crop square, not past its edge', () => {
    // At 0.5 the image is half the circle's square: its anchor may range over [0, 1].
    expect(dragPose({ ...centred, scale: 0.5 }, 0.2, -0.2, 0.6, 1)).toEqual({
      anchorX: 0,
      anchorY: 1,
      scale: 0.5,
    });
    // Dragging 0.03 (frame) of a 0.3 wide image moves the anchor 0.1, the edge not yet reached.
    expect(dragPose({ ...centred, scale: 0.5 }, 0.03, 0, 0.6, 1).anchorX).toBe(0.4);
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
