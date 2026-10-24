import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareDataPath, testWorldId } from './harness';

describe('testWorldId', () => {
  it('names the world silk-test-<run>', () => {
    expect(testWorldId('1a2b')).toBe('silk-test-1a2b');
  });

  it('refuses runs that would not yield a plain silk-test-* id', () => {
    expect(() => testWorldId('')).toThrow();
    expect(() => testWorldId('../silk-dev')).toThrow();
    expect(() => testWorldId('Dev World')).toThrow();
  });
});

describe('prepareDataPath', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'silk-harness-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('builds a throwaway data dir that links dsa5 and the built module', () => {
    const source = tmp();
    mkdirSync(join(source, 'Config'));
    writeFileSync(join(source, 'Config/license.json'), '{"license":"x"}');
    mkdirSync(join(source, 'Data/systems/dsa5'), { recursive: true });
    mkdirSync(join(source, 'Data/worlds/silk-dev'), { recursive: true });
    const dist = tmp();

    const dataPath = prepareDataPath({ source, dist, parent: tmp() });

    expect(existsSync(join(dataPath, 'Config/license.json'))).toBe(true);
    expect(readlinkSync(join(dataPath, 'Data/systems/dsa5'))).toBe(
      join(source, 'Data/systems/dsa5'),
    );
    expect(readlinkSync(join(dataPath, 'Data/modules/silk'))).toBe(dist);
    expect(existsSync(join(dataPath, 'Data/worlds/silk-dev'))).toBe(false);
  });
});
