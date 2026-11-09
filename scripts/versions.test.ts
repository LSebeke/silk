import { describe, expect, it } from 'vitest';
import { checkVersions } from './versions.mjs';

const url = 'https://github.com/LSebeke/silk';
const mod = (version: string, download = `${url}/releases/download/v${version}/silk.zip`) => ({
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
      mod('1.2.3', `${url}/releases/latest/download/silk.zip`),
    );
    expect(problems.join()).toContain('download');
  });

  it('fails on a tag that is not the module version', () => {
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'), 'v1.2.4').join()).toContain('tag');
    expect(checkVersions({ version: '1.2.3' }, mod('1.2.3'), '1.2.3').join()).toContain('tag');
  });

  it('fails on a version Foundry cannot compare reliably', () => {
    expect(checkVersions({ version: 'next' }, mod('next')).join()).toContain('X.Y.Z');
  });
});
