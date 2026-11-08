import { describe, expect, it } from 'vitest';
import {
  frameCorners,
  framePadding,
  frameShaders,
  ringPreview,
  ringUv,
  type MeshShape,
} from './token-frame';

// The lines Silk patches, as in Foundry v14's TokenRingSamplerShader.
const VERTEX = `in vec2 aRingTextureCoord;
    void _main() {
      vRingTextureCoord = aRingTextureCoord;
    }`;
const FRAGMENT = `in vec2 vRingTextureCoord;
    vec2 scaledDistVec = (vOrigTextureCoord - 0.5) * 2.0 * vScaleCorrection;
    float dist = length(scaledDistVec);
    vec4 blendedResult = blend(processedColor, blend(ringColor, backgroundColor) * rectangularMask);`;

describe('token frame shader (#134)', () => {
  it('ring in front of the cropped image, distances from the token centre', () => {
    const s = frameShaders(VERTEX, FRAGMENT);
    expect(s?.vertex).toContain('vSilkRing = aScaleCorrection;');
    expect(s?.fragment).toContain('vec2 scaledDistVec = vSilkRing;');
    expect(s?.fragment).toContain('blend(ringColor * rectangularMask,');
    expect(s?.fragment).toContain('processedColor * silkMask');
    expect(s?.fragment).not.toContain('blend(processedColor, blend(ringColor');
  });

  it("Foundry's shader changed: no frame (Foundry's ring stays)", () => {
    expect(frameShaders(VERTEX, 'void main() {}')).toBeUndefined();
  });
});

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

describe('ring preview (#135)', () => {
  const sheet = {
    config: { defaultColorBand: { startRadius: 0.6, endRadius: 0.8 }, defaultRingColor: '#400c07' },
    frames: {
      'med-ring': { frame: { x: 0, y: 0, w: 512, h: 512 }, gridTarget: 1 },
      'med-ring-bkg': { frame: { x: 512, y: 0, w: 512, h: 512 } },
      'gnt-ring': { frame: { x: 0, y: 512, w: 1024, h: 1024 }, gridTarget: 4 },
    },
    meta: { image: 'texture.webp', size: { w: 2048, h: 2048 } },
  };

  it("the world style's ring for the token size, its background and crop radius", () => {
    expect(ringPreview(sheet, 'https://vtt/systems/dsa5/icons/tokenring/texture.json')).toEqual({
      src: 'https://vtt/systems/dsa5/icons/tokenring/texture.webp',
      sheet: { w: 2048, h: 2048 },
      ring: { x: 0, y: 0, w: 512, h: 512 },
      background: { x: 512, y: 0, w: 512, h: 512 },
      crop: 0.7,
      band: { start: 0.6, end: 0.8 },
      colors: { ring: '#400c07', background: undefined },
    });
    expect(ringPreview(sheet, 'https://vtt/t.json', 4)?.ring.w).toBe(1024);
  });
});
