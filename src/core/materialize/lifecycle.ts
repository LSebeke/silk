/**
 * Unmaterialize, Foundry-side deletion, element delete and reconcile (spec §6, §7).
 *
 * - Unmaterialize snapshots the element's docs into a `sheet` record, deletes them, and
 *   leaves a Ghost. Materializing again creates the docs from that snapshot.
 * - A doc deleted in Foundry is an Unmaterialize, never an element delete. A deleted
 *   Companion Journal is restored from the last Commit.
 * - Before a Commit, every Materialized element's docs are captured into its `sheet`
 *   record, so the Canon holds the full doc data (§11.2) and reconcile can restore it.
 *
 * Other features plug in as `LifecycleContributor`s (Event Scenes T13, Revelation Map T16,
 * Status T10, owns T12): their docs and derived state follow the element's lifecycle.
 * Pure core: Foundry is the `FoundryDocs` port.
 */
import { canonicalJson, type CanonRecord, type JsonObject, type Snapshot } from '../canon';
import type { Command } from '../commands/registry';
import { readConnection } from '../connections/connection';
import { elementRecord, readElement, type ElementData, type StoryElement } from '../elements';
import type { WorkingCopy } from '../working-copy';
import {
  SORT_STEP,
  blockPage,
  documentName,
  hasCompanion,
  infoBlockPages,
  missingLayout,
  planDocs,
  type DocPlan,
  type LayoutContext,
} from './layout';
import type { Materializer } from './materializer';
import { applyUpdate } from './memory-docs';
import {
  OWNERSHIP_NONE,
  type DocData,
  type DocSnapshot,
  type DocumentName,
  type FoundryDocs,
  type SilkDocFlags,
  type SystemMapping,
} from './port';

/** `sheet` record data: an element's docs as Unmaterialize / Commit captured them. */
export interface SheetData {
  element: string;
  documentName: DocumentName;
  /** Doc source data without ownership, folder, sort (not versioned, §11.2). */
  doc: DocData;
  companion?: DocData;
}

export const sheetId = (elementId: string) => `${elementId}-sheet`;

export function readSheet(record: CanonRecord | undefined): SheetData | undefined {
  if (record?.kind !== 'sheet') return undefined;
  return record.data as unknown as SheetData;
}

/** A doc Foundry deleted, as its delete hook saw it. Scenes etc. go to contributors. */
export type DeletedDoc = Omit<DocSnapshot, 'documentName' | 'flags'> & {
  documentName: string;
  flags: { silk?: SilkDocFlags };
};

export interface DeletedElement {
  element: StoryElement;
  /** Connection ids deleted with it. */
  connections: string[];
  /** The Foundry doc stays (Adopted element, Keep Foundry doc). */
  keepFoundryDoc: boolean;
}

/**
 * How another feature follows the element lifecycle. Every hook is optional.
 * - T13 Event Scenes: `unmaterialize` (snapshot Scene incl. walls into an `eventScene`
 *   record, delete Scene + tokens), `rematerialized`, `deleted`, `docDeleted` (Scene deleted
 *   → clear the link), `capture`, `reconcile` (present at ↔ tokens).
 * - T16 Reveal: `rematerialized` (apply ownership from the Revelation Map), `reconcile`.
 * - T10 Status (Dead), T12 owns, T11 Connections page: `reconcile`.
 */
export interface LifecycleContributor {
  /** Before the element's docs are deleted by Unmaterialize; `el.uuid` is still set. */
  unmaterialize?(el: StoryElement): Promise<void>;
  /** After the element was Materialized again from its snapshot. */
  rematerialized?(el: StoryElement): Promise<void>;
  /** After every Materialize (fresh or from the snapshot), after `rematerialized`. */
  materialized?(el: StoryElement): Promise<void>;
  /** `element.delete`, before Silk deletes the element's docs and records. */
  deleted?(info: DeletedElement): Promise<void>;
  /** A doc that is not an element's doc or Companion was deleted in Foundry. True = handled. */
  docDeleted?(doc: DeletedDoc): Promise<boolean>;
  /** Before a Commit: write your World State records. */
  capture?(): Promise<void>;
  /** Reconcile on load (GM): recompute your derived state from Foundry. */
  reconcile?(): Promise<void>;
}

export interface DeleteAnswer {
  /** For Adopted elements: keep their Foundry docs (default). */
  keepFoundryDoc: boolean;
}

