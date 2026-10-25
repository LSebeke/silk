import { describe, expect, it } from 'vitest';
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
    const entries = nodeMenu({ id: 'a', class: 'person', name: 'A', uuid: 'Actor.x' }, deps());
    expect(labels(entries)).toEqual([
      'SILK.Reveal.Reveal',
      'SILK.Reveal.RevealAppearance',
      'T(reveal.showToPlayers)',
      'T(element.toggleStatus)',
      'T(element.openDetail)',
      'T(element.openSheet)',
      'T(element.rename)',
      'T(materialize.unmaterialize)',
      'T(element.delete)',
    ]);
    expect(entries[0]).toMatchObject({
      command: 'reveal.element',
      args: { id: 'a', revealed: true },
    });
  });

  it('a Revealed Ghost Location: Un-reveal, Materialize, no Appearance or Status', () => {
    const entries = nodeMenu(
      { id: 'a', class: 'location', name: 'A' },
      deps({ isRevealed: (kind) => kind === 'element' }),
    );
    expect(labels(entries)).toContain('SILK.Reveal.Unreveal');
    expect(labels(entries)).toContain('T(materialize.elements)');
    expect(labels(entries)).not.toContain('SILK.Reveal.RevealAppearance');
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
      expect(e).toMatchObject({ disabled: true, hint: 'SILK.Reveal.NeedsAdventure' });
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

describe('Connection edge context menu', () => {
  it('Reveal plus the Connection commands', () => {
    const entries = edgeMenu('c1', deps({ isRevealed: () => true }));
    expect(labels(entries)).toEqual([
      'SILK.Reveal.Unreveal',
      'T(connection.setLabel)',
      'T(connection.cycleDirection)',
      'T(connection.cycleType)',
      'T(connection.flip)',
      'T(connection.delete)',
    ]);
    expect(entries[0]).toMatchObject({
      command: 'reveal.connection',
      args: { id: 'c1', revealed: false },
    });
    expect(entries.at(-1)).toMatchObject({ command: 'connection.delete', args: { ids: ['c1'] } });
  });
});
