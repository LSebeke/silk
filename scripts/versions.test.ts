import { describe, expect, it } from 'vitest';
import { checkVersions } from './versions.mjs';

const url = 'https://github.com/LSebeke/garn';
const mod = (version: string, download = `${url}/releases/download/v${version}/garn.zip`) => ({
  id: 'garn',
  version,
  url,
  manifest: `${url}/releases/latest/download/module.json`,
  download,
});

describe('version gate', () => {
  it('passes when package, module and download URL agree', () => {
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'))).toEqual([]);
  });

  it('passes with the matching release tag', () => {
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'), 'v1.2.3')).toEqual([]);
  });

  it('fails when package.json and module.json differ', () => {
    expect(checkVersions({ version: '1.2.2' }, mod('1.2.3'))).toHaveLength(1);
  });

  it('fails when the download URL points at another release', () => {
    const problems = checkVersions(
      { version: '1.2.3' },
      mod('1.2.3', `${url}/releases/latest/download/garn.zip`),
    );
    expect(problems.join()).toContain('download');
  });

  it('fails when the zip is not named after the module id', () => {
    const renamed = { ...mod('1.2.3'), id: 'other' };
    expect(checkVersions({ version: '1.2.3' }, renamed).join()).toContain('other.zip');
  });

  it('fails on a tag that is not the module version', () => {
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'), 'v1.2.4').join()).toContain('tag');
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'), '1.2.3').join()).toContain('tag');
  });

  it('fails on a version Foundry cannot compare reliably', () => {
    expect(checkVersions({ version: 'next' }, mod('next')).join()).toContain('X.Y.Z');
  });

  it('fails when the manifest URL is not the latest release', () => {
    const wrong = { ...mod('1.2.3'), manifest: `${url}/releases/download/v1.2.3/module.json` };
    expect(checkVersions({ version: '1.2.3' }, wrong).join()).toContain('manifest');
  });

  it('fails when the lockfile was not bumped with package.json', () => {
    const lock = (v: string) => ({ version: v, packages: { '': { version: v } } });
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'), undefined, lock('1.2.3'))).toEqual([]);
    expect(
      checkVersions({ version: '1.2.3' }, mod('1.2.3'), undefined, lock('1.2.2')).join(),
    ).toContain('package-lock.json');
  });
});
