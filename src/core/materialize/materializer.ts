/**
 * Materialize and write-through (spec §6 Materialize, §7 source of truth).
 *
 * - Ghost: the element record in the working copy is the truth.
 * - Materialized: the Foundry doc is the truth for title, image, Info Blocks and class fields.
 *   Silk writes those to Foundry, and `sync` mirrors Foundry back into the record so the
 *   canvas and Commits see them. Tags, class and layout stay Silk-owned.
 *
 * Pure core: Foundry is the injected `FoundryDocs` port, DSA5 the `SystemMapping`.
 */
import { canonicalJson, type JsonObject } from '../canon';
import type { Command } from '../commands/registry';
import {
  elementClass,
  appearanceBlock,
  elementRecord,
  generatedActor,
  hasAppearanceClass,
  sceneSource,
  isGhost,
  nextStatus,
  readElement,
  statusesOf,
  storedStatus,
  type Status,
  type ClassFields,
  type ElementClassId,
  type ElementData,
  type InfoBlock,
  type StoryElement,
} from '../elements';
import type { WorkingCopy } from '../working-copy';
import {
  CONNECTIONS_SORT,
  SORT_STEP,
  blockJournal,
  blockPage,
  defaultInfoBlocks,
  documentName,
  hasCompanion,
  infoBlockPages,
  missingLayout,
  planDocs,
  readBack,
  type DocPlan,
  type LayoutContext,
} from './layout';
import { deepMerge } from '../util/objects';
import { imageWrites, type ImageEdit } from '../portrait';
import type { DocData, DocSnapshot, FolderKey, FoundryDocs, SystemMapping } from './port';

export type MaterializeMode = 'immediate' | 'onDemand';

export interface MaterializerDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  system: SystemMapping;
  /** World setting `materializeMode` (§13). */
  mode(): MaterializeMode;
  newId(): string;
  localize(key: string, data?: Record<string, string>): string;
  /** Toast (implicit Materialize, §6). */
  notify(message: string): void;
  /** "Materialize N elements?" (Materialize visible). */
  confirm(count: number): Promise<boolean>;
  /**
   * Element ids the canvas renders under the current Canvas Filters and Focus View,
   * offscreen included. Until T23/T24: every element.
   */
  visibleIds(): readonly string[];
  /** Current canvas selection (`m` without args). */
  selection(): readonly string[];
  /**
   * True while the Creation Pipeline is creating: immediate Materialize then waits for
   * the name step (`afterPipeline`) instead of running inside `element.create`.
   */
  deferImmediate?(): boolean;
  /** T12: the Actor uuid an Item Materializes into (its owner's inventory), else world. */
  parentOf?(id: string): string | undefined;
  /** Create data from an Unmaterialize snapshot, if the element has one (T9 `lifecycle.ts`). */
  restorePlan?(
    element: StoryElement,
    folders: { main: string; companion?: string },
  ): DocPlan | undefined;
  /**
   * After a Materialize created the docs (T9: contributors restore ownership, Event Scene;
   * T12: owned Items move into a new actor).
   */
  afterMaterialize?(id: string): Promise<void>;
  /** The placed tokens of a linked actor, where they differ (v1.1 §G.3). */
  tokens?(actorUuid: string, data: Record<string, unknown>): Promise<void>;
}

