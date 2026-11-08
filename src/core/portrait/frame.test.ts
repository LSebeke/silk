import { describe, expect, it } from 'vitest';
import { frameCorners, framePadding, ringUv, type MeshShape } from './frame';

/** A 200×100 texture contained in a 100 px token: mesh scale 0.5. */
const wide: MeshShape = {
  width: 200,
  height: 100,
  anchorX: 0.5,
  anchorY: 0.5,
  scaleX: 0.5,
  scaleY: 0.5,
  paddingX: 0,
  paddingY: 0,
};

describe('token frame geometry', () => {
  it('pads the mesh so its quad covers the ring around the token centre', () => {
    // Height: 50 px shown, the ring needs 100: 50 texture px each side.
    expect(framePadding(wide, 100)).toEqual({ x: 0, y: 50 });
    // Anchored off centre: the short side towards the centre needs more.
    expect(framePadding({ ...wide, anchorX: 0.25, scaleX: 1, scaleY: 1 }, 200)).toEqual({
      x: 50,
      y: 50,
    });
  });

  it('corners in ring space: the ring edge is 1, wherever the anchor puts the image', () => {
    expect(frameCorners({ ...wide, paddingY: 50 }, 100)).toEqual([
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]);
    // Anchor 0.25: the image's left quarter is left of the centre.
    expect(frameCorners({ ...wide, anchorX: 0.25, paddingY: 50 }, 100)[0]).toEqual([-0.5, -1]);
  });

  it('ring UVs: ring space mapped onto the frame in the spritesheet', () => {
    const uvs = [0.5, 0, 1, 0, 1, 0.5, 0.5, 0.5];
    expect(ringUv(uvs, [-1, -1])).toEqual([0.5, 0]);
    expect(ringUv(uvs, [0, 0])).toEqual([0.75, 0.25]);
    expect(ringUv(uvs, [-2, 1])).toEqual([0.25, 0.5]);
  });
});
