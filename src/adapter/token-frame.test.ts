import { describe, expect, it } from 'vitest';
import { frameShaders, ringPreview } from './token-frame';

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