export interface Materializer {
  /** Materializes the Ghosts among `ids` (skips Player Characters). Returns those done. */
  materialize(ids: readonly string[]): Promise<string[]>;
  /**
   * Materialize visible (§6): every rendered Ghost except Player Characters, after a
   * confirmation with the count (skipped when `confirmed`).
   */
  materializeVisible(confirmed: boolean): Promise<{ ids: string[] }>;
  selection(): readonly string[];
  /** Implicit Materialize (§6 on demand): Materializes a Ghost with a toast. Returns its uuid. */
  ensureMaterialized(id: string): Promise<string>;
  /** `element.create` hook: default Info Blocks, then immediate Materialize. */
  afterCreate(element: { id: string } & ElementData): Promise<undefined>;
  /** Creation Pipeline finished the name step (§6 Immediate). */
  afterPipeline(id: string): Promise<void>;
  /** `element.rename` hook: name → Foundry. */
  writeName(id: string): Promise<void>;
  /**
   * `element.setImage` (v1.1 §G.3), hood-aware. A Ghost's image goes to the record; a token
   * edit (actor classes only) Materializes it first.
   */
  setImage(id: string, edit: ImageEdit): Promise<void>;
  setFields(id: string, fields: ClassFields): Promise<void>;
  changeClass(id: string, cls: string): Promise<void>;
  /** `appearance`: the Appearance preset (v1.1 §C.2), actor classes without one only. */
  createInfoBlock(args: {
    elementId: string;
    name?: string;
    text?: string;
    appearance?: boolean;
  }): Promise<string>;
  editInfoBlock(args: { id: string; name?: string; text?: string }): Promise<void>;
  deleteInfoBlock(id: string): Promise<void>;
  /** Moves an Info Block to position `index` among the element's Info Blocks (v1.1 §C.1). */
  moveInfoBlock(id: string, index: number): Promise<void>;
  /** "Open in Foundry" (v1.1 §C.1): the journal at the block's page; implicit Materialize. */
  openInfoBlock(id: string): Promise<void>;
  tag(ids: readonly string[], tag: string, on: boolean): Promise<void>;
  /** Status (§4): Foundry for a Materialized Person/Creature/Quest, else the record. */
  setStatus(id: string, status: string): Promise<void>;
  /** Next Status in the class's order. Returns it. */
  toggleStatus(id: string): Promise<Status>;
  /** The main doc only (v1.1 §G.2); implicit Materialize. */
  openSheet(id: string): Promise<void>;
  /** The Companion Journal, or a journal class's main journal (v1.1 §G.2); implicit Materialize. */
  openJournal(id: string): Promise<void>;
  /** Foundry → record mirror for a Materialized element (Foundry edits flow back, §7). */
  sync(id: string): Promise<void>;
  /** The Story Element a Silk doc (or Companion Journal) belongs to. */
  elementIdOf(doc: { flags?: unknown }): string | undefined;
  /** The element's docs, if Materialized and present. */
  docsOf(id: string): { main: DocSnapshot; companion?: DocSnapshot } | undefined;
}

const FOLDER_DOC = (cls: ElementClassId) => documentName(cls);

