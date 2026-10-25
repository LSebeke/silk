import { describe, expect, it } from 'vitest';
import de from '../../../public/lang/de.json';
import en from '../../../public/lang/en.json';
import type { CanonRecord } from '../canon';
import { elementRecord, type ElementClassId } from '../elements';
import { connectionRecord, type ConnectionData } from './connection';
import { connectionSentences } from './sentences';

/** Foundry's `i18n.format` over a lang file. */
const formatter =
  (lang: object) =>
  (key: string, data: Record<string, string> = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], lang);
    if (typeof value !== 'string') throw new Error(`missing ${key}`);
    return value.replace(/{(\w+)}/g, (_, k: string) => data[k] ?? `{${k}}`);
  };

function world(connections: ConnectionData[], classes: Record<string, ElementClassId> = {}) {
  const records = new Map<string, CanonRecord>();
  for (const name of ['Alrik', 'Bosper', 'Sword', 'Gareth', 'Feast', 'Inn', 'Hall']) {
    const cls = classes[name] ?? 'person';
    records.set(name, elementRecord(name, { class: cls, name, position: { x: 0, y: 0 } }));
  }
  connections.forEach((c, i) => records.set(`c${i}`, connectionRecord(`c${i}`, c)));
  return records;
}
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};
const free = (from: string, to: string, label: string, mutual = false): ConnectionData => ({
  from,
  to,
  type: 'free',
  direction: mutual ? 'mutual' : 'directed',
  label,
});

describe('connectionSentences', () => {
  it('directed free-form reads "A <verb phrase> B" on both endpoints', () => {
    const records = world([free('Alrik', 'Bosper', 'loves')]);
    const localize = formatter(en);
    expect(connectionSentences(records, 'Alrik', localize)).toEqual(['Alrik loves Bosper']);
    expect(connectionSentences(records, 'Bosper', localize)).toEqual(['Alrik loves Bosper']);
  });

  it('mutual free-form reads "A and B <plural predicate>", localised conjunction', () => {
    const records = world([free('Alrik', 'Bosper', 'are friends', true)]);
    expect(connectionSentences(records, 'Bosper', formatter(en))).toEqual([
      'Alrik and Bosper are friends',
    ]);
    const deRecords = world([free('Alrik', 'Bosper', 'sind Freunde', true)]);
    expect(connectionSentences(deRecords, 'Alrik', formatter(de))).toEqual([
      'Alrik und Bosper sind Freunde',
    ]);
  });

  it('an unlabelled free-form Connection still reads as a sentence', () => {
    const records = world([free('Alrik', 'Bosper', ''), free('Alrik', 'Gareth', '', true)]);
    expect(connectionSentences(records, 'Alrik', formatter(en))).toEqual([
      'Alrik and Gareth are connected',
      'Alrik is connected to Bosper',
    ]);
  });

  const behavioural: ConnectionData[] = [
    { from: 'Alrik', to: 'Sword', type: 'owns', direction: 'directed', label: '' },
    { from: 'Alrik', to: 'Feast', type: 'presentAt', direction: 'directed', label: '' },
    { from: 'Inn', to: 'Gareth', type: 'locatedIn', direction: 'directed', label: '' },
    { from: 'Feast', to: 'Inn', type: 'takesPlaceAt', direction: 'directed', label: '' },
  ];
  const classes: Record<string, ElementClassId> = {
    Sword: 'item',
    Gareth: 'location',
    Inn: 'location',
    Feast: 'event',
  };

  it('behavioural types use fixed English phrases', () => {
    const records = world(behavioural, classes);
    const localize = formatter(en);
    expect(connectionSentences(records, 'Alrik', localize)).toEqual([
      'Alrik is present at Feast',
      'Alrik owns Sword',
    ]);
    expect(connectionSentences(records, 'Inn', localize)).toEqual([
      'Feast takes place at Inn',
      'Inn is located in Gareth',
    ]);
  });

  it('behavioural types use fixed German phrases', () => {
    const records = world(behavioural, classes);
    const localize = formatter(de);
    expect(connectionSentences(records, 'Alrik', localize)).toEqual([
      'Alrik besitzt Sword',
      'Alrik ist anwesend bei Feast',
    ]);
    expect(connectionSentences(records, 'Inn', localize)).toEqual([
      'Feast findet in Inn statt',
      'Inn befindet sich in Gareth',
    ]);
  });

  it('a behavioural label is ignored', () => {
    const records = world([{ ...must(behavioural[0]), label: 'hoards' }], classes);
    expect(connectionSentences(records, 'Sword', formatter(en))).toEqual(['Alrik owns Sword']);
  });

  it('lists only Connections passing `include` (Revealed, for players)', () => {
    const records = world([free('Alrik', 'Bosper', 'loves'), free('Alrik', 'Gareth', 'fears')]);
    const include = (c: { id: string }) => c.id === 'c1';
    expect(connectionSentences(records, 'Alrik', formatter(en), include)).toEqual([
      'Alrik fears Gareth',
    ]);
  });

  it('touches only the element’s own Connections', () => {
    const records = world([free('Bosper', 'Gareth', 'fears')]);
    expect(connectionSentences(records, 'Alrik', formatter(en))).toEqual([]);
  });
});
