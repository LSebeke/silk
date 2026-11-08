import { describe, expect, it } from 'vitest';
import { clampPose, dragPose, hoodPose, imageBox, SCALE, tokenGeometry } from './geometry';

const centred = { anchorX: 0.5, anchorY: 0.5, scale: 1 };

describe('Token geometry: Foundry writes (v1.1 §G.3, #134)', () => {
  it('ring on: the image covers the frame; the ring keeps full size (subject scale 1)', () => {
    expect(tokenGeometry({ anchorX: 0.4, anchorY: 0.3, scale: 2 }, true)).toEqual({
      'texture.fit': 'cover',
      'texture.anchorX': 0.4,
      'texture.anchorY': 0.3,
      'texture.scaleX': 2,
      'texture.scaleY': 2,
      'ring.subject.scale': 1,
    });
  });

  it('ring off: the plain token, contained; a mirrored axis stays mirrored', () => {
    expect(tokenGeometry(centred, false, { x: -1, y: 1 })).toMatchObject({
      'texture.fit': 'contain',
      'texture.scaleX': -1,
      'texture.scaleY': 1,
    });
  });
});

describe('Token geometry: the hood (#133)', () => {
  it('centred; 0.7 of the frame inside the ring, full size without', () => {
    expect(hoodPose(true)).toEqual({ anchorX: 0.5, anchorY: 0.5, scale: 0.7 });
    expect(hoodPose(false)).toEqual(centred);
  });
});

describe('Token geometry: the preview', () => {
  it('ring: a wide image covers the frame, its height fills it', () => {
    expect(imageBox(centred, true, 2)).toEqual({ left: -0.5, top: 0, width: 2, height: 1 });
  });

  it('no ring: a tall image is contained, scaled and placed by the anchor', () => {
    expect(imageBox({ anchorX: 0.5, anchorY: 0.25, scale: 2 }, false, 0.5)).toEqual({
      left: 0,
      top: 0,
      width: 1,
      height: 2,
    });
  });
});

describe('Token geometry: editing the pose', () => {
  it('scale 1 to 8 (#137)', () => {
    expect(SCALE).toMatchObject({ min: 1, max: 8 });
    expect(clampPose({ ...centred, scale: 12 }, false, 1).scale).toBe(8);
    expect(clampPose({ ...centred, scale: 0.5 }, false, 1).scale).toBe(1);
  });

  it('ring: the image cannot be dragged off the frame', () => {
    // A square image at scale 2 is twice the frame: its anchor stays within [0.25, 0.75].
    expect(dragPose({ ...centred, scale: 2 }, 5, -5, true, 1)).toEqual({
      anchorX: 0.25,
      anchorY: 0.75,
      scale: 2,
    });
  });

  it('ring: a square image at scale 1 stays centred', () => {
    expect(dragPose(centred, 0.3, 0, true, 1)).toEqual(centred);
  });

  it('ring: a wide image pans sideways at scale 1', () => {
    expect(dragPose(centred, 0.25, 0, true, 2)).toEqual({ ...centred, anchorX: 0.375 });
  });

  it('no ring: drags freely within the image', () => {
    expect(dragPose(centred, 0.2, 0.1, false, 1)).toEqual({ anchorX: 0.3, anchorY: 0.4, scale: 1 });
  });
});