export function createMaterializer(deps: MaterializerDeps): Materializer {
  const { docs, system } = deps;
  const ctx: LayoutContext = { system, newId: deps.newId, localize: (k) => deps.localize(k) };
  /** One Materialize per element at a time. */
  const inflight = new Map<string, Promise<string>>();

  function element(id: string): StoryElement {
    const el = readElement(deps.workingCopy().get(id));
    if (!el) throw new Error(`Silk: no element "${id}"`);
    return el;
  }

  async function write(id: string, patch: Partial<ElementData>) {
    const wc = deps.workingCopy();
    const record = wc.get(id);
    if (!record) return;
    const data = Object.fromEntries(
      Object.entries({ ...record.data, ...patch }).filter(([, v]) => v !== undefined),
    );
    if (canonicalJson(data as JsonObject) === canonicalJson(record.data)) return;
    await wc.set([elementRecord(id, data as unknown as ElementData)]);
  }

  function folderName(key: FolderKey) {
    return deps.localize(`SILK.Folder.${key}`);
  }

  function docsOf(id: string) {
    const el = readElement(deps.workingCopy().get(id));
    if (!el?.uuid) return undefined;
    const main = docs.get(el.uuid);
    if (!main) return undefined;
    const companionId = main.flags.silk.companion;
    const companion = companionId ? docs.journal(companionId) : undefined;
    return companion ? { main, companion } : { main };
  }

  function requireDocs(id: string) {
    const found = docsOf(id);
    if (!found) throw new Error(`Silk: the Foundry doc of "${id}" is missing`);
    return found;
  }

  async function sync(id: string) {
    const el = readElement(deps.workingCopy().get(id));
    if (!el?.uuid) return;
    const found = docsOf(id);
    if (!found) return; // Foundry-side deletion is T9's.
    await write(id, readBack(el.class, found.main, found.companion, system));
  }

  async function doMaterialize(id: string): Promise<string> {
    const el = element(id);
    if (el.uuid) return el.uuid;
    if (!elementClass(el.class)?.creatable)
      throw new Error(`Silk: ${el.class} elements are never created, only Adopted`);
    const name = FOLDER_DOC(el.class);
    const main = await docs.ensureFolder(name, el.class, folderName(el.class));
    const companion = hasCompanion(el.class)
      ? await docs.ensureFolder('JournalEntry', 'companions', folderName('companions'))
      : undefined;
    const folders = companion ? { main, companion } : { main };
    const plan =
      deps.restorePlan?.(el, folders) ?? (await fromSource(el, planDocs(el, folders, ctx)));
    const parent = name === 'Item' ? deps.parentOf?.(id) : undefined;
    if (parent) plan.main.folder = null;
    // Companion first: the doc's flag points at it.
    if (plan.companion) await docs.create('JournalEntry', plan.companion);
    const bound = bindable(el);
    const uuid = bound
      ? await bind(bound, plan.main)
      : await docs.create(plan.documentName, plan.main, parent);
    if (el.status === 'dead') await docs.setStatusEffect(uuid, system.deadEffect, true);
    if (el.class === 'quest') await questJournal(uuid, el.name);
    await write(id, { uuid });
    await sync(id);
    await deps.afterMaterialize?.(id);
    return uuid;
  }

  /**
   * Generator pick (v1.1 §B.3): the Actor it created, if still there and no Story Element.
   * Otherwise Materialize creates a fresh doc as for any Ghost.
   */
  function bindable(el: StoryElement): string | undefined {
    const uuid = generatedActor(el.source);
    const doc = uuid ? docs.get(uuid) : undefined;
    if (!doc || doc.documentName !== documentName(el.class) || doc.parent) return undefined;
    return doc.flags.silk?.id ? undefined : doc.uuid;
  }

  /** The existing doc takes the plan's Silk-owned parts; what the generator made stays. */
  async function bind(uuid: string, main: DocPlan['main']) {
    await docs.update(uuid, {
      name: main.name,
      folder: main.folder,
      ownership: main.ownership,
      flags: { silk: main.flags.silk },
    });
    return uuid;
  }

  /**
   * Ghost worlds (1.1 §B.1): a Compendium-sourced element imports its entry now. The entry's
   * data replaces the blank main doc; Silk's id, name, folder, ownership and flags stay.
   * A Scene source (Location, Event; §B.2.1) is not the main doc: Event Scenes import it.
   */
  async function fromSource(el: StoryElement, plan: DocPlan): Promise<DocPlan> {
    if (el.source?.kind !== 'compendium' || sceneSource(el.class, el.source)) return plan;
    const data = await docs.importData(el.source.uuid);
    if (!data) {
      deps.notify(deps.localize('SILK.Materialize.CompendiumMissing', { name: el.name }));
      return plan;
    }
    const blank = plan.main;
    const fields = el.fields && Object.keys(el.fields).length ? el.fields : undefined;
    const main: DocData = {
      ...data,
      _id: blank._id,
      name: blank.name,
      folder: blank.folder,
      ...(blank.ownership ? { ownership: blank.ownership } : {}),
      flags: { ...data.flags, silk: blank.flags.silk },
      // Edits made while a Ghost win over the entry's.
      system: fields
        ? deepMerge(data.system ?? {}, system.toSystem(el.class, { ...fields }))
        : (data.system ?? {}),
    };
    const type = data.type ?? blank.type;
    if (type) main.type = type;
    const img = el.img ?? data.img;
    if (img) main.img = img;
    return { ...plan, main };
  }

  function materializeOne(id: string): Promise<string> {
    const running = inflight.get(id);
    if (running) return running;
    const job = doMaterialize(id).finally(() => inflight.delete(id));
    inflight.set(id, job);
    return job;
  }

  async function materialize(ids: readonly string[]) {
    const done: string[] = [];
    // Sequential: folders are created once, and Foundry gets one write at a time.
    for (const id of ids) {
      const el = readElement(deps.workingCopy().get(id));
      if (!el || !isGhost(el) || !elementClass(el.class)?.creatable) continue;
      await materializeOne(id);
      done.push(id);
    }
    return done;
  }

  async function ensureMaterialized(id: string) {
    const el = element(id);
    if (el.uuid) return el.uuid;
    const uuid = await materializeOne(id);
    deps.notify(deps.localize('SILK.Materialize.Implicit', { name: el.name }));
    return uuid;
  }

  function findBlock(blockId: string): { el: StoryElement; block: InfoBlock } {
    for (const record of deps.workingCopy().records().values()) {
      const el = readElement(record);
      const block = el?.infoBlocks?.find((b) => b._id === blockId);
      if (el && block) return { el, block };
    }
    throw new Error(`Silk: no Info Block "${blockId}"`);
  }

  function holderOf(id: string) {
    const { main, companion } = requireDocs(id);
    const holder = blockJournal(main, companion);
    if (!holder) throw new Error(`Silk: "${id}" has no journal for Info Blocks`);
    return holder;
  }

  /**
   * §4 Quest: the journal joins the DSA5 quest log; the native quest fields stay DSA5's
   * and become visible on Reveal, so the GM is warned.
   */
  async function questJournal(uuid: string, name: string) {
    await docs.registerQuestJournal(uuid, name);
    deps.notify(deps.localize('SILK.Materialize.QuestNativeFields', { name }));
  }

  function quest(main: DocSnapshot) {
    const { quest: page, questKey: key } = main.flags.silk;
    return page && key ? { page, key } : undefined;
  }

  async function setStatus(id: string, status: string) {
    const el = element(id);
    const value = statusesOf(el.class).find((s) => s === status);
    if (!value) throw new Error(`Silk: "${status}" is not a Status of ${el.class} elements`);
    const found = el.uuid ? docsOf(id) : undefined;
    if (found && (el.class === 'person' || el.class === 'creature')) {
      await docs.setStatusEffect(found.main.uuid, system.deadEffect, value === 'dead');
    } else if (found && el.class === 'quest' && quest(found.main)) {
      const { page, key } = quest(found.main) as { page: string; key: string };
      const index = statusesOf('quest').indexOf(value);
      await docs.updatePage(found.main.uuid, page, system.questStatusUpdate(key, index));
    } else {
      // Ghost or Event: Silk holds the Status.
      await write(id, { status: storedStatus(el.class, value) });
      return;
    }
    await sync(id);
  }

  return {
    materialize,
    selection: () => deps.selection(),
    async materializeVisible(confirmed) {
      const ids = deps.visibleIds().filter((id) => {
        const el = readElement(deps.workingCopy().get(id));
        return !!el && isGhost(el) && !!elementClass(el.class)?.creatable;
      });
      if (!ids.length) return { ids: [] };
      if (!confirmed && !(await deps.confirm(ids.length))) return { ids: [] };
      return { ids: await materialize(ids) };
    },
    ensureMaterialized,
    sync,
    docsOf,

    async afterCreate(created) {
      await write(created.id, { infoBlocks: defaultInfoBlocks(created.class, ctx) });
      // A generator's Actor already exists: bound at once, in every mode (v1.1 §B.1).
      const immediate = deps.mode() === 'immediate' && !deps.deferImmediate?.();
      if (generatedActor(created.source) || immediate) await materialize([created.id]);
      return undefined;
    },

    async afterPipeline(id) {
      if (deps.mode() === 'immediate') await materialize([id]);
    },

    async writeName(id) {
      const el = element(id);
      if (!el.uuid) return;
      const { main, companion } = requireDocs(id);
      await docs.update(main.uuid, { name: el.name });
      if (companion) await docs.update(companion.uuid, { name: el.name });
      const { quest, questKey } = main.flags.silk;
      if (quest && questKey)
        await docs.updatePage(main.uuid, quest, system.questTitleUpdate(questKey, el.name));
      await sync(id);
    },

    async setImage(id, edit) {
      let el = element(id);
      if (edit.token) {
        if (documentName(el.class) !== 'Actor')
          throw new Error(`Silk: ${el.class} elements have no token`);
        if (!el.uuid) {
          if (edit.img !== undefined) await write(id, { img: edit.img || undefined });
          await ensureMaterialized(id);
          el = element(id);
        }
      }
      const img = edit.img;
      const cover = el.uuid ? requireDocs(id).main.flags.silk.cover : undefined;
      if (!el.uuid || (documentName(el.class) === 'JournalEntry' && !cover)) {
        // Ghost, or a Note (no Cover page): Silk holds the image.
        if (img !== undefined) await write(id, { img: img || undefined });
        return;
      }
      const { main } = requireDocs(id);
      if (cover) {
        if (img !== undefined) await docs.updatePage(main.uuid, cover, { src: img || null });
      } else {
        // Hood-aware (§8, v1.1 §G.3): the Portrait module decides what is shown.
        const writes = imageWrites(main, edit, el.img);
        if (Object.keys(writes.doc).length) await docs.update(main.uuid, writes.doc);
        if (writes.tokens) await deps.tokens?.(main.uuid, writes.tokens);
      }
      await sync(id);
    },

    async setFields(id, fields) {
      const el = element(id);
      if (!el.uuid) {
        await write(id, { fields: { ...el.fields, ...fields } });
        return;
      }
      const update = system.systemUpdate(el.class, { ...fields });
      if (Object.keys(update).length) await docs.update(requireDocs(id).main.uuid, update);
      await sync(id);
    },

    async changeClass(id, cls) {
      const el = element(id);
      const target = elementClass(cls);
      const from = elementClass(el.class);
      if (!target || !from) throw new Error(`Silk: unknown Element class "${cls}"`);
      if (target.id === el.class) return;
      if (!target.creatable || !from.creatable)
        throw new Error('Silk: Player Characters can only be Adopted, not changed into or from');
      if (target.docKind !== from.docKind)
        throw new Error(
          `Silk: a ${from.id} can only become a class backed by the same kind of Foundry doc`,
        );
      if (el.uuid) {
        const { main } = requireDocs(id);
        const type = system.docType(target.id);
        if (type && type !== main.type)
          await docs.changeType(main.uuid, type, system.toSystem(target.id, { ...el.fields }));
        if (main.documentName === 'JournalEntry') {
          const add = missingLayout(main, { ...el, class: target.id }, ctx);
          if (add.categories.length) await docs.createCategories(main.uuid, add.categories);
          if (add.pages.length) await docs.createPages(main.uuid, add.pages);
          if (Object.keys(add.flags).length)
            await docs.update(main.uuid, { flags: { silk: add.flags } });
        }
        const folder = await docs.ensureFolder(
          FOLDER_DOC(target.id),
          target.id,
          folderName(target.id),
        );
        await docs.update(main.uuid, { folder });
        if (target.id === 'quest') await questJournal(main.uuid, el.name);
      }
      const keep = statusesOf(target.id).some((s) => s === el.status);
      await write(id, { class: target.id, status: keep ? el.status : undefined });
      await sync(id);
    },

    async createInfoBlock({ elementId, name, text, appearance }) {
      const el = element(elementId);
      // v1.1 §C.2: the Appearance preset, on an actor class that has none.
      if (appearance && (!hasAppearanceClass(el.class) || appearanceBlock(el)))
        throw new Error(`Silk: "${el.name}" cannot get an Appearance block`);
      const fallback = appearance ? 'SILK.InfoBlock.Appearance' : 'SILK.InfoBlock.New';
      const block: InfoBlock = {
        _id: deps.newId(),
        name: name?.trim() || deps.localize(fallback),
        text: text ?? '',
        ...(appearance ? { appearance: true as const } : {}),
      };
      if (!el.uuid) {
        await write(elementId, { infoBlocks: [...(el.infoBlocks ?? []), block] });
        return block._id;
      }
      const holder = holderOf(elementId);
      const last = infoBlockPages(holder).at(-1)?.sort ?? 0;
      const sort = Math.min(last + SORT_STEP, Math.floor((last + CONNECTIONS_SORT) / 2));
      await docs.createPages(holder.uuid, [blockPage(block, sort)]);
      await sync(elementId);
      return block._id;
    },

    async editInfoBlock({ id, name, text }) {
      const { el, block } = findBlock(id);
      const next = {
        ...block,
        ...(name !== undefined ? { name: name.trim() || block.name } : {}),
        ...(text !== undefined ? { text } : {}),
      };
      if (!el.uuid) {
        await write(el.id, {
          infoBlocks: (el.infoBlocks ?? []).map((b) => (b._id === id ? next : b)),
        });
        return;
      }
      const update: Record<string, unknown> = {};
      if (name !== undefined) update['name'] = next.name;
      if (text !== undefined) update['text.content'] = text;
      await docs.updatePage(holderOf(el.id).uuid, id, update);
      await sync(el.id);
    },

    async deleteInfoBlock(id) {
      const { el } = findBlock(id);
      if (!el.uuid) {
        await write(el.id, { infoBlocks: (el.infoBlocks ?? []).filter((b) => b._id !== id) });
        return;
      }
      await docs.deletePages(holderOf(el.id).uuid, [id]);
      await sync(el.id);
    },

    async moveInfoBlock(id, index) {
      const { el, block } = findBlock(id);
      const rest = (el.infoBlocks ?? []).filter((b) => b._id !== id);
      const at = Math.max(0, Math.min(Math.trunc(index) || 0, rest.length));
      const order = [...rest.slice(0, at), block, ...rest.slice(at)];
      if (!el.uuid) {
        await write(el.id, { infoBlocks: order });
        return;
      }
      // Renumber in steps: Cover/quest (sort 0/1) stay first, Connections last.
      const holder = holderOf(el.id);
      const sorts = new Map(infoBlockPages(holder).map((p) => [p._id, p.sort]));
      for (const [i, b] of order.entries()) {
        const sort = (i + 1) * SORT_STEP;
        if (sorts.get(b._id) !== sort) await docs.updatePage(holder.uuid, b._id, { sort });
      }
      await sync(el.id);
    },

    async openInfoBlock(id) {
      const { el } = findBlock(id);
      await ensureMaterialized(el.id);
      await docs.open(holderOf(el.id).uuid, id);
    },

    async tag(ids, tag, on) {
      const name = tag.trim();
      if (!name) throw new Error('Silk: empty Tag');
      for (const id of ids) {
        const el = element(id);
        const tags = new Set(el.tags ?? []);
        if (on) tags.add(name);
        else tags.delete(name);
        await write(id, { tags: tags.size ? [...tags].sort() : undefined });
      }
    },

    setStatus,
    async toggleStatus(id) {
      const status = nextStatus(element(id));
      await setStatus(id, status);
      return status;
    },

    async openSheet(id) {
      await ensureMaterialized(id);
      await docs.open(requireDocs(id).main.uuid);
    },

    async openJournal(id) {
      await ensureMaterialized(id);
      await docs.open(holderOf(id).uuid);
    },

    elementIdOf(doc) {
      const silk = (doc.flags as { silk?: { id?: unknown; companionOf?: unknown } } | undefined)
        ?.silk;
      const id = silk?.id ?? silk?.companionOf;
      return typeof id === 'string' ? id : undefined;
    },
  };
}

