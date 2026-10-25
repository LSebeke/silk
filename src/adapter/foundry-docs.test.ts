import { describe, expect, it } from 'vitest';
import { createFoundryDocs, type FoundryApi, type FoundryDoc } from './foundry-docs';

function fakeApi() {
  const calls: { op: string; args: unknown[] }[] = [];
  const folders: { id: string; type: string; flags: Record<string, unknown> }[] = [];
  const doc = (uuid: string, data: object): FoundryDoc => ({
    id: uuid.slice(uuid.indexOf('.') + 1),
    uuid,
    documentName: uuid.slice(0, uuid.indexOf('.')),
    toObject: () => structuredClone(data),
    update: async (...args) => void calls.push({ op: 'update', args }),
    createEmbeddedDocuments: async (...args) => void calls.push({ op: 'createEmbedded', args }),
    updateEmbeddedDocuments: async (...args) => void calls.push({ op: 'updateEmbedded', args }),
    deleteEmbeddedDocuments: async (...args) => void calls.push({ op: 'deleteEmbedded', args }),
    sheet: { render: (...args) => calls.push({ op: 'render', args }) },
  });
  const api: FoundryApi = {
    documentClass: (name) => ({
      migrateData(data) {
        calls.push({ op: 'migrate', args: [name] });
        return { ...data, migrated: true };
      },
      async create(data, options) {
        calls.push({ op: 'create', args: [name, data, options] });
        if (name === 'Folder') {
          const f = {
            id: `f${folders.length + 1}`,
            ...(data as { type: string; flags: Record<string, unknown> }),
          };
          folders.push(f);
          return doc(`Folder.${f.id}`, f);
        }
        return doc(`${name}.${(data as { _id: string })._id}`, data);
      },
    }),
    fromUuid: (uuid) => doc(uuid, { _id: 'x', name: 'X', flags: { silk: { id: 'el' } } }),
    journal: () => null,
    folders: () => folders,
    replace: (value) => ({ replaced: value }),
  };
  return { api, calls, folders };
}

describe('FoundryDocs adapter', () => {
  it('runs migrateData before creating, keeps ids and tags the write as Silk', async () => {
    const { api, calls } = fakeApi();
    const docs = createFoundryDocs(api);
    const uuid = await docs.create('Actor', {
      _id: 'a1',
      name: 'A',
      folder: null,
      flags: { silk: {} },
    });
    expect(uuid).toBe('Actor.a1');
    expect(calls.map((c) => c.op)).toEqual(['migrate', 'create']);
    const [, data, options] = calls[1]?.args as [string, object, object];
    expect(data).toMatchObject({ migrated: true, _id: 'a1' });
    expect(options).toEqual({ silk: { internal: true }, keepId: true, keepEmbeddedIds: true });
  });

  it('creates each Silk folder once and finds it again by flag', async () => {
    const { api, folders } = fakeApi();
    const docs = createFoundryDocs(api);
    const [a, b] = await Promise.all([
      docs.ensureFolder('Actor', 'person', 'Persons'),
      docs.ensureFolder('Actor', 'person', 'Persons'),
    ]);
    expect(a).toBe(b);
    expect(await docs.ensureFolder('Actor', 'person', 'Persons')).toBe(a);
    expect(await docs.ensureFolder('JournalEntry', 'person', 'x')).not.toBe(a);
    expect(folders).toHaveLength(2);
    expect(folders[0]).toMatchObject({
      type: 'Actor',
      name: 'Persons',
      flags: { silk: { folder: 'person' } },
    });
  });

  it('changes a subtype with a ForcedReplacement of system data', async () => {
    const { api, calls } = fakeApi();
    await createFoundryDocs(api).changeType('Actor.a1', 'creature', { a: 1 });
    expect(calls).toEqual([
      {
        op: 'update',
        args: [{ type: 'creature', system: { replaced: { a: 1 } } }, { silk: { internal: true } }],
      },
    ]);
  });

  it('snapshots source data with uuid and documentName', () => {
    const { api } = fakeApi();
    expect(createFoundryDocs(api).get('Item.x')).toEqual({
      _id: 'x',
      name: 'X',
      flags: { silk: { id: 'el' } },
      uuid: 'Item.x',
      documentName: 'Item',
    });
  });
});
