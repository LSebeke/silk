import { describe, expect, it } from 'vitest';
import { bulkClass, inferClass } from './infer';

describe('class inference (spec §6 Adopt)', () => {
  it.each([
    ['character', 'playerCharacter'],
    ['npc', 'person'],
    ['creature', 'creature'],
  ])('Actor %s → %s', (type, cls) => {
    expect(inferClass({ documentName: 'Actor', type })).toEqual({ class: cls });
  });

  it.each(['group', 'vehicle'])('refuses Actor %s', (type) => {
    expect(inferClass({ documentName: 'Actor', type })).toEqual({ refused: true });
  });

  it('any Item subtype → Item', () => {
    expect(inferClass({ documentName: 'Item', type: 'meleeweapon' })).toEqual({ class: 'item' });
  });

  it('a journal with a dsaquestlog page → Quest', () => {
    const pages = [{ type: 'text' }, { type: 'dsaquestlog' }];
    expect(inferClass({ documentName: 'JournalEntry', pages })).toEqual({ class: 'quest' });
  });

  it('another journal → class box with Note pre-selected; bulk makes it a Note', () => {
    const inference = inferClass({ documentName: 'JournalEntry', pages: [{ type: 'text' }] });
    expect(inference).toEqual({ choices: ['note', 'location', 'faction', 'event', 'quest'] });
    expect(bulkClass(inference)).toBe('note');
  });

  it('a Scene → the GM picks Event or Location', () => {
    expect(inferClass({ documentName: 'Scene' })).toEqual({ choices: ['event', 'location'] });
  });

  it('refuses other documents', () => {
    expect(inferClass({ documentName: 'Macro' })).toEqual({ refused: true });
    expect(bulkClass({ refused: true })).toBeUndefined();
  });
});
