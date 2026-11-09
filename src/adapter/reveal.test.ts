import { describe, expect, it } from 'vitest';
import { registerRevealHooks, tokenUpdates } from './reveal';

function setup(opts: { gm?: boolean; revealed?: boolean; available?: boolean } = {}) {
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const ran: [string, object][] = [];
  const repaired: string[] = [];
  let reloaded = 0;
  registerRevealHooks(
    {
      repair: async (id) => void repaired.push(id),
      reload: () => void reloaded++,
      isRevealed: () => opts.revealed ?? false,
      available: () => opts.available ?? true,
    },
    {
      on: (name, fn) => hooks.set(name, fn),
      isActiveGM: () => opts.gm ?? true,
      isGM: () => opts.gm ?? true,
      elementIdOf: (doc) => (doc as { flags?: { garn?: { id?: string } } }).flags?.garn?.id,
      run: async (name, args) => void ran.push([name, args]),
      localize: (key) => key,
    },
  );
  const fire = (name: string, ...args: unknown[]) => hooks.get(name)?.(...args);
  return { fire, ran, repaired, reloaded: () => reloaded };
}

type Control = { label: string; onClick(): void; visible?: boolean };

describe('sheet header buttons (spec §8 Controls)', () => {
  it('Garn docs get Reveal, Show to players and Element Detail controls that run commands', () => {
    const t = setup();
    const controls: Control[] = [];
    t.fire(
      'getHeaderControlsDocumentSheetV2',
      { document: { flags: { garn: { id: 'el1' } } } },
      controls,
    );
    expect(controls.map((c) => c.label)).toEqual([
      'GARN.Reveal.Reveal',
      'GARN.Commands.reveal.showToPlayers',
      'GARN.Commands.element.openDetail',
    ]);
    for (const c of controls) c.onClick();
    expect(t.ran).toEqual([
      ['reveal.element', { id: 'el1', revealed: true }],
      ['reveal.showToPlayers', { id: 'el1' }],
      ['element.openDetail', { id: 'el1' }],
    ]);
  });

  it('a Revealed element offers Un-reveal; under main only Element Detail; players and other docs get nothing', () => {
    const doc = { document: { flags: { garn: { id: 'el1' } } } };
    const revealed: Control[] = [];
    setup({ revealed: true }).fire('getHeaderControlsDocumentSheetV2', doc, revealed);
    expect(revealed[0]?.label).toBe('GARN.Reveal.Unreveal');
    const main: Control[] = [];
    setup({ available: false }).fire('getHeaderControlsDocumentSheetV2', doc, main);
    expect(main.map((c) => c.label)).toEqual(['GARN.Commands.element.openDetail']);
    const player: Control[] = [];
    setup({ gm: false }).fire('getHeaderControlsDocumentSheetV2', doc, player);
    const other: Control[] = [];
    setup().fire('getHeaderControlsDocumentSheetV2', { document: { flags: {} } }, other);
    expect([...player, ...other]).toEqual([]);
  });
});

describe('flow-back', () => {
  it('a Foundry-side image or token edit re-applies the element (hood), not Garn writes', () => {
    const t = setup();
    const actor = { flags: { garn: { id: 'el1' } } };
    t.fire('updateActor', actor, { img: 'x.webp' }, {});
    t.fire('updateActor', actor, { prototypeToken: { texture: { src: 'y' } } }, {});
    t.fire('updateActor', actor, { name: 'n' }, {});
    t.fire('updateActor', actor, { img: 'x.webp' }, { garn: { internal: true } });
    expect(t.repaired).toEqual(['el1', 'el1']);
  });

  it('revealState changes elsewhere reload the World state', () => {
    const t = setup();
    t.fire('updateSetting', { key: 'garn.revealState' });
    t.fire('updateSetting', { key: 'garn.viewState' });
    expect(t.reloaded()).toBe(1);
  });
});

describe('tokenUpdates', () => {
  /** A placed token as the adapter reads it: its source data. */
  const token = (id: string, actorId: string, source: Record<string, unknown>) => ({
    id,
    actorId,
    toObject: () => structuredClone(source),
  });

  it('lists the actor’s placed tokens whose data differs', () => {
    const tokens = [
      token('t1', 'a', { texture: { src: 'hood' }, displayName: 40 }),
      token('t2', 'a', { texture: { src: 'real' }, displayName: 40 }),
      token('t3', 'b', { texture: { src: 'real' }, displayName: 40 }),
    ];
    expect(tokenUpdates(tokens, 'a', { 'texture.src': 'hood', displayName: 40 })).toEqual([
      { _id: 't2', 'texture.src': 'hood', displayName: 40 },
    ]);
  });

  it('linked and unlinked tokens alike (v1.1 §G.3, #166)', () => {
    const tokens = [
      token('t1', 'a', { actorLink: true, texture: { src: 'old' } }),
      token('t2', 'a', { actorLink: false, texture: { src: 'old' } }),
    ];
    expect(tokenUpdates(tokens, 'a', { 'texture.src': 'new' })).toEqual([
      { _id: 't1', 'texture.src': 'new' },
      { _id: 't2', 'texture.src': 'new' },
    ]);
  });

  it('compares source data: a ring colour as its CSS string, unset as null', () => {
    const tokens = [token('t1', 'a', { ring: { colors: { ring: '#ff0000', background: null } } })];
    const data = { 'ring.colors.ring': '#ff0000', 'ring.colors.background': null };
    expect(tokenUpdates(tokens, 'a', data)).toEqual([]);
    expect(tokenUpdates(tokens, 'a', { 'ring.colors.ring': '#00ff00' })).toHaveLength(1);
    expect(tokenUpdates(tokens, 'a', { 'ring.subject.texture': null })).toEqual([]);
  });

  it("each token's own snapshot (v1.1 §G.3.1): stored by the hood", () => {
    const tokens = [token('t1', 'a', { texture: { src: 'wild-2.webp', fit: 'cover' } })];
    expect(tokenUpdates(tokens, 'a', { 'texture.src': 'hood' }, 'store')).toEqual([
      {
        _id: 't1',
        'texture.src': 'hood',
        'flags.garn.unhooded': {
          ring: { enabled: false, colors: { ring: null, background: null } },
          texture: { src: 'wild-2.webp', fit: 'cover', anchorX: 0.5, anchorY: 0.5 },
          subject: { scale: 1, texture: null },
        },
      },
    ]);
  });
});
