import { describe, expect, it } from 'vitest';
import { createRingStyle, DEFAULT_EDGES, ringPreview, type SheetJson } from './ring-style';

const sheet: SheetJson = {
  config: { defaultColorBand: { startRadius: 0.6, endRadius: 0.8 }, defaultRingColor: '#400c07' },
  frames: {
    'med-ring': { frame: { x: 0, y: 0, w: 512, h: 512 }, gridTarget: 1 },
    'med-ring-bkg': { frame: { x: 512, y: 0, w: 512, h: 512 } },
    'gnt-ring': {
      frame: { x: 0, y: 512, w: 1024, h: 1024 },
      gridTarget: 4,
      colorBand: { startRadius: 0.7, endRadius: 0.75 },
    },
  },
  meta: { image: 'texture.webp', size: { w: 2048, h: 2048 } },
};

describe('ring style (#135, #171)', () => {
  it("the world style's ring for the token size, its background and edges", () => {
    expect(ringPreview(sheet, 'https://vtt/systems/dsa5/icons/tokenring/texture.json')).toEqual({
      src: 'https://vtt/systems/dsa5/icons/tokenring/texture.webp',
      sheet: { w: 2048, h: 2048 },
      ring: { x: 0, y: 0, w: 512, h: 512 },
      background: { x: 512, y: 0, w: 512, h: 512 },
      edges: { inner: 0.6, outer: 0.8 },
      colors: { ring: '#400c07', background: undefined },
    });
    expect(ringPreview(sheet, 'https://vtt/t.json', 4)?.ring.w).toBe(1024);
  });

  it('edges per token size, read once; Foundry defaults without a style', async () => {
    let reads = 0;
    const style = createRingStyle(
      () => 'https://vtt/t.json',
      async () => (reads++, sheet),
    );
    expect(await style.edges(1)).toEqual({ inner: 0.6, outer: 0.8 });
    expect(await style.edges(4)).toEqual({ inner: 0.7, outer: 0.75 });
    expect(reads).toBe(1);
    expect(
      await createRingStyle(
        () => undefined,
        async () => sheet,
      ).edges(1),
    ).toEqual(DEFAULT_EDGES);
  });

  it('a failed read is tried again', async () => {
    let reads = 0;
    const style = createRingStyle(
      () => 'https://vtt/t.json',
      async () => (reads++ ? sheet : undefined),
    );
    expect(await style.preview()).toBeUndefined();
    expect((await style.preview())?.edges.inner).toBe(0.6);
  });
});
