/**
 * What Materialize needs from Foundry (spec §6, §7), as plain data. The adapter implements
 * it with real documents (`src/adapter/foundry-docs.ts`), tests with `createMemoryDocs`.
 * Decisions (which docs, pages, fields) live in the core; the port only executes them.
 */
import type { ElementClassId } from '../elements';

export type DocumentName = 'Actor' | 'Item' | 'JournalEntry';

/** `flags.silk` on Silk's docs. Ids only (spec §2). */
export interface SilkDocFlags {
  /** Story Element id, on the element's doc. */
  id?: string;
  /** On an Actor/Item: its Companion Journal's id. */
  companion?: string;
  /** On a Companion Journal: the Story Element id it belongs to. */
  companionOf?: string;
  /** Journal layout page/category ids (§4). */
  cover?: string;
  connections?: string;
  playerNotes?: string;
  /** Quest: the `dsaquestlog` page and the quest's key in it. */
  quest?: string;
  questKey?: string;
  /** Event / Location journal: its Event Scene's (Overview Scene's) id (T13). */
  scene?: string;
  /** On a folder: which Silk folder it is (an Element Class id or `companions`). */
  folder?: string;
  /**
   * Person/Creature until Appearance is Revealed (§8): `img` and the prototype token show
   * `hood`; the real image and token texture wait here.
   */
  img?: string;
  token?: string;
  hood?: string;
  /**
   * The real token position and scale (v1.1 §G.3), when not centred; the token itself shows
   * the hood centred, or the pose baked into the subject file.
   */
  pose?: { anchorX: number; anchorY: number; scale: number };
  /**
   * The subject file Silk wrote to `ring.subject.texture` (v1.1 §G.3) and what it was
   * rendered from: image, pose and the ring style's edges (a changed style rebuilds it).
   */
  subject?: {
    file: string;
    src: string;
    pose: { anchorX: number; anchorY: number; scale: number };
    edges: { inner: number; outer: number };
  };
  /**
   * An imported actor's look as it came in (Adopt, Compendium pick, NSC Zucht; v1.1 §G.3.1,
   * a fifth exception to v1 §2): `img`, the prototype's `texture` and `ring`.
   */
  original?: { img?: string; texture: Record<string, unknown>; ring: Record<string, unknown> };
  /**
   * What showing the hood overwrote on the prototype (v1.1 §G.3.1): Reveal writes it back
   * exactly. Dropped by a token edit while hooded (the real look is then Silk's).
   */
  unhooded?: {
    texture: { fit: string; anchorX: number; anchorY: number };
    subject: { scale: number; texture: string | null };
    pose?: { anchorX: number; anchorY: number; scale: number };
    silkSubject?: SilkDocFlags['subject'];
  };
  /** On a Player Note page: its authoring Campaign (§9). */
  campaign?: string;
  /** On an Info Block page: it is the Appearance block (v1.1 §C.2). */
  appearance?: boolean;
}

export const OWNERSHIP_NONE = 0;

export interface PageData {
  _id: string;
  name: string;
  type: 'text' | 'image' | string;
  sort: number;
  /** Explicit player ownership (spec §8 "Defaults": NONE, not INHERIT). */
  ownership: { default: number };
  src?: string | null;
  text?: { content: string };
  system?: object;
  category?: string | null;
  flags?: { silk?: SilkDocFlags };
}

export interface CategoryData {
  _id: string;
  name: string;
  sort: number;
}

/** Create data, and what `get` returns (plus `uuid`). */
export interface DocData {
  _id: string;
  name: string;
  /** Actor/Item subtype. */
  type?: string;
  img?: string;
  folder: string | null;
  system?: Record<string, unknown>;
  ownership?: { default: number };
  flags: { silk: SilkDocFlags };
  pages?: PageData[];
  categories?: CategoryData[];
  /** Actor: its inventory (embedded Items), as Foundry's source data has it. */
  items?: (DocData & { _id: string })[];
  /** Actor ActiveEffects (read-only here): their status ids carry the Dead condition (§7). */
  effects?: { statuses?: string[] }[];
}

export interface DocSnapshot extends DocData {
  uuid: string;
  documentName: DocumentName;
  /** Embedded docs (an Item in an inventory): the parent doc's uuid. */
  parent?: string;
}

/**
 * A compendium entry as a normal Foundry import prepares it (`fromCompendium`): no `_id`,
 * folder, sort or ownership; foreign flags and `_stats.compendiumSource` kept.
 */
