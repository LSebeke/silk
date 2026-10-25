/** In-memory `FoundryDocs` for tests: a tiny Foundry stand-in with world docs by uuid. */
import type {
  CategoryData,
  DocData,
  DocSnapshot,
  DocumentName,
  FolderKey,
  FoundryDocs,
  PageData,
} from './port';

export interface MemoryDocs extends FoundryDocs {
  /** All docs, by uuid. Mutate to simulate Foundry-side edits. */
  readonly docs: Map<string, DocSnapshot>;
  readonly folders: { id: string; type: DocumentName; key: FolderKey; name: string }[];
  readonly opened: string[];
  /** DSA5 `questlogJournals` stand-in. */
  readonly questJournals: { uuid: string; name: string }[];
}

const clone = <T>(value: T): T => structuredClone(value);

/** Applies Foundry-style update data (dotted keys, nested merge) in place. */
export function applyUpdate(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    const path = key.split('.');
    const deleted = path.at(-1)?.startsWith('-=');
    if (deleted) {
      // Foundry's `-=key` deletion syntax.
      let node: Record<string, unknown> | undefined = target;
      for (const part of path.slice(0, -1)) node = node?.[part] as typeof node;
      if (node) Reflect.deleteProperty(node, (path.at(-1) as string).slice(2));
      continue;
    }
    let node = target;
    for (const part of path.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    const last = path[path.length - 1] as string;
    const current = node[last];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object'
    )
      applyUpdate(current as Record<string, unknown>, value as Record<string, unknown>);
    else node[last] = clone(value);
  }
}

export function createMemoryDocs(): MemoryDocs {
  const docs = new Map<string, DocSnapshot>();
  const folders: MemoryDocs['folders'] = [];
  const opened: string[] = [];
  const questJournals: MemoryDocs['questJournals'] = [];
  let n = 0;

  function must(uuid: string) {
    const doc = docs.get(uuid);
    if (!doc) throw new Error(`no doc ${uuid}`);
    return doc;
  }
  function page(uuid: string, id: string) {
    const p = must(uuid).pages?.find((x) => x._id === id);
    if (!p) throw new Error(`no page ${id} in ${uuid}`);
    return p;
  }

  return {
    docs,
    folders,
    opened,
    questJournals,
    async ensureFolder(type, key, name) {
      const found = folders.find((f) => f.type === type && f.key === key);
      if (found) return found.id;
      const folder = { id: `folder${++n}`, type, key, name };
      folders.push(folder);
      return folder.id;
    },
    async create(documentName, data: DocData, parent?: string) {
      if (parent) must(parent);
      const uuid = parent ? `${parent}.${documentName}.${data._id}` : `${documentName}.${data._id}`;
      if (docs.has(uuid)) throw new Error(`duplicate ${uuid}`);
      docs.set(uuid, { ...clone(data), uuid, documentName, ...(parent ? { parent } : {}) });
      return uuid;
    },
    async delete(uuid) {
      must(uuid);
      for (const key of [...docs.keys()])
        if (key === uuid || key.startsWith(`${uuid}.`)) docs.delete(key);
    },
    get: (uuid) => (docs.has(uuid) ? clone(must(uuid)) : undefined),
    journal: (id) =>
      docs.has(`JournalEntry.${id}`) ? clone(must(`JournalEntry.${id}`)) : undefined,
    async update(uuid, data) {
      applyUpdate(must(uuid) as unknown as Record<string, unknown>, data);
    },
    async changeType(uuid, type, system) {
      const doc = must(uuid);
      doc.type = type;
      doc.system = clone(system);
    },
    async createPages(uuid, pages: PageData[]) {
      const doc = must(uuid);
      doc.pages = [...(doc.pages ?? []), ...clone(pages)];
    },
    async createCategories(uuid, categories: CategoryData[]) {
      const doc = must(uuid);
      doc.categories = [...(doc.categories ?? []), ...clone(categories)];
    },
    async updatePage(uuid, pageId, data) {
      applyUpdate(page(uuid, pageId) as unknown as Record<string, unknown>, data);
    },
    async deletePages(uuid, ids) {
      const doc = must(uuid);
      doc.pages = (doc.pages ?? []).filter((p) => !ids.includes(p._id));
    },
    async setStatusEffect(uuid, statusId, active) {
      const doc = must(uuid);
      const effects = doc.effects ?? [];
      const has = effects.some((e) => e.statuses?.includes(statusId));
      if (active && !has) doc.effects = [...effects, { statuses: [statusId] }];
      if (!active && has) doc.effects = effects.filter((e) => !e.statuses?.includes(statusId));
    },
    async registerQuestJournal(uuid, name) {
      must(uuid);
      if (!questJournals.some((q) => q.uuid === uuid)) questJournals.push({ uuid, name });
    },
    async open(uuid) {
      must(uuid);
      opened.push(uuid);
    },
  };
}