export interface LifecycleDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  system: SystemMapping;
  materializer: Materializer;
  newId(): string;
  localize(key: string, data?: Record<string, string>): string;
  warn(message: string): void;
  /** Revealed to the party of the checked-out Campaign (§8). */
  isRevealed(id: string): Promise<boolean>;
  /** Client setting `warnUnmaterializeReveal` (§13). */
  warnRevealed(): boolean;
  /** "Players will lose access to …" Returns false to cancel. */
  confirmUnmaterialize(names: string[]): Promise<boolean>;
  /** Client setting `confirmDelete` (§13). */
  confirmDeleteEnabled(): boolean;
  /** Delete confirmation; `adopted` > 0 offers Keep Foundry doc / Delete everything. `null` = cancel. */
  confirmDelete(args: {
    names: string[];
    adopted: number;
    keepFoundryDoc: boolean;
  }): Promise<DeleteAnswer | null>;
  /** The checked-out head Commit, `null` before the first Commit or when unbound. */
  lastCommit(): Promise<{ hash: string; snapshot: Snapshot } | null>;
}

export interface Lifecycle {
  contribute(contributor: LifecycleContributor): void;
  /** `materialize.unmaterialize`: returns the ids Unmaterialized. */
  unmaterialize(ids: readonly string[]): Promise<string[]>;
  /** `element.delete`: returns the ids deleted (none on cancel). */
  deleteElements(ids: readonly string[], keepFoundryDoc?: boolean): Promise<string[]>;
  /** A Foundry delete hook (not Silk's own write). */
  docDeleted(doc: DeletedDoc): Promise<void>;
  /** Before a Commit: capture Materialized docs into `sheet` records. */
  capture(): Promise<void>;
  /** Reconcile on load (GM, §7): missing docs, mirrors, then contributors. */
  reconcile(): Promise<void>;
  /** For the materializer: create data from the element's snapshot, if any. */
  restorePlan(el: StoryElement, folders: { main: string; companion?: string }): DocPlan | undefined;
  /** For the materializer: after a Materialize. */
  afterMaterialize(id: string): Promise<void>;
}

const NONE = () => ({ default: OWNERSHIP_NONE });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Source data as versioned: no identity, ownership, folder or sort; pages at NONE. */
function versioned(doc: DocSnapshot | DeletedDoc): DocData {
  const data = json(doc) as Partial<DocSnapshot> & { sort?: number };
  delete data.uuid;
  delete data.documentName;
  delete data.ownership;
  delete data.folder;
  delete data.sort;
  if (data.pages) data.pages = data.pages.map((p) => ({ ...p, ownership: NONE() }));
  return data as DocData;
}

export function sheetRecord(
  elementId: string,
  main: DocSnapshot | DeletedDoc,
  companion: DocSnapshot | undefined,
): CanonRecord {
  const data: SheetData = {
    element: elementId,
    documentName: main.documentName as DocumentName,
    doc: versioned(main),
    ...(companion ? { companion: versioned(companion) } : {}),
  };
  return { kind: 'sheet', id: sheetId(elementId), data: data as unknown as JsonObject };
}

