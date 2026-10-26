import { describe, expect, it } from 'vitest';
import type { PlayerViewNode } from '../core/player-view';
import { openPlayerDoc, resolvePlayerNode, type PlayerDoc } from './player-docs';

const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2 } as const;
type Level = keyof typeof LEVELS;

function doc(
  documentName: string,
  level: Level,
  extra: Partial<PlayerDoc> & { pages?: Map<string, PlayerDoc> } = {},
): PlayerDoc & { rendered: number } {
  const d = {
    documentName,
    name: `${documentName} name`,
    rendered: 0,
    flags: {},
    testUserPermission: (_user: unknown, need: Level) => LEVELS[level] >= LEVELS[need],
    sheet: {
      render: async () => {
        d.rendered++;
      },
    },
    ...extra,
  };
  return d;
}

const node = (cls: PlayerViewNode['class'], uuid: string): PlayerViewNode => ({
  id: 'n',
  class: cls,
  uuid,
  x: 0,
  y: 0,
});

describe('resolvePlayerNode (spec §9 Node: name + Cover from docs the player sees)', () => {
  it('a journal element: its name and the Cover page image when that page is visible', () => {
    const cover = doc('JournalEntryPage', 'OBSERVER', { src: 'gareth.webp' });
    const entry = doc('JournalEntry', 'OBSERVER', {
      flags: { silk: { cover: 'cov' } },
      pages: new Map([['cov', cover]]),
    });
    const docs = new Map([['JournalEntry.g', entry]]);
    expect(resolvePlayerNode(node('location', 'JournalEntry.g'), (u) => docs.get(u), {})).toEqual({
      name: 'JournalEntry name',
      img: 'gareth.webp',
    });
  });

  it('a hidden Cover page shows no image', () => {
    const cover = doc('JournalEntryPage', 'NONE', { src: 'secret.webp' });
    const entry = doc('JournalEntry', 'OBSERVER', {
      flags: { silk: { cover: 'cov' } },
      pages: new Map([['cov', cover]]),
    });
    expect(resolvePlayerNode(node('location', 'x'), () => entry, {})).toEqual({
      name: 'JournalEntry name',
    });
  });

  it('an actor: name and its (hooded) image', () => {
    const actor = doc('Actor', 'LIMITED', { img: 'hooded.svg' });
    expect(resolvePlayerNode(node('person', 'Actor.a'), () => actor, {})).toEqual({
      name: 'Actor name',
      img: 'hooded.svg',
    });
  });

  it('a doc the player cannot see yet (ownership still syncing) shows nothing of it', () => {
    const actor = doc('Actor', 'NONE', { img: 'real.webp' });
    expect(resolvePlayerNode(node('person', 'Actor.a'), () => actor, {})).toEqual({ name: '' });
    expect(resolvePlayerNode(node('person', 'Actor.a'), () => undefined, {})).toEqual({ name: '' });
  });
});

describe('openPlayerDoc (spec §9: click opens the Foundry doc)', () => {
  it('a journal element opens its entry', async () => {
    const entry = doc('JournalEntry', 'OBSERVER');
    await openPlayerDoc(node('location', 'g'), {
      get: () => entry,
      journal: () => undefined,
      user: {},
    });
    expect(entry.rendered).toBe(1);
  });

  it('an actor opens the LIMITED sheet plus the Companion Journal once the player may see it', async () => {
    const companion = doc('JournalEntry', 'OBSERVER');
    const actor = doc('Actor', 'LIMITED', { flags: { silk: { companion: 'comp' } } });
    await openPlayerDoc(node('person', 'a'), {
      get: () => actor,
      journal: (id) => (id === 'comp' ? companion : undefined),
      user: {},
    });
    expect([actor.rendered, companion.rendered]).toEqual([1, 1]);
  });

  it('a NONE Companion Journal stays closed', async () => {
    const companion = doc('JournalEntry', 'NONE');
    const actor = doc('Actor', 'LIMITED', { flags: { silk: { companion: 'comp' } } });
    await openPlayerDoc(node('person', 'a'), {
      get: () => actor,
      journal: () => companion,
      user: {},
    });
    expect([actor.rendered, companion.rendered]).toEqual([1, 0]);
  });
});
