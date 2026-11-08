import { describe, expect, it } from 'vitest';
import type { PortraitDoc } from './portrait';
import { writeLook, type LookStage, type SubjectSpec } from './subject';

const pose = { anchorX: 0.3, anchorY: 0.5, scale: 2 };
const edges = { inner: 0.666, outer: 0.72 };

function stage(ringEdges = edges) {
  const rendered: { uuid: string; spec: SubjectSpec }[] = [];
  const tokens: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const sizes: number[] = [];
  const s: LookStage = {
    updateTokens: async (_uuid, data) => void tokens.push(data),
    ringEdges: async (size) => (sizes.push(size), ringEdges),
    renderSubject: async (uuid, spec) => (
      rendered.push({ uuid, spec }),
      `silk/w/tokens/a-${rendered.length}.webp`
    ),
  };
  const update = async (_uuid: string, data: Record<string, unknown>) => void updates.push(data);
  return { s, update, rendered, tokens, updates, sizes };
}

const doc = (over: Partial<PortraitDoc['flags']['silk']> = {}, texture?: string): PortraitDoc => ({
  img: 'a.webp',
  prototypeToken: {
    width: 2,
    height: 2,
    texture: { src: 'a.webp' },
    ring: { enabled: true, subject: { texture: texture ?? null } },
  },
  flags: { silk: over },
});

describe('Subject file (v1.1 §G.3, #171)', () => {
  it('ring on: rendered for the actor size, written to the prototype and every placed token', async () => {
    const t = stage();
    await writeLook(t.s, t.update, 'Actor.a', doc(), {
      doc: { img: 'a.webp' },
      tokens: { 'texture.src': 'a.webp' },
      subject: { src: 'a.webp', pose, order: 'ring' },
    });
    expect(t.sizes).toEqual([2]);
    expect(t.rendered).toEqual([
      { uuid: 'Actor.a', spec: { src: 'a.webp', pose, order: 'ring', edges } },
    ]);
    expect(t.updates).toEqual([
      {
        img: 'a.webp',
        'flags.silk.subject': {
          file: 'silk/w/tokens/a-1.webp',
          src: 'a.webp',
          pose,
          order: 'ring',
          edges,
        },
        'prototypeToken.ring.subject.texture': 'silk/w/tokens/a-1.webp',
      },
    ]);
    // `texture.src` keeps the uncropped image.
    expect(t.tokens).toEqual([
      { 'texture.src': 'a.webp', 'ring.subject.texture': 'silk/w/tokens/a-1.webp' },
    ]);
  });

  const built = () =>
    doc(
      { subject: { file: 'silk/w/tokens/a-0.webp', src: 'a.webp', pose, edges } },
      'silk/w/tokens/a-0.webp',
    );

  it('the same image, pose and ring style: the file is kept, not rendered again', async () => {
    const t = stage();
    await writeLook(t.s, t.update, 'Actor.a', built(), {
      doc: {},
      tokens: {},
      subject: { src: 'a.webp', pose: { ...pose }, order: 'ring' },
    });
    expect(t.rendered).toEqual([]);
    expect(t.updates).toEqual([]);
    expect(t.tokens).toEqual([{ 'ring.subject.texture': 'silk/w/tokens/a-0.webp' }]);
  });

  it('the draw order changed: rebuilt, and the flag records it (#170)', async () => {
    const t = stage();
    await writeLook(t.s, t.update, 'Actor.a', built(), {
      doc: {},
      subject: { src: 'a.webp', pose, order: 'illustration' },
    });
    expect(t.rendered.map((r) => r.spec.order)).toEqual(['illustration']);
    expect(t.updates[0]).toMatchObject({ 'flags.silk.subject': { order: 'illustration' } });
  });

  it('the world ring style changed its edges: rebuilt', async () => {
    const t = stage({ inner: 0.59, outer: 0.7225 });
    await writeLook(t.s, t.update, 'Actor.a', built(), {
      doc: {},
      tokens: {},
      subject: { src: 'a.webp', pose, order: 'ring' },
    });
    expect(t.rendered).toHaveLength(1);
    expect(t.tokens[0]).toEqual({ 'ring.subject.texture': 'silk/w/tokens/a-1.webp' });
  });

  it('a subject changed by hand: rebuilt', async () => {
    const t = stage();
    const d = { ...built() };
    d.prototypeToken = {
      ...d.prototypeToken,
      ring: { enabled: true, subject: { texture: 'mine.webp' } },
    };
    await writeLook(t.s, t.update, 'Actor.a', d, {
      doc: {},
      subject: { src: 'a.webp', pose, order: 'ring' },
    });
    expect(t.rendered).toHaveLength(1);
  });

  it("ring off: Silk's file is cleared everywhere", async () => {
    const t = stage();
    await writeLook(t.s, t.update, 'Actor.a', built(), { doc: {}, tokens: {}, subject: null });
    expect(t.updates).toEqual([
      { 'flags.silk.-=subject': null, 'prototypeToken.ring.subject.texture': null },
    ]);
    expect(t.tokens).toEqual([{ 'ring.subject.texture': null }]);
  });

  it('no subject in the writes: the subject is left alone', async () => {
    const t = stage();
    await writeLook(t.s, t.update, 'Actor.a', built(), {
      doc: { img: 'b.webp' },
      tokens: { 'texture.src': 'b.webp' },
    });
    expect(t.updates).toEqual([{ img: 'b.webp' }]);
    expect(t.tokens).toEqual([{ 'texture.src': 'b.webp' }]);
  });
});
