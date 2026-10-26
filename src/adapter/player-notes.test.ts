import { describe, expect, it } from 'vitest';
import { createSocketRelay, registerPlayerNoteHooks, textToHtml } from './player-notes';

/** A shared socket: emits reach every other client's listeners (Foundry doesn't echo). */
function network() {
  const listeners: { client: string; fn: (data: unknown) => void }[] = [];
  return (client: string) => ({
    on: (_channel: string, fn: (data: unknown) => void) => void listeners.push({ client, fn }),
    emit: (_channel: string, data: unknown) => {
      for (const l of listeners) if (l.client !== client) queueMicrotask(() => l.fn(data));
    },
  });
}

describe('socket relay (spec §9: socket → activeGM)', () => {
  it('a player request runs on the active GM and the result comes back', async () => {
    const net = network();
    const ran: [string, object][] = [];
    const gm = createSocketRelay({
      socket: net('gm'),
      userId: () => 'gm',
      isActiveGM: () => true,
      run: async (name, args) => {
        ran.push([name, args]);
        return { id: 'n1' };
      },
    });
    const player = createSocketRelay({
      socket: net('p'),
      userId: () => 'p',
      isActiveGM: () => false,
      run: async () => {
        throw new Error('players never run');
      },
    });
    gm.listen();
    player.listen();
    await expect(player.relay('playerNote.create', { elementId: 'e', text: 't' })).resolves.toEqual(
      { id: 'n1' },
    );
    expect(ran).toEqual([['playerNote.create', { elementId: 'e', text: 't' }]]);
  });

  it('errors come back; only party Player Note commands are relayed', async () => {
    const net = network();
    const ran: string[] = [];
    createSocketRelay({
      socket: net('gm'),
      userId: () => 'gm',
      isActiveGM: () => true,
      run: async (name) => {
        ran.push(name);
        throw new Error('Silk: no Player Note "x"');
      },
    }).listen();
    const player = createSocketRelay({
      socket: net('p'),
      userId: () => 'p',
      isActiveGM: () => false,
      run: async () => undefined,
    });
    player.listen();
    await expect(player.relay('playerNote.edit', { id: 'x', text: '' })).rejects.toThrow(
      /no Player Note/,
    );
    await expect(player.relay('playerNote.convert', { id: 'x' })).rejects.toThrow(/not relayed/);
    await expect(player.relay('element.delete', { id: 'x' })).rejects.toThrow(/not relayed/);
    expect(ran).toEqual(['playerNote.edit']);
  });
});

describe('Add Player Note header control', () => {
  function rig(opts: { revealed?: boolean; available?: boolean } = {}) {
    const hooks = new Map<string, (...args: unknown[]) => void>();
    const ran: [string, object][] = [];
    registerPlayerNoteHooks({
      on: (name, fn) => hooks.set(name, fn),
      elementIdOf: (doc) =>
        (doc as { flags?: { silk?: { id?: string; companionOf?: string } } }).flags?.silk?.id ??
        (doc as { flags?: { silk?: { companionOf?: string } } }).flags?.silk?.companionOf,
      isRevealed: () => opts.revealed ?? true,
      available: () => opts.available ?? true,
      prompt: async () => '<p>note</p>',
      run: async (name, args) => void ran.push([name, args]),
      localize: (key) => key,
    });
    const controls = (doc: object) => {
      const list: { label: string; onClick(): void }[] = [];
      hooks.get('getHeaderControlsDocumentSheetV2')?.({ document: doc }, list);
      return list;
    };
    return { controls, ran };
  }

  it('on a Revealed element (or its Companion Journal) it prompts and runs playerNote.create', async () => {
    const t = rig();
    const [control] = t.controls({ flags: { silk: { companionOf: 'el1' } } });
    expect(control?.label).toBe('SILK.PlayerNote.Add');
    control?.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.ran).toEqual([['playerNote.create', { elementId: 'el1', text: '<p>note</p>' }]]);
  });

  it('not on unrevealed elements, non-Silk docs, or with no GM online', () => {
    expect(rig({ revealed: false }).controls({ flags: { silk: { id: 'el1' } } })).toEqual([]);
    expect(rig().controls({ flags: {} })).toEqual([]);
    expect(rig({ available: false }).controls({ flags: { silk: { id: 'el1' } } })).toEqual([]);
  });
});

it('textToHtml: one escaped paragraph per line', () => {
  expect(textToHtml(' a<b>\nc & d \n')).toBe('<p>a&lt;b&gt;</p><p>c &amp; d</p>');
});
