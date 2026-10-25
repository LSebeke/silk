/**
 * `FoundryDocs` over real Foundry documents (spec §6, §7). Thin: every decision is in
 * `src/core/materialize`. Foundry calls come in through `FoundryApi` so this tests without
 * Foundry. Silk's writes carry `SILK_WRITE` so its own hooks skip them (spec §2).
 */
import { MODULE_ID } from '../constants';
import type {
  DocData,
  DocSnapshot,
  DocumentName,
  FolderKey,
  FoundryDocs,
} from '../core/materialize/port';
import { SILK_WRITE } from './working-copy-journal';

/** The slice of a Foundry document Silk uses. */
export interface FoundryDoc {
  id: string | null;
  uuid: string;
  documentName: string;
  toObject(): object;
  update(data: object, options?: object): Promise<unknown>;
  createEmbeddedDocuments(name: string, data: object[], options?: object): Promise<unknown>;
  updateEmbeddedDocuments(name: string, data: object[], options?: object): Promise<unknown>;
  deleteEmbeddedDocuments(name: string, ids: string[], options?: object): Promise<unknown>;
  sheet?: { render(force?: boolean): unknown } | null;
}

export interface FoundryDocumentClass {
  create(data: object, options?: object): Promise<FoundryDoc | undefined>;
  /** Upgrades stored data to the running core/system version (spec §6, §13). */
  migrateData(data: object): object;
}

export interface FoundryApi {
  documentClass(name: DocumentName | 'Folder'): FoundryDocumentClass;
  fromUuid(uuid: string): FoundryDoc | null | undefined;
  journal(id: string): FoundryDoc | null | undefined;
  folders(): Iterable<{ id: string | null; type: string; flags: Record<string, unknown> }>;
  /** `foundry.data.operators.ForcedReplacement.create`. */
  replace(value: object): object;
}

/** Source data (`toObject` is already a copy) plus identity; `flags.silk` always present. */
function snapshot(doc: FoundryDoc | null | undefined): DocSnapshot | undefined {
  if (!doc) return undefined;
  const data = doc.toObject() as DocData;
  return {
    ...data,
    flags: { ...data.flags, silk: { ...data.flags?.silk } },
    uuid: doc.uuid,
    documentName: doc.documentName as DocumentName,
  };
}

const foundryClone = <T>(value: T): T => structuredClone(value);

export function createFoundryDocs(api: FoundryApi): FoundryDocs {
  const folderJobs = new Map<string, Promise<string>>();

  function must(uuid: string): FoundryDoc {
    const doc = api.fromUuid(uuid);
    if (!doc) throw new Error(`Silk: no Foundry doc "${uuid}"`);
    return doc;
  }

  async function findOrCreateFolder(type: DocumentName, key: FolderKey, name: string) {
    for (const folder of api.folders()) {
      const silk = folder.flags[MODULE_ID] as { folder?: string } | undefined;
      if (folder.type === type && silk?.folder === key && folder.id) return folder.id;
    }
    const created = await api
      .documentClass('Folder')
      .create({ name, type, flags: { [MODULE_ID]: { folder: key } } }, { ...SILK_WRITE });
    if (!created?.id) throw new Error(`Silk: could not create folder "${name}"`);
    return created.id;
  }

  return {
    ensureFolder(type, key, name) {
      const id = `${type}.${key}`;
      let job = folderJobs.get(id);
      if (!job) {
        job = findOrCreateFolder(type, key, name).finally(() => folderJobs.delete(id));
        folderJobs.set(id, job);
      }
      return job;
    },
    async create(name, data) {
      const cls = api.documentClass(name);
      const source = cls.migrateData(foundryClone(data));
      const doc = await cls.create(source, { ...SILK_WRITE, keepId: true, keepEmbeddedIds: true });
      if (!doc) throw new Error(`Silk: Foundry refused to create ${name} "${data.name}"`);
      return doc.uuid;
    },
    get: (uuid) => snapshot(api.fromUuid(uuid)),
    journal: (id) => snapshot(api.journal(id)),
    async update(uuid, data) {
      await must(uuid).update(data, { ...SILK_WRITE });
    },
    async changeType(uuid, type, system) {
      await must(uuid).update({ type, system: api.replace(system) }, { ...SILK_WRITE });
    },
    async createPages(uuid, pages) {
      await must(uuid).createEmbeddedDocuments('JournalEntryPage', pages, {
        ...SILK_WRITE,
        keepId: true,
      });
    },
    async createCategories(uuid, categories) {
      await must(uuid).createEmbeddedDocuments('JournalEntryCategory', categories, {
        ...SILK_WRITE,
        keepId: true,
      });
    },
    async updatePage(uuid, pageId, data) {
      await must(uuid).updateEmbeddedDocuments('JournalEntryPage', [{ ...data, _id: pageId }], {
        ...SILK_WRITE,
      });
    },
    async deletePages(uuid, ids) {
      await must(uuid).deleteEmbeddedDocuments('JournalEntryPage', ids, { ...SILK_WRITE });
    },
    async open(uuid) {
      must(uuid).sheet?.render(true);
    },
  };
}