export interface ImportData {
  name: string;
  type?: string;
  img?: string;
  system?: Record<string, unknown>;
  items?: (DocData & { _id: string })[];
  flags?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Silk folder identity: per Element Class plus "Silk Companions" (§8). */
export type FolderKey = ElementClassId | 'companions';

export interface FoundryDocs {
  /** Id of Silk's folder for `key` in the `type` sidebar, created if missing. */
  ensureFolder(type: DocumentName, key: FolderKey, name: string): Promise<string>;
  /**
   * Creates with the given `_id`s (doc and embedded). Returns the doc uuid. With `parent`
   * (an Actor uuid) the Item is created in that actor's inventory (§5 owns).
   */
  create(documentName: DocumentName, data: DocData, parent?: string): Promise<string>;
  /** Deletes a doc (world or embedded). */
  delete(uuid: string): Promise<void>;
  get(uuid: string): DocSnapshot | undefined;
  /** A compendium entry's import data (spec 1.1 §B.1 Ghost worlds); undefined if it is gone. */
  importData(uuid: string): Promise<ImportData | undefined>;
  /** By world doc id (Companion Journals are linked by id). */
  journal(id: string): DocSnapshot | undefined;
  /** Foundry update data; dotted keys allowed. */
  update(uuid: string, data: Record<string, unknown>): Promise<void>;
  /** Changes an Actor/Item subtype, replacing its system data (Foundry requires that). */
  changeType(uuid: string, type: string, system: Record<string, unknown>): Promise<void>;
  createPages(uuid: string, pages: PageData[]): Promise<void>;
  createCategories(uuid: string, categories: CategoryData[]): Promise<void>;
  updatePage(uuid: string, pageId: string, data: Record<string, unknown>): Promise<void>;
  deletePages(uuid: string, pageIds: string[]): Promise<void>;
  /** Adds or removes an Actor status effect (condition), e.g. DSA5 `dead`. No-op if already so. */
  setStatusEffect(uuid: string, statusId: string, active: boolean): Promise<void>;
  /** Registers a quest journal in the Game System's quest log (DSA5 `questlogJournals`). */
  registerQuestJournal(uuid: string, name: string): Promise<void>;
  /** Removes `flags.silk` from the doc (element delete, Keep Foundry doc, §6). */
  unflag(uuid: string): Promise<void>;
  /** Opens the doc's sheet; a journal at page `pageId` if given. */
  open(uuid: string, pageId?: string): Promise<void>;
}

/** Game System (DSA5) field mapping, hand-written in the adapter (spec §2). Pure. */
export interface SystemMapping {
  /** Actor/Item subtype Silk creates for a class; undefined for journals. */
  docType(cls: ElementClassId): string | undefined;
  /** Class fields → `system` create/replace data. */
  toSystem(cls: ElementClassId, fields: Record<string, unknown>): Record<string, unknown>;
  /** Class fields → dotted `system.*` update data. */
  systemUpdate(cls: ElementClassId, fields: Record<string, unknown>): Record<string, unknown>;
  /** The doc's system data → class fields (only those the class has). */
  fromSystem(cls: ElementClassId, system: unknown): Record<string, unknown>;
  /** The one-quest `dsaquestlog` page (§4 Quest). `status`: 0 open / 1 done / 2 failed. */
  questPage(questKey: string, title: string, status?: number): { type: string; system: object };
  /** The quest's status (0/1/2) in its page's system data. */
  questStatus(questKey: string, pageSystem: unknown): number | undefined;
  /** Update data setting the quest status on its page. */
  questStatusUpdate(questKey: string, status: number): Record<string, unknown>;
  /** The Actor status effect id meaning dead (§7 Dead). */
  deadEffect: string;
  /**
   * The token texture scale the system gives an actor of this `system` data (its size
   * factor, v1.1 §G.3 #168); 1 when it gives none.
   */
  sizeFactor(system: unknown): number;
  /** Update data setting the quest title on its page. */
  questTitleUpdate(questKey: string, title: string): Record<string, unknown>;
  /**
   * Update data making the quest's `visible` and its `linkedPages` (one per Info Block,
   * `visible` = the block's Reveal) match (§4 Quest, §8). Empty when they already do.
   */
  questVisibility(
    questKey: string,
    pageSystem: unknown,
    visible: boolean,
    blocks: readonly { id: string; uuid: string; visible: boolean; sort: number }[],
  ): Record<string, unknown>;
}