export function createLifecycle(deps: LifecycleDeps): Lifecycle {
  const { docs, system, materializer } = deps;
  const contributors: LifecycleContributor[] = [];
  const ctx: LayoutContext = { system, newId: deps.newId, localize: (k) => deps.localize(k) };
  /** Elements Materialized from a snapshot, waiting for `afterMaterialize`. */
  const restoring = new Set<string>();

  const wc = () => deps.workingCopy();
  const read = (id: string) => readElement(wc().get(id));

  function elements(): StoryElement[] {
    const out: StoryElement[] = [];
    for (const record of wc().records().values()) {
      const el = readElement(record);
      if (el) out.push(el);
    }
    return out;
  }

  async function writeElement(el: StoryElement, patch: Partial<ElementData>) {
    const clean = Object.fromEntries(
      Object.entries({ ...el, ...patch }).filter(([k, v]) => k !== 'id' && v !== undefined),
    );
    await wc().set([elementRecord(el.id, clean as unknown as ElementData)]);
  }

  async function setIfChanged(record: CanonRecord) {
    const current = wc().get(record.id);
    if (current && canonicalJson(current) === canonicalJson(record)) return;
    await wc().set([record]);
  }

  async function deleteDoc(uuid: string | undefined) {
    if (uuid && docs.get(uuid)) await docs.delete(uuid);
  }

  async function each<K extends keyof LifecycleContributor>(
    hook: K,
    ...args: Parameters<NonNullable<LifecycleContributor[K]>>
  ) {
    for (const c of contributors) {
      const fn = c[hook] as ((...a: typeof args) => Promise<unknown>) | undefined;
      await fn?.apply(c, args);
    }
  }

  /** Unmaterialize steps 1–3, with `main` as the snapshot source (it may be gone already). */
  async function unmaterializeOne(
    el: StoryElement,
    main: DocSnapshot | DeletedDoc | undefined,
    companion: DocSnapshot | undefined,
  ) {
    await each('unmaterialize', el);
    if (main) await wc().set([sheetRecord(el.id, main, companion)]);
    await deleteDoc(companion?.uuid);
    await deleteDoc(el.uuid);
    await writeElement(el, { uuid: undefined });
  }

  function companionOf(main: { flags: { silk?: SilkDocFlags } }) {
    const id = main.flags.silk?.companion;
    return id ? docs.journal(id) : undefined;
  }

  /** The element's Companion Journal from the last Commit, else fresh from the record. */
  async function restoreCompanion(el: StoryElement, main: DocSnapshot) {
    const id = main.flags.silk.companion;
    if (!id) return;
    const commit = await deps.lastCommit();
    const sheet = readSheet(commit?.snapshot.get(sheetId(el.id)));
    const folder = await docs.ensureFolder(
      'JournalEntry',
      'companions',
      deps.localize('SILK.Folder.companions'),
    );
    const data: DocData = sheet?.companion
      ? json(sheet.companion)
      : (planDocs(el, { main: folder, companion: folder }, ctx).companion as DocData);
    data._id = id;
    data.folder = folder;
    data.ownership = NONE();
    data.flags = { ...data.flags, silk: { ...data.flags?.silk, companionOf: el.id } };
    await docs.create('JournalEntry', data);
    deps.warn(deps.localize('SILK.Lifecycle.CompanionRestored', { name: el.name }));
    await materializer.sync(el.id);
  }

  /** Reconcile: the doc vanished unseen. The last Commit's snapshot becomes the Ghost's. */
  async function restoreMissing(el: StoryElement) {
    const commit = await deps.lastCommit();
    const sheet = commit?.snapshot.get(sheetId(el.id));
    await each('unmaterialize', el);
    if (sheet) await wc().set([sheet]);
    // The Companion Journal of an Actor/Item may have survived.
    const linked = readSheet(sheet)?.doc.flags.silk.companion;
    if (linked) await deleteDoc(docs.journal(linked)?.uuid);
    await writeElement(el, {
      uuid: undefined,
      ...(sheet && commit ? { restoredFrom: commit.hash } : {}),
    });
    deps.warn(
      deps.localize('SILK.Lifecycle.Restored', {
        name: el.name,
        commit: commit?.hash.slice(0, 8) ?? '–',
      }),
    );
  }

  function restorePlan(el: StoryElement, folders: { main: string; companion?: string }) {
    const sheet = readSheet(wc().get(sheetId(el.id)));
    const name = documentName(el.class);
    if (!sheet || sheet.documentName !== name) return undefined;
    const main: DocData = json(sheet.doc);
    Object.assign(main, { name: el.name, folder: folders.main, ownership: NONE() });
    main.flags = { ...main.flags, silk: { ...main.flags?.silk, id: el.id } };

    let companion: DocData | undefined;
    if (name !== 'JournalEntry') {
      const type = system.docType(el.class);
      if (type && type !== main.type) {
        main.type = type;
        main.system = system.toSystem(el.class, { ...el.fields });
      } else
        applyUpdate(
          main as unknown as Record<string, unknown>,
          system.systemUpdate(el.class, { ...el.fields }),
        );
      if (el.img) main.img = el.img;
      companion = sheet.companion ? json(sheet.companion) : planDocs(el, folders, ctx).companion;
      if (companion) {
        companion.name = el.name;
        companion.folder = folders.companion ?? null;
        companion.ownership = NONE();
        companion.flags = {
          ...companion.flags,
          silk: { ...companion.flags?.silk, companionOf: el.id },
        };
        main.flags.silk.companion = companion._id;
      }
    } else {
      const { cover, quest, questKey } = main.flags.silk;
      const coverPage = main.pages?.find((p) => p._id === cover);
      if (coverPage) coverPage.src = el.img ?? null;
      const questPage = main.pages?.find((p) => p._id === quest);
      if (questPage && questKey)
        applyUpdate(
          questPage as unknown as Record<string, unknown>,
          system.questTitleUpdate(questKey, el.name),
        );
    }

    const holder = name === 'JournalEntry' ? main : companion;
    if (holder && el.infoBlocks) {
      const blocks = new Set(
        infoBlockPages({ ...holder, uuid: '', documentName: 'JournalEntry' }).map((p) => p._id),
      );
      holder.pages = [
        ...(holder.pages ?? []).filter((p) => !blocks.has(p._id)),
        ...el.infoBlocks.map((b, i) => blockPage(b, (i + 1) * SORT_STEP)),
      ];
    }
    if (name === 'JournalEntry') {
      const add = missingLayout(main, el, ctx);
      main.pages = [...(main.pages ?? []), ...add.pages];
      main.categories = [...(main.categories ?? []), ...add.categories];
      main.flags.silk = { ...main.flags.silk, ...add.flags };
    }
    restoring.add(el.id);
    return { documentName: name, main, ...(companion ? { companion } : {}) } satisfies DocPlan;
  }

  return {
    contribute: (c) => void contributors.push(c),
    restorePlan,

    async afterMaterialize(id) {
      const el = read(id);
      if (!el) return;
      if (el.restoredFrom) await writeElement(el, { restoredFrom: undefined });
      if (restoring.delete(id)) await each('rematerialized', read(id) ?? el);
      await each('materialized', read(id) ?? el);
    },

    async unmaterialize(ids) {
      const targets = ids.map(read).filter((el): el is StoryElement => !!el?.uuid);
      if (!targets.length) return [];
      if (deps.warnRevealed()) {
        const revealed: string[] = [];
        for (const el of targets) if (await deps.isRevealed(el.id)) revealed.push(el.name);
        if (revealed.length && !(await deps.confirmUnmaterialize(revealed))) return [];
      }
      for (const el of targets) {
        const found = materializer.docsOf(el.id);
        await unmaterializeOne(el, found?.main, found?.companion);
      }
      return targets.map((el) => el.id);
    },

    async deleteElements(ids, keepFoundryDoc) {
      const targets = ids.map(read).filter((el): el is StoryElement => !!el);
      if (!targets.length) return [];
      let keep = keepFoundryDoc ?? true;
      if (deps.confirmDeleteEnabled()) {
        const answer = await deps.confirmDelete({
          names: targets.map((el) => el.name),
          adopted: targets.filter((el) => el.adopted).length,
          keepFoundryDoc: keep,
        });
        if (!answer) return [];
        keep = answer.keepFoundryDoc;
      }
      for (const el of targets) {
        const connections = [...wc().records().values()]
          .map(readConnection)
          .filter((c) => c && (c.from === el.id || c.to === el.id))
          .map((c) => c?.id as string);
        const keepDoc = !!el.adopted && keep;
        await each('deleted', { element: el, connections, keepFoundryDoc: keepDoc });
        const found = materializer.docsOf(el.id);
        if (found) {
          await deleteDoc(found.companion?.uuid);
          if (keepDoc) await docs.unflag(found.main.uuid);
          else await deleteDoc(found.main.uuid);
        }
        await wc().delete([...connections, sheetId(el.id), el.id]);
      }
      return targets.map((el) => el.id);
    },

    async docDeleted(doc) {
      const silk = doc.flags.silk ?? {};
      if (silk.id) {
        const el = read(silk.id);
        if (el?.uuid === doc.uuid) {
          await unmaterializeOne(el, doc, companionOf(doc));
          return;
        }
      }
      if (silk.companionOf) {
        const el = read(silk.companionOf);
        const main = el?.uuid ? docs.get(el.uuid) : undefined;
        if (el && main?.flags.silk.companion === doc._id) {
          await restoreCompanion(el, main);
          return;
        }
      }
      for (const c of contributors) if (await c.docDeleted?.(doc)) return;
    },

    async capture() {
      for (const el of elements()) {
        if (!el.uuid) continue;
        const found = materializer.docsOf(el.id);
        if (found) await setIfChanged(sheetRecord(el.id, found.main, found.companion));
      }
      await each('capture');
    },

    async reconcile() {
      for (const el of elements()) {
        if (!el.uuid) continue;
        const main = docs.get(el.uuid);
        if (!main) await restoreMissing(el);
        else if (hasCompanion(el.class) && main.flags.silk.companion && !companionOf(main))
          await restoreCompanion(el, main);
        else await materializer.sync(el.id);
      }
      await each('reconcile');
    },
  };
}

/** Commands (spec §15). GM only. Without `ids` they act on the canvas selection. */
export function lifecycleCommands(
  lifecycle: Lifecycle,
  selection: () => readonly string[],
): Command[] {
  const gm = (ctx: { isGM: boolean }) => ctx.isGM;
  return [
    {
      name: 'materialize.unmaterialize',
      title: 'SILK.Commands.materialize.unmaterialize',
      available: gm,
      run: async (args: { ids?: string[] } = {}) => ({
        ids: await lifecycle.unmaterialize(args.ids ?? selection()),
      }),
    },
    {
      name: 'element.delete',
      title: 'SILK.Commands.element.delete',
      available: gm,
      run: async (args: { ids?: string[]; keepFoundryDoc?: boolean } = {}) => ({
        ids: await lifecycle.deleteElements(args.ids ?? selection(), args.keepFoundryDoc),
      }),
    },
  ] as Command[];
}
