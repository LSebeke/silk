import { describe, expect, it } from 'vitest';
import type { ElementClassId } from '../../core/elements';
import { edgeMenu, nodeMenu, type MenuDeps } from './menu';

const deps = (over: Partial<MenuDeps> = {}): MenuDeps => ({
  available: () => true,
  title: (name) => `T(${name})`,
  isRevealed: () => false,
  selection: [],
  ...over,
});

const labels = (entries: { label: string; disabled?: boolean }[]) =>
  entries.map((e) => (e.disabled ? `${e.label} (off)` : e.label));

describe('Node context menu (spec §8 Controls, §10.3)', () => {
  it('a Materialized Person: Reveal, Reveal Appearance, Show to players, then the other actions', () => {
    const entries = nodeMenu(
      {
        id: 'a',
        class: 'person',
        name: 'A',
        uuid: 'Actor.x',
        infoBlocks: [{ _id: 'b', name: 'Looks', text: '', appearance: true }],
      },
      deps(),
    );
    expect(labels(entries)).toEqual([
      'GARN.Reveal.Reveal',
      'GARN.Reveal.RevealAppearance',
      'T(reveal.showToPlayers)',
      'T(element.toggleStatus)',
      'T(element.openDetail)',
      'GARN.Detail.AddInfoBlockMenu',
      'T(element.openSheet)',
      'T(element.openJournal)',
      'T(element.rename)',
      'T(materialize.unmaterialize)',
      'T(element.delete)',
    ]);
    expect(entries[0]).toMatchObject({
      command: 'reveal.element',
      args: { id: 'a', revealed: true },
    });
  });

  it('a Person whose Appearance block was deleted: no Appearance toggle (v1.1 §C.2)', () => {
    const entries = nodeMenu(
      {
        id: 'a',
        class: 'person',
        name: 'A',
        infoBlocks: [{ _id: 'b', name: 'Appearance', text: '' }],
      },
      deps(),
    );
    expect(labels(entries)).not.toContain('GARN.Reveal.RevealAppearance');
  });

  it('a Revealed Ghost Location: Un-reveal, Materialize, no Appearance or Status', () => {
    const entries = nodeMenu(
      { id: 'a', class: 'location', name: 'A' },
      deps({ isRevealed: (kind) => kind === 'element' }),
    );
    expect(labels(entries)).toContain('GARN.Reveal.Unreveal');
    expect(labels(entries)).toContain('T(materialize.elements)');
    expect(labels(entries)).not.toContain('GARN.Reveal.RevealAppearance');
    expect(labels(entries)).not.toContain('T(element.toggleStatus)');
    expect(entries[0]).toMatchObject({ args: { id: 'a', revealed: false } });
  });

  it('under main the Reveal entries are disabled with the "start an Adventure" hint', () => {
    const entries = nodeMenu(
      { id: 'a', class: 'note', name: 'A', uuid: 'J.x' },
      deps({ available: (name) => !name.startsWith('reveal.') }),
    );
    const reveal = entries.filter((e) => e.command?.startsWith('reveal.'));
    expect(reveal.length).toBe(2);
    for (const e of reveal)
      expect(e).toMatchObject({ disabled: true, hint: 'GARN.Reveal.NeedsAdventure' });
  });

  it('with several selected (incl. this one): Untangle, and Delete acts on the selection', () => {
    const entries = nodeMenu(
      { id: 'a', class: 'note', name: 'A' },
      deps({ selection: ['a', 'b'] }),
    );
    expect(labels(entries)).toContain('T(canvas.untangle)');
    expect(entries.find((e) => e.command === 'element.delete')?.args).toEqual({ ids: ['a', 'b'] });
  });
});

describe('Node context menu: Open sheet / Open journal (v1.1 §G.2)', () => {
  const opens = (cls: ElementClassId) =>
    nodeMenu({ id: 'a', class: cls, name: 'A' }, deps())
      .filter((e) => e.command === 'element.openSheet' || e.command === 'element.openJournal')
      .map((e) => e.command);

  it('actor and item classes: both', () => {
    for (const cls of ['person', 'creature', 'playerCharacter', 'item'] as const)
      expect(opens(cls)).toEqual(['element.openSheet', 'element.openJournal']);
  });

  it('journal classes: only Open journal', () => {
    for (const cls of ['location', 'faction', 'event', 'quest', 'note'] as const)
      expect(opens(cls)).toEqual(['element.openJournal']);
  });
});

describe('Node context menu: Add Info Block… (v1.1 §C.1)', () => {
  it('opens Element Detail with a new block, for every class', () => {
    for (const cls of ['note', 'item', 'playerCharacter'] as const) {
      const entry = nodeMenu({ id: 'a', class: cls, name: 'A' }, deps()).find(
        (e) => e.label === 'GARN.Detail.AddInfoBlockMenu',
      );
      expect(entry).toMatchObject({
        command: 'element.openDetail',
        args: { id: 'a', addInfoBlock: true },
      });
    }
  });

  it('is disabled when Element Detail is', () => {
    const entries = nodeMenu(
      { id: 'a', class: 'note', name: 'A' },
      deps({ available: (name) => name !== 'element.openDetail' }),
    );
    expect(entries.find((e) => e.label === 'GARN.Detail.AddInfoBlockMenu')?.disabled).toBe(true);
  });
});

describe('Connection edge context menu', () => {
  const free = { id: 'c1', type: 'free' } as const;

  it('Open details, Reveal, the Connection commands (spec 1.1 §F.1)', () => {
    const entries = edgeMenu(free, deps({ isRevealed: () => true }));
    expect(labels(entries)).toEqual([
      'GARN.Canvas.EdgeMenu.OpenDetails',
      'GARN.Reveal.Unreveal',
      'T(connection.setLabel)',
      'T(connection.toggleDirection)',
      'T(connection.cycleType)',
      'GARN.Canvas.EdgeMenu.Reverse',
      'T(connection.delete)',
    ]);
    expect(entries[0]).toMatchObject({ command: 'connection.openDetail', args: { id: 'c1' } });
    expect(entries[1]).toMatchObject({
      command: 'reveal.connection',
      args: { id: 'c1', revealed: false },
    });
    expect(entries[3]).toMatchObject({
      command: 'connection.toggleDirection',
      args: { id: 'c1' },
    });
    expect(entries[5]).toMatchObject({ command: 'connection.flip', args: { id: 'c1' } });
    expect(entries.at(-1)).toMatchObject({ command: 'connection.delete', args: { ids: ['c1'] } });
  });

  it('Directed ⇄ Mutual is off on a Behavioural Connection (always directed)', () => {
    const owns = edgeMenu({ id: 'c1', type: 'owns' }, deps());
    expect(owns[3]?.disabled).toBe(true);
    expect(owns[5]?.disabled).toBeUndefined();
  });

  it('Open details is disabled while Connection Detail is unavailable', () => {
    const entries = edgeMenu(free, deps({ available: (n) => n !== 'connection.openDetail' }));
    expect(entries[0]?.disabled).toBe(true);
    expect(entries.slice(1).some((e) => e.disabled)).toBe(false);
  });
});
