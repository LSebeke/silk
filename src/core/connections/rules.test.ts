import { describe, expect, it } from 'vitest';
import type { ElementClassId } from '../elements';
import { defaultConnection } from './rules';

describe('defaultConnection (spec 1.1 §F.3)', () => {
  it.each<[ElementClassId, ElementClassId, ReturnType<typeof defaultConnection>]>([
    ['person', 'item', { type: 'owns', reverse: false }],
    ['playerCharacter', 'item', { type: 'owns', reverse: false }],
    // Only the reverse is valid: the endpoints swap (drag Item → Person = Person owns Item).
    ['item', 'person', { type: 'owns', reverse: true }],
    ['event', 'creature', { type: 'presentAt', reverse: true }],
    ['item', 'location', { type: 'locatedIn', reverse: false }],
    ['location', 'item', { type: 'locatedIn', reverse: true }],
    ['location', 'event', { type: 'takesPlaceAt', reverse: true }],
    // Valid both ways: as asked.
    ['location', 'location', { type: 'locatedIn', reverse: false }],
    ['person', 'person', undefined],
    ['playerCharacter', 'event', undefined],
    ['faction', 'quest', undefined],
  ])('%s → %s', (from, to, expected) => {
    expect(defaultConnection(from, to)).toEqual(expected);
  });
});
