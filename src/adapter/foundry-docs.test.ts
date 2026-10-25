import { describe, expect, it } from 'vitest';
import { createFoundryDocs, snapshot, type FoundryApi, type FoundryDoc } from './foundry-docs';

function fakeApi() {
  const calls: { op: string; args: unknown[] }[] = [];
  const folders: { id: string; type: string; flags: Record<string, unknown> }[] = [];
  const settings = new Map<string, unknown>();
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
    getSetting: (ns, key) => settings.get(`${ns}.${key}`),
    async setSetting(ns, key, value) {
      settings.set(`${ns}.${key}`, structuredClone(value));
    },
  };
  return { api, calls, folders, settings };
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

  it('creates an Item in an actor’s inventory and deletes docs, as Silk writes (T12)', async () => {
    const { api, calls } = fakeApi();
    const base = api.fromUuid;
    api.fromUuid = (uuid) => {
      const doc = base(uuid);
      if (!doc) return doc;
      return {
        ...doc,
        createEmbeddedDocuments: async (name, data, options) => {
          calls.push({ op: 'createEmbedded', args: [name, data, options] });
          return [{ uuid: `${uuid}.Item.${(data[0] as { _id: string })._id}` }];
        },
        delete: async (options) => void calls.push({ op: 'delete', args: [uuid, options] }),
      };
    };
    const docs = createFoundryDocs(api);
    const data = { _id: 'i1', name: 'Sword', folder: null, flags: { silk: { id: 'el' } } };
    expect(await docs.create('Item', data, 'Actor.a1')).toBe('Actor.a1.Item.i1');
    await docs.delete('Actor.a1.Item.i1');
    expect(calls.map((c) => c.op)).toEqual(['migrate', 'createEmbedded', 'delete']);
    expect(calls[1]?.args).toEqual([
      'Item',
      [{ ...data, migrated: true }],
      { silk: { internal: true }, keepId: true },
    ]);
    expect(calls[2]?.args).toEqual(['Actor.a1.Item.i1', { silk: { internal: true } }]);
  });

  it('snapshots an embedded doc with its parent uuid', () => {
    const doc = {
      uuid: 'Actor.a.Item.i',
      documentName: 'Item',
      parent: { uuid: 'Actor.a' },
      toObject: () => ({ _id: 'i', name: 'I', flags: {} }),
    };
    expect(snapshot(doc as never)).toMatchObject({ parent: 'Actor.a', flags: { silk: {} } });
  });

  it('registers a quest journal in DSA5 questlogJournals once, keeping other entries', async () => {
    const { api, settings } = fakeApi();
    settings.set('dsa5.questlogJournals', { activated: [{ uuid: 'JournalEntry.o', name: 'O' }] });
    const docs = createFoundryDocs(api);
    await docs.registerQuestJournal('JournalEntry.q', 'Q');
    await docs.registerQuestJournal('JournalEntry.q', 'Q');
    expect(settings.get('dsa5.questlogJournals')).toEqual({
      activated: [
        { uuid: 'JournalEntry.o', name: 'O' },
        { uuid: 'JournalEntry.q', name: 'Q' },
      ],
    });
  });

  it('sets a status effect through DSA5 add/removeCondition, only when it changes', async () => {
    const { api } = fakeApi();
    const ops: string[] = [];
    const effects: { statuses: Set<string> }[] = [];
    api.fromUuid = (uuid) =>
      ({
        uuid,
        effects,
        addCondition: async (id: string) => {
          ops.push(`add ${id}`);
          effects.push({ statuses: new Set([id]) });
        },
        removeCondition: async (id: string) => {
          ops.push(`remove ${id}`);
          effects.length = 0;
        },
      }) as unknown as FoundryDoc;
    const docs = createFoundryDocs(api);
    await docs.setStatusEffect('Actor.a', 'dead', true);
    await docs.setStatusEffect('Actor.a', 'dead', true);
    await docs.setStatusEffect('Actor.a', 'dead', false);
    await docs.setStatusEffect('Actor.a', 'dead', false);
    expect(ops).toEqual(['add dead', 'remove dead']);
  });
});
