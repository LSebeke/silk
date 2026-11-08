import { describe, expect, it } from 'vitest';
import { createSubjectFiles } from './subject-file';

const spec = {
  src: 'worlds/w/alrik.webp',
  pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
  edges: { inner: 0.6, outer: 0.7 },
};

describe('subject files (v1.1 §G.3 Files)', () => {
  it("in the world's tokens folder, named by actor and content", async () => {
    const written: [string, Uint8Array][] = [];
    const bytes = new Map([
      ['a.webp', new Uint8Array([1, 2, 3])],
      ['b.webp', new Uint8Array([4, 5, 6])],
    ]);
    const render = createSubjectFiles({
      draw: async (s) => bytes.get(s.src) as Uint8Array,
      write: async (path, b) => void written.push([path, b]),
      worldId: () => 'silk-dev',
    });
    const a = await render('Actor.abc123', { ...spec, src: 'a.webp' });
    const again = await render('Actor.abc123', { ...spec, src: 'a.webp' });
    const b = await render('Actor.abc123', { ...spec, src: 'b.webp' });
    // sha256 of [1, 2, 3], first 16 hex digits.
    expect(a).toBe('silk/silk-dev/tokens/abc123-039058c6f2c0cb49.webp');
    expect(again).toBe(a);
    expect(b).not.toBe(a);
    expect(written.map(([path]) => path)).toEqual([a, a, b]);
  });
});