/** Commands (spec §15 "Materialize / Adopt", "Elements"). GM only. */
export function materializeCommands(m: Materializer): Command[] {
  const gm = (ctx: { isGM: boolean }) => ctx.isGM;
  const command = <A, R>(
    name: string,
    run: (args: A) => Promise<R>,
    keys?: Command['keys'],
  ): Command<A, R> => ({
    name,
    title: `SILK.Commands.${name}`,
    available: gm,
    run,
    ...(keys ? { keys } : {}),
  });
  return [
    // `m` (§10.3) runs without args: the canvas selection.
    command(
      'materialize.elements',
      async (args: { ids?: string[] }) => ({
        ids: await m.materialize(args.ids ?? m.selection()),
      }),
      [{ key: 'KeyM' }],
    ),
    command('materialize.visible', (args: { confirmed?: boolean }) =>
      m.materializeVisible(args.confirmed ?? false),
    ),
    command('element.setImage', ({ id, ...edit }: { id: string } & ImageEdit) =>
      m.setImage(id, edit),
    ),
    command('element.setFields', (args: { id: string; fields: ClassFields }) =>
      m.setFields(args.id, args.fields),
    ),
    command('element.changeClass', (args: { id: string; class: string }) =>
      m.changeClass(args.id, args.class),
    ),
    command('element.setStatus', (args: { id: string; status: string }) =>
      m.setStatus(args.id, args.status),
    ),
    command('element.toggleStatus', async (args: { id: string }) => ({
      status: await m.toggleStatus(args.id),
    })),
    command('element.openSheet', (args: { id: string }) => m.openSheet(args.id)),
    command('element.openJournal', (args: { id: string }) => m.openJournal(args.id)),
    command('element.tag', (args: { ids: string[]; tag: string }) =>
      m.tag(args.ids, args.tag, true),
    ),
    command('element.untag', (args: { ids: string[]; tag: string }) =>
      m.tag(args.ids, args.tag, false),
    ),
    command(
      'infoBlock.create',
      async (args: { elementId: string; name?: string; text?: string; appearance?: boolean }) => ({
        id: await m.createInfoBlock(args),
      }),
    ),
    command('infoBlock.edit', (args: { id: string; name?: string; text?: string }) =>
      m.editInfoBlock(args),
    ),
    command('infoBlock.delete', (args: { id: string }) => m.deleteInfoBlock(args.id)),
    // `index`: 0-based among the element's Info Blocks (v1.1 §D).
    command('infoBlock.move', (args: { id: string; index: number }) =>
      m.moveInfoBlock(args.id, args.index),
    ),
    command('infoBlock.open', (args: { id: string }) => m.openInfoBlock(args.id)),
  ];
}
