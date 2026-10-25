/**
 * Which Foundry docs, pages and fields a Story Element maps to (spec §4), both ways:
 * `planDocs` (element → create data) and `readBack` (docs → element fields). Pure.
 */
import { elementClass, type ElementClassId } from '../elements/classes';
import type { ElementData, InfoBlock, StoryElement } from '../elements/element';
import {
  OWNERSHIP_NONE,
  type CategoryData,
  type DocData,
  type DocSnapshot,
  type DocumentName,
  type PageData,
  type SystemMapping,
} from './port';

/** Default Info Blocks per class (§4). Names are `SILK.InfoBlock.<name>` keys. */
export const DEFAULT_INFO_BLOCKS: Record<ElementClassId, readonly string[]> = {
  person: ['Appearance', 'Personality', 'Secrets'],
  creature: ['Appearance', 'Description'],
  playerCharacter: ['Description'],
  location: ['Description', 'Secrets'],
  faction: ['Overview', 'Secrets'],
  item: ['Description', 'Secrets'],
  event: ['Setup', 'Outcome'],
  quest: ['Hook', 'Resolution'],
  note: ['Description'],
};

/** Page sort: Cover first, Info Blocks in steps, Connections last (§4 Journal layout). */
export const SORT_STEP = 100_000;
export const CONNECTIONS_SORT = 1_000_000_000;

const NONE = { default: OWNERSHIP_NONE };

export interface LayoutContext {
  system: SystemMapping;
  newId(): string;
  localize(key: string): string;
}

export function defaultInfoBlocks(cls: ElementClassId, ctx: LayoutContext): InfoBlock[] {
  return DEFAULT_INFO_BLOCKS[cls].map((name) => ({
    _id: ctx.newId(),
    name: ctx.localize(`SILK.InfoBlock.${name}`),
    text: '',
  }));
}

export function documentName(cls: ElementClassId): DocumentName {
  const kind = elementClass(cls)?.docKind;
  return kind === 'actor' ? 'Actor' : kind === 'item' ? 'Item' : 'JournalEntry';
}

/** Journal classes except Note get Cover, Connections page and Player Notes category. */
export const hasJournalLayout = (cls: ElementClassId) =>
  documentName(cls) === 'JournalEntry' && cls !== 'note';

/** Actor/Item elements keep their Info Blocks in a Companion Journal. */
export const hasCompanion = (cls: ElementClassId) => documentName(cls) !== 'JournalEntry';

export const blockPage = (block: InfoBlock, sort: number): PageData => ({
  _id: block._id,
  name: block.name,
  type: 'text',
  sort,
  ownership: { ...NONE },
  text: { content: block.text },
});

export function coverPage(id: string, src: string | undefined, ctx: LayoutContext): PageData {
  return {
    _id: id,
    name: ctx.localize('SILK.Layout.Cover'),
    type: 'image',
    sort: 0,
    ownership: { ...NONE },
    src: src ?? null,
  };
}

/** Empty until `createConnectionsPages` writes the sentences (§5 In journals). */
export function connectionsPage(id: string, ctx: LayoutContext): PageData {
  return {
    _id: id,
    name: ctx.localize('SILK.Layout.Connections'),
    type: 'text',
    sort: CONNECTIONS_SORT,
    ownership: { ...NONE },
    text: { content: '' },
  };
}

export const playerNotesCategory = (id: string, ctx: LayoutContext): CategoryData => ({
  _id: id,
  name: ctx.localize('SILK.Layout.PlayerNotes'),
  sort: 0,
});

export function questPage(id: string, questKey: string, title: string, ctx: LayoutContext) {
  const { type, system } = ctx.system.questPage(questKey, title);
  return {
    _id: id,
    name: title,
    type,
    sort: 1,
    ownership: { ...NONE },
    system,
  } satisfies PageData;
}

export interface DocPlan {
  documentName: DocumentName;
  main: DocData;
  /** Actor/Item: its Companion Journal. */
  companion?: DocData;
}

/**
 * Create data for an element's docs. `folders` are Silk's sidebar folders (§8): the
 * class folder and, for Actor/Item elements, "Silk Companions".
 */
