import { describe, expect, it } from 'vitest';
import { showFileBrowseNotice, type FileBrowseNoticeDeps } from './file-browse-notice';

function run(over: Partial<FileBrowseNoticeDeps>) {
  const warnings: string[] = [];
  let marked = 0;
  const shown = showFileBrowseNotice({
    isGM: true,
    permissions: {},
    alreadyShown: false,
    localize: (key, data) => `${key}${data ? JSON.stringify(data) : ''}`,
    warn: (m) => warnings.push(m),
    markShown: () => {
      marked++;
    },
    ...over,
  });
  return { shown, warnings, marked };
}

describe('file-browse notice (spec §12)', () => {
  it('warns the GM when Foundry defaults give Trusted Players FILES_BROWSE', () => {
    const r = run({ permissions: {} });
    expect(r.shown).toBe(true);
    expect(r.warnings).toEqual(['SILK.Notice.FileBrowse{"roles":"USER.RoleTrusted"}']);
    expect(r.marked).toBe(1);
  });

  it('names every non-GM role that can browse', () => {
    const r = run({ permissions: { FILES_BROWSE: [1, 2, 3, 4] } });
    expect(r.warnings).toEqual([
      'SILK.Notice.FileBrowse{"roles":"USER.RolePlayer, USER.RoleTrusted"}',
    ]);
  });

  it('stays silent when only GM roles can browse', () => {
    expect(run({ permissions: { FILES_BROWSE: [3, 4] } })).toEqual({
      shown: false,
      warnings: [],
      marked: 0,
    });
  });

  it('shows only once', () => {
    expect(run({ alreadyShown: true }).warnings).toEqual([]);
  });

  it('never shows to players', () => {
    expect(run({ isGM: false }).warnings).toEqual([]);
  });
});
