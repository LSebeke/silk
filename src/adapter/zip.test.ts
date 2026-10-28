import { describe, expect, it } from 'vitest';
import { unzipArchive, zipArchive } from './zip';

describe('zip', () => {
  it('round-trips archive entries', () => {
    const entries = new Map([
      ['silk-export.json', new TextEncoder().encode('{"kind":"backup"}')],
      ['assets/worlds/w/map one.png', new Uint8Array([0, 1, 2, 255])],
    ]);

    const back = unzipArchive(zipArchive(entries));

    expect([...back.keys()].sort()).toEqual(['assets/worlds/w/map one.png', 'silk-export.json']);
    expect([...(back.get('assets/worlds/w/map one.png') ?? [])]).toEqual([0, 1, 2, 255]);
  });

  it('rejects a file that is not a zip', () => {
    expect(() => unzipArchive(new TextEncoder().encode('not a zip'))).toThrow(/zip/);
  });
});
