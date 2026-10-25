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
      elementIdOf: (doc) => (doc as { flags?: { silk?: { id?: string } } }).flags?.silk?.id,
      run: async (name, args) => void ran.push([name, args]),
      localize: (key) => key,
    },
  );
  const fire = (name: string, ...args: unknown[]) => hooks.get(name)?.(...args);
  return { fire, ran, repaired, reloaded: () => reloaded };
}

type Control = { label: string; onClick(): void; visible?: boolean };

describe('sheet header buttons (spec §8 Controls)', () => {
  it('Silk docs get Reveal, Show to players and Element Detail controls that run commands', () => {
    const t = setup();
    const controls: Control[] = [];
    t.fire(
      'getHeaderControlsDocumentSheetV2',
      { document: { flags: { silk: { id: 'el1' } } } },
      controls,
    );
    expect(controls.map((c) => c.label)).toEqual([
      'SILK.Reveal.Reveal',
      'SILK.Commands.reveal.showToPlayers',
      'SILK.Commands.element.openDetail',
    ]);
    for (const c of controls) c.onClick();
    expect(t.ran).toEqual([
      ['reveal.element', { id: 'el1', revealed: true }],
      ['reveal.showToPlayers', { id: 'el1' }],
      ['element.openDetail', { id: 'el1' }],
    ]);
  });

  it('a Revealed element offers Un-reveal; under main only Element Detail; players and other docs get nothing', () => {
    const doc = { document: { flags: { silk: { id: 'el1' } } } };
    const revealed: Control[] = [];
    setup({ revealed: true }).fire('getHeaderControlsDocumentSheetV2', doc, revealed);
    expect(revealed[0]?.label).toBe('SILK.Reveal.Unreveal');
    const main: Control[] = [];
    setup({ available: false }).fire('getHeaderControlsDocumentSheetV2', doc, main);
    expect(main.map((c) => c.label)).toEqual(['SILK.Commands.element.openDetail']);
    const player: Control[] = [];
    setup({ gm: false }).fire('getHeaderControlsDocumentSheetV2', doc, player);
    const other: Control[] = [];
    setup().fire('getHeaderControlsDocumentSheetV2', { document: { flags: {} } }, other);
    expect([...player, ...other]).toEqual([]);
  });
});

describe('flow-back', () => {
  it('a Foundry-side image or token edit re-applies the element (hood), not Silk writes', () => {
    const t = setup();
    const actor = { flags: { silk: { id: 'el1' } } };
    t.fire('updateActor', actor, { img: 'x.webp' }, {});
    t.fire('updateActor', actor, { prototypeToken: { texture: { src: 'y' } } }, {});
    t.fire('updateActor', actor, { name: 'n' }, {});
    t.fire('updateActor', actor, { img: 'x.webp' }, { silk: { internal: true } });
    expect(t.repaired).toEqual(['el1', 'el1']);
  });

  it('revealState changes elsewhere reload the World state', () => {
    const t = setup();
    t.fire('updateSetting', { key: 'silk.revealState' });
    t.fire('updateSetting', { key: 'silk.viewState' });
    expect(t.reloaded()).toBe(1);
  });
});

describe('tokenUpdates', () => {
  it('lists the actor’s placed tokens whose data differs', () => {
    const tokens = [
      { id: 't1', actorId: 'a', texture: { src: 'hood' }, displayName: 40 },
      { id: 't2', actorId: 'a', texture: { src: 'real' }, displayName: 40 },
      { id: 't3', actorId: 'b', texture: { src: 'real' }, displayName: 40 },
    ];
    expect(tokenUpdates(tokens, 'a', { 'texture.src': 'hood', displayName: 40 })).toEqual([
      { _id: 't2', 'texture.src': 'hood', displayName: 40 },
    ]);
  });
});
