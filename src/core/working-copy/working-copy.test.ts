import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../canon';
import { createMemoryBackend } from './memory-backend';
import { createWorkingCopy, type WorkingCopyChange } from './working-copy';

const gareth: CanonRecord = { kind: 'element', id: 'el-gareth', data: { name: 'Gareth' } };
const ulf: CanonRecord = { kind: 'element', id: 'el-ulf', data: { name: 'Ulf' } };
const binding = { canonId: 'c1', checkout: { main: true as const }, head: null };

describe('working copy', () => {
  it('stores records and persists only the diff', async () => {
    const backend = createMemoryBackend();
    const wc = createWorkingCopy(backend, { canWrite: () => true });

    await wc.set([gareth, ulf]);
    await wc.delete(['el-ulf']);

    expect(wc.get('el-gareth')).toEqual(gareth);
    expect(wc.get('el-ulf')).toBeUndefined();
    expect([...wc.records().keys()]).toEqual(['el-gareth']);
    expect(backend.patches).toEqual([{ set: [gareth, ulf] }, { delete: ['el-ulf'] }]);
  });

  it('loads what the backend holds, so a reload sees earlier writes', async () => {
    const backend = createMemoryBackend();
    const first = createWorkingCopy(backend, { canWrite: () => true });
    await first.setBinding(binding);
    await first.set([gareth]);

    const reloaded = createWorkingCopy(backend, { canWrite: () => false });

    expect(reloaded.binding).toEqual(binding);
    expect(reloaded.get('el-gareth')).toEqual(gareth);
  });

  it('refuses writes on clients that are not the active GM', async () => {
    const backend = createMemoryBackend();
    const wc = createWorkingCopy(backend, { canWrite: () => false });

    await expect(wc.set([gareth])).rejects.toThrow(/active GM/);
    await expect(wc.setBinding(binding)).rejects.toThrow(/active GM/);
    expect(backend.patches).toEqual([]);
  });

  it('rejects record ids that cannot be flag keys', async () => {
    const wc = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    for (const id of ['a.b', '-=x', '__proto__', ''])
      await expect(wc.set([{ ...gareth, id }])).rejects.toThrow(/id/);
  });

  it('notifies watchers with the change and Svelte subscribers with the records', async () => {
    const wc = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
    const changes: WorkingCopyChange[] = [];
    const seen: string[][] = [];
    wc.watch((c) => changes.push(c));
    const unsubscribe = wc.subscribe((records) => seen.push([...records.keys()]));

    await wc.set([gareth]);
    unsubscribe();
    await wc.set([ulf]);

    expect(seen).toEqual([[], ['el-gareth']]);
    expect(changes).toEqual([
      { set: ['el-gareth'], deleted: [], binding: false },
      { set: ['el-ulf'], deleted: [], binding: false },
    ]);
  });

  it('applies remote patches from the writing client without writing back', async () => {
    const backend = createMemoryBackend();
    const wc = createWorkingCopy(backend, { canWrite: () => false });
    const changes: WorkingCopyChange[] = [];
    wc.watch((c) => changes.push(c));

    wc.applyRemote({ binding, set: [gareth, ulf] });
    wc.applyRemote({ delete: ['el-ulf'] });

    expect(wc.binding).toEqual(binding);
    expect([...wc.records().keys()]).toEqual(['el-gareth']);
    expect(changes.at(-1)).toEqual({ set: [], deleted: ['el-ulf'], binding: false });
    expect(backend.patches).toEqual([]);
  });

  it('replaceAll writes only what differs from the target state', async () => {
    const backend = createMemoryBackend();
    const wc = createWorkingCopy(backend, { canWrite: () => true });
    await wc.set([gareth, ulf]);
    backend.patches.length = 0;

    const renamed = { ...gareth, data: { name: 'Gareth Ulfson' } };
    const knows: CanonRecord = { kind: 'connection', id: 'cn-1', data: { from: 'a', to: 'b' } };
    await wc.replaceAll(
      new Map([
        [renamed.id, renamed],
        [knows.id, knows],
      ]),
    );

    expect(backend.patches).toEqual([{ set: [renamed, knows], delete: ['el-ulf'] }]);
    expect(wc.records()).toEqual(
      new Map([
        [renamed.id, renamed],
        [knows.id, knows],
      ]),
    );
  });
});
