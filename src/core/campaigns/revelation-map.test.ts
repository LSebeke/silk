import { describe, expect, it } from 'vitest';
import {
  emptyRevelationMap,
  isRevealed,
  mergeRevelationMaps,
  parseRevelationMap,
  pruneRevelationMap,
  setRevealed,
  unionRevelationMaps,
} from './revelation-map';

describe('Revelation Map', () => {
  it('starts empty', () => {
    const map = emptyRevelationMap();
    expect(isRevealed(map, 'element', 'el-a')).toBe(false);
    expect(map).toEqual({
      elements: [],
      appearance: [],
      infoBlocks: [],
      connections: [],
      playerNotes: [],
    });
  });

  it('records and un-records each kind by id, without mutating', () => {
    const empty = emptyRevelationMap();
    let map = setRevealed(empty, 'element', 'el-b', true);
    map = setRevealed(map, 'element', 'el-a', true);
    map = setRevealed(map, 'element', 'el-a', true);
    map = setRevealed(map, 'appearance', 'el-a', true);
    map = setRevealed(map, 'infoBlock', 'ib-1', true);
    map = setRevealed(map, 'connection', 'co-1', true);
    map = setRevealed(map, 'playerNote', 'pn-1', true);

    expect(map).toEqual({
      elements: ['el-a', 'el-b'],
      appearance: ['el-a'],
      infoBlocks: ['ib-1'],
      connections: ['co-1'],
      playerNotes: ['pn-1'],
    });
    expect(isRevealed(empty, 'element', 'el-a')).toBe(false);

    map = setRevealed(map, 'element', 'el-b', false);
    expect(isRevealed(map, 'element', 'el-b')).toBe(false);
    expect(isRevealed(map, 'element', 'el-a')).toBe(true);
  });

  it('parses stored JSON, tolerating missing or junk fields', () => {
    expect(parseRevelationMap(null)).toEqual(emptyRevelationMap());
    expect(
      parseRevelationMap({ formatVersion: 1, elements: ['b', 'a', 'a', 3], connections: 'x' }),
    ).toEqual({ ...emptyRevelationMap(), elements: ['a', 'b'] });
  });

  it('union keeps everything Revealed in either map (Join Campaigns default)', () => {
    const a = setRevealed(emptyRevelationMap(), 'element', 'el-a', true);
    const b = setRevealed(
      setRevealed(emptyRevelationMap(), 'element', 'el-b', true),
      'connection',
      'co-1',
      true,
    );
    expect(unionRevelationMaps(a, b)).toEqual({
      ...emptyRevelationMap(),
      elements: ['el-a', 'el-b'],
      connections: ['co-1'],
    });
  });

  it('prune drops ids that no longer exist', () => {
    let map = setRevealed(emptyRevelationMap(), 'element', 'el-a', true);
    map = setRevealed(map, 'element', 'el-gone', true);
    map = setRevealed(map, 'appearance', 'el-gone', true);
    expect(pruneRevelationMap(map, (id) => id !== 'el-gone')).toEqual({
      ...emptyRevelationMap(),
      elements: ['el-a'],
    });
  });

  it('three-way merge: items theirs changed since base win, ours decides the rest', () => {
    const m = (elements: string[]) => ({ ...emptyRevelationMap(), elements });
    // theirs added c and dropped d; ours dropped a and added b.
    expect(mergeRevelationMaps(m(['a', 'd']), m(['a', 'c']), m(['b', 'd'])).elements).toEqual([
      'b',
      'c',
    ]);
  });
});