export function planDocs(
  element: StoryElement,
  folders: { main: string; companion?: string },
  ctx: LayoutContext,
): DocPlan {
  const cls = element.class;
  const name = documentName(cls);
  const blocks = element.infoBlocks ?? defaultInfoBlocks(cls, ctx);
  const blockPages = blocks.map((b, i) => blockPage(b, (i + 1) * SORT_STEP));

  if (name !== 'JournalEntry') {
    const companionId = ctx.newId();
    const connections = connectionsPage(ctx.newId(), ctx);
    const notes = playerNotesCategory(ctx.newId(), ctx);
    const main: DocData = {
      _id: ctx.newId(),
      name: element.name,
      folder: folders.main,
      ownership: { ...NONE },
      system: ctx.system.toSystem(cls, { ...element.fields }),
      flags: { silk: { id: element.id, companion: companionId } },
    };
    const type = ctx.system.docType(cls);
    if (type) main.type = type;
    if (element.img) main.img = element.img;
    return {
      documentName: name,
      main,
      companion: {
        _id: companionId,
        name: element.name,
        folder: folders.companion ?? null,
        ownership: { ...NONE },
        flags: {
          silk: { companionOf: element.id, connections: connections._id, playerNotes: notes._id },
        },
        pages: [...blockPages, connections],
        categories: [notes],
      },
    };
  }

  const main: DocData = {
    _id: ctx.newId(),
    name: element.name,
    folder: folders.main,
    ownership: { ...NONE },
    flags: { silk: { id: element.id } },
    pages: blockPages,
  };
  if (hasJournalLayout(cls)) addJournalLayout(main, element, ctx);
  return { documentName: name, main };
}

/** Adds what a layout class needs and the journal lacks (create or class change). */
export function missingLayout(
  journal: Pick<DocData, 'flags' | 'pages' | 'categories'>,
  element: Pick<ElementData, 'class' | 'name' | 'img'>,
  ctx: LayoutContext,
): { pages: PageData[]; categories: CategoryData[]; flags: DocData['flags']['silk'] } {
  const flags = journal.flags.silk;
  const has = (id: string | undefined) => !!id && !!journal.pages?.some((p) => p._id === id);
  const pages: PageData[] = [];
  const categories: CategoryData[] = [];
  const added: DocData['flags']['silk'] = {};
  if (hasJournalLayout(element.class)) {
    if (!has(flags.cover)) {
      const cover = coverPage(ctx.newId(), element.img, ctx);
      pages.push(cover);
      added.cover = cover._id;
    }
    if (!has(flags.connections)) {
      const connections = connectionsPage(ctx.newId(), ctx);
      pages.push(connections);
      added.connections = connections._id;
    }
    if (!flags.playerNotes || !journal.categories?.some((c) => c._id === flags.playerNotes)) {
      const notes = playerNotesCategory(ctx.newId(), ctx);
      categories.push(notes);
      added.playerNotes = notes._id;
    }
  }
  if (element.class === 'quest' && !has(flags.quest)) {
    const key = ctx.newId();
    const quest = questPage(ctx.newId(), key, element.name, ctx);
    pages.push(quest);
    added.quest = quest._id;
    added.questKey = key;
  }
  return { pages, categories, flags: added };
}

function addJournalLayout(main: DocData, element: StoryElement, ctx: LayoutContext) {
  const { pages, categories, flags } = missingLayout(main, element, ctx);
  main.pages = [...(main.pages ?? []), ...pages];
  main.categories = categories;
  main.flags.silk = { ...main.flags.silk, ...flags };
}

/** Pages that are Info Blocks: text pages that aren't Silk layout or Player Notes. */
export function infoBlockPages(journal: DocSnapshot): PageData[] {
  const flags = journal.flags.silk;
  const layout = new Set([flags.cover, flags.connections, flags.quest]);
  return (journal.pages ?? [])
    .filter(
      (p) =>
        p.type === 'text' &&
        !layout.has(p._id) &&
        (!flags.playerNotes || p.category !== flags.playerNotes),
    )
    .sort((a, b) => a.sort - b.sort);
}

/** The journal holding the element's Info Blocks: itself, or its Companion Journal. */
export const blockJournal = (main: DocSnapshot, companion: DocSnapshot | undefined) =>
  main.documentName === 'JournalEntry' ? main : companion;

/**
 * Element fields as Foundry has them (spec §7: the doc is truth once Materialized).
 * A key present with `undefined` means "the docs own it and it is empty". Fields the docs
 * don't hold (a Note's image, Info Blocks without a Companion Journal) are left out.
 */
export function readBack(
  cls: ElementClassId,
  main: DocSnapshot,
  companion: DocSnapshot | undefined,
  system: SystemMapping,
): Partial<ElementData> {
  const out: Partial<ElementData> = { name: main.name };
  if (main.documentName !== 'JournalEntry') {
    out.img = main.img || undefined;
    const fields = system.fromSystem(cls, main.system);
    out.fields = Object.keys(fields).length ? fields : undefined;
  } else if (main.flags.silk.cover) {
    const cover = main.pages?.find((p) => p._id === main.flags.silk.cover);
    out.img = cover?.src || undefined;
  }
  const holder = blockJournal(main, companion);
  if (holder)
    out.infoBlocks = infoBlockPages(holder).map((p) => ({
      _id: p._id,
      name: p.name,
      text: p.text?.content ?? '',
    }));
  return out;
}
