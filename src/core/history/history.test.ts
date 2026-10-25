import { describe, expect, it } from 'vitest';
import { createMemoryFiles, openCanon, type CanonFiles, type CanonRecord } from '../canon';
import { createMemoryBackend } from '../working-copy';
import { createWorkingCopy } from '../working-copy/working-copy';
import { createHistory } from './history';

const gareth: CanonRecord = { kind: 'element', id: 'el-gareth', data: { name: 'Gareth' } };
const ulf: CanonRecord = { kind: 'element', id: 'el-ulf', data: { name: 'Ulf' } };

/** A World: its own working copy, sharing the Canon files with other Worlds. */
function world(files: CanonFiles) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const history = createHistory({
    files,
    workingCopy,
    author: () => 'Gamemaster',
    createdWith: 'silk test',
  });
  return { workingCopy, history };
}

describe('history', () => {
  it('a fresh World has no Checkout and cannot commit', async () => {
    const { history, workingCopy } = world(createMemoryFiles());
    expect(workingCopy.binding).toBeNull();
    await expect(history.commit({})).rejects.toThrow(/not bound/);
    await expect(history.discard()).rejects.toThrow(/not bound/);
  });

  it('canon.create binds the World to a new Canon on main, for life', async () => {
    const files = createMemoryFiles();
    const { history, workingCopy } = world(files);

    const { canonId } = await history.createCanon({ name: 'Aventurien' });

    expect(workingCopy.binding).toEqual({ canonId, checkout: { main: true }, head: null });
    expect((await openCanon(files, canonId)).manifest.name).toBe('Aventurien');
    await expect(history.createCanon({ name: 'Other' })).rejects.toThrow(/already bound/);
    await expect(history.bind({ canonId })).rejects.toThrow(/already bound/);
  });

  it('commits the working copy to main and moves the head', async () => {
    const files = createMemoryFiles();
    const { history, workingCopy } = world(files);
    const { canonId } = await history.createCanon({ name: 'A' });
    await workingCopy.set([gareth, ulf]);
    expect(await history.isDirty()).toBe(true);

    const head = await history.commit({ label: 'Session 1' });

    const canon = await openCanon(files, canonId);
    expect(await canon.getMain()).toBe(head);
    expect(await canon.readSnapshot(head)).toEqual(workingCopy.records());
    expect(await canon.readCommit(head)).toMatchObject({
      label: 'Session 1',
      author: 'Gamemaster',
      parents: [],
    });
    expect(workingCopy.binding?.head).toBe(head);
    expect(await history.isDirty()).toBe(false);
  });

  it('a clean commit writes nothing and returns the head', async () => {
    const files = createMemoryFiles();
    const { history, workingCopy } = world(files);
    await history.createCanon({ name: 'A' });
    await workingCopy.set([gareth]);
    const head = await history.commit({});
    files.writes.length = 0;

    expect(await history.commit({ label: 'again' })).toBe(head);
    expect(files.writes).toEqual([]);
  });

  it('chains commits on the previous head', async () => {
    const { history, workingCopy } = world(createMemoryFiles());
    await history.createCanon({ name: 'A' });
    await workingCopy.set([gareth]);
    const first = await history.commit({});
    await workingCopy.set([ulf]);
    const second = await history.commit({});

    const log = await history.log();
    expect(log.map((c) => c.hash)).toEqual([second, first]);
  });

  it('discard resets the working copy to the last Commit', async () => {
    const { history, workingCopy } = world(createMemoryFiles());
    await history.createCanon({ name: 'A' });
    await workingCopy.set([gareth]);
    await history.commit({});
    await workingCopy.set([{ ...gareth, data: { name: 'Changed' } }, ulf]);

    await history.discard();

    expect(workingCopy.records()).toEqual(new Map([[gareth.id, gareth]]));
    expect(await history.isDirty()).toBe(false);
  });

  it('canon.bind checks out main in another World', async () => {
    const files = createMemoryFiles();
    const first = world(files);
    const { canonId } = await first.history.createCanon({ name: 'A' });
    await first.workingCopy.set([gareth, ulf]);
    const head = await first.history.commit({});

    const second = world(files);
    await second.history.bind({ canonId });

    expect(second.workingCopy.binding).toEqual({ canonId, checkout: { main: true }, head });
    expect(second.workingCopy.records()).toEqual(first.workingCopy.records());
  });

  it('canon.bind refuses a Canon that does not exist', async () => {
    const { history, workingCopy } = world(createMemoryFiles());
    await expect(history.bind({ canonId: 'f'.repeat(32) })).rejects.toThrow();
    expect(workingCopy.binding).toBeNull();
  });

  it('commits under an Adventure checkout move the Adventure, not main', async () => {
    const files = createMemoryFiles();
    const { history, workingCopy } = world(files);
    const { canonId } = await history.createCanon({ name: 'A' });
    await workingCopy.set([gareth]);
    const base = await history.commit({});
    const canon = await openCanon(files, canonId);
    await canon.writeAdventure({ id: 'adv-1', name: 'X', campaignId: 'c', base, head: base });
    await workingCopy.setBinding({ canonId, checkout: { adventure: 'adv-1' }, head: base });

    await workingCopy.set([ulf]);
    const played = await history.commit({ label: 'Session 1' });

    expect(await canon.getMain()).toBe(base);
    expect((await canon.getAdventure('adv-1'))?.head).toBe(played);
  });

  it('captures World State before a Commit (beforeCommit), and exposes the last Commit', async () => {
    const files = createMemoryFiles();
    const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    const sheet: CanonRecord = { kind: 'sheet', id: 'el-gareth-sheet', data: { name: 'G' } };
    const history = createHistory({
      files,
      workingCopy,
      author: () => 'GM',
      createdWith: 'silk test',
      beforeCommit: () => workingCopy.set([sheet]),
    });
    await history.createCanon({ name: 'A' });
    expect(await history.lastCommit()).toBeNull();
    await workingCopy.set([gareth]);

    const head = await history.commit({});

    expect(await history.lastCommit()).toEqual({
      hash: head,
      snapshot: new Map([
        [gareth.id, gareth],
        [sheet.id, sheet],
      ]),
    });
  });
});
