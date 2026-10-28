/**
 * Adopt (spec §6 Adopt): an existing Foundry doc becomes a Story Element. The doc stays where
 * it is and is Materialized from the start; Silk writes only its link flags to it.
 *
 * - Class inference (`infer.ts`), content (journal pages = Info Blocks, Actor/Item get an
 *   empty Companion Journal), duplicates (already adopted, copied Silk ids,
 *   `_stats.compendiumSource` matching a Ghost), placement (`placement.ts`).
 * - Inferred Connections: only **owns** (embedded Items between Story Elements) and
 *   **present at** (tokens on Event Scenes). A doc players can already see counts as Revealed.
 * - Ad-hoc docs: End Play Session commits and lists the docs created since the last Commit
 *   that aren't Story Elements; each can be adopted or ignored for good.
 *
 * Pure core over the `FoundryDocs` / `SceneDocs` ports plus `AdoptFoundry`.
 */
import type { Command } from '../commands/registry';
import { applyMoves, groupRecord, withElementGroup } from '../canvas/groups';
import {
  check,
  connectionRecord,
  connectionsIn,
  resolveCreateFrom,
  validTypes,
} from '../connections';
import {
  elementClass,
  elementRecord,
  readElement,
  type ElementClassId,
  type ElementData,
  type Point,
  type StoryElement,
} from '../elements';
import type { SceneDocs, SceneSnapshot } from '../event-scenes/port';
import {
  OWNERSHIP_NONE,
  connectionsPage,
  hasCompanion,
  missingLayout,
  playerNotesCategory,
  readSheet,
  sheetId,
  blockPage,
  SORT_STEP,
  type DocSnapshot,
  type FoundryDocs,
  type LayoutContext,
  type LifecycleContributor,
  type Materializer,
  type PageData,
  type SilkDocFlags,
  type SystemMapping,
} from '../materialize';
import type { WorkingCopy } from '../working-copy';
import { QUEST_PAGE, allowedClasses, bulkClass, inferClass, type Inference } from './infer';
import { folderLayout, type FolderNode } from './placement';

/** A sidebar folder and everything in it (docs as uuids). */
export interface AdoptFolder {
  id: string;
  name: string;
  docs: string[];
  children: AdoptFolder[];
}

/** A top-level World doc, as End Play Session looks at it. */
export interface WorldDoc {
  uuid: string;
  name: string;
  documentName: string;
  /** `_stats.createdTime` (ms). */
  createdTime: number;
  flags: { silk?: object };
}

/** What Adopt needs from Foundry beyond the docs ports. */
export interface AdoptFoundry {
  /** A normal Foundry import of a compendium entry into the World; the copy's uuid. */
  importFromCompendium(uuid: string): Promise<string>;
  folder(id: string): AdoptFolder | undefined;
  /** Top-level Actors, Items, Journals and Scenes (no embedded docs, no tokens). */
  worldDocs(): WorldDoc[];
  /** Non-GM user (the party, §8 Audience). */
  isPlayer(userId: string): boolean;
}

export type UseForAnswer = 'use' | 'new' | null;

export interface AdoptDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  scenes: SceneDocs;
  system: SystemMapping;
  newId(): string;
  localize(key: string, data?: Record<string, string>): string;
  materializer: Pick<Materializer, 'sync' | 'materialize'>;
  foundry: AdoptFoundry;
  /** Registry runner (`connection.create` for drops onto a Node). */
  run(name: string, args: object): Promise<unknown>;
  /** After an adopted element got its doc (owns / lifecycle `afterMaterialize`). */
  afterAdopt?(id: string): Promise<void>;
  /** Record what players can already see as Revealed (Revelation Map, §8). */
  markRevealed?(parts: { elements: string[]; infoBlocks: string[] }): Promise<void>;
  /** Canvas viewport centre (canvas coordinates). */
  viewCenter(): Point;
  select?(ids: string[]): Promise<void> | void;
  /** Flash a Node (duplicate Adopt). */
  flash?(id: string): void;
  /** "Use this doc for *element*" or "create new"; `null` cancels. */
  chooseUseFor?(args: { doc: string; element: string }): Promise<UseForAnswer>;
  /** Bulk Adopt: one confirmation listing the docs and their inferred classes. */
  confirmFolder?(rows: { name: string; class: string }[]): Promise<boolean>;
  /** `history.commit`. */
  commit(label?: string): Promise<string>;
  /** When the checked-out head was committed (ms); `null` before the first Commit. */
  lastCommitTime(): Promise<number | null>;
  /** The End Play Session list (Adopt / Ignore per row). */
  showAdHoc?(rows: AdHocDoc[]): void;
}

export interface AdoptDocArgs {
  uuid: string;
  class?: string;
  at?: Point;
  /** Dropped onto this Node: connect it to the new element (§6 Ways in). */
  connectTo?: string;
  /** Inventory item: also adopt its actor (and add owns). */
  alsoAdoptActor?: boolean;
}

export interface AdoptResult {
  id: string;
  name: string;
  /** The doc was a Story Element already: its Node was selected instead. */
  existing?: boolean;
  connectionId?: string;
  /** `alsoAdoptActor`: the actor's element. */
  actorId?: string;
}

export interface AdHocDoc {
  uuid: string;
  name: string;
  documentName: string;
}

/** The doc being adopted, as one shape for Actor/Item/JournalEntry and Scene. */
type Candidate =
  { kind: 'doc'; doc: DocSnapshot } | { kind: 'scene'; scene: SceneSnapshot; uuid: string };

export interface Adopt {
  /** Inference for the UI (class box choices) and the doc's name; undefined if missing. */
  inspect(uuid: string):
    | {
        name: string;
        inference: Inference;
        existing?: string;
        embedded?: { actor: string; actorName: string };
      }
    | undefined;
  adoptDoc(args: AdoptDocArgs): Promise<AdoptResult | null>;
  adoptFolder(args: { folderId: string; confirmed?: boolean }): Promise<{ ids: string[] }>;
  ignore(uuid: string): Promise<void>;
  /** Docs created since the last Commit that aren't Story Elements (§6 Ad-hoc docs). */
  adHoc(): Promise<AdHocDoc[]>;
  endPlaySession(): Promise<{ commit: string; adHoc: AdHocDoc[] }>;
  /** A doc created in Foundry (not by Silk): strip a copied Silk id (§6 Duplicates). */
  docCreated(doc: {
    uuid: string;
    documentName: string;
    flags: { silk?: SilkDocFlags & { sceneOf?: string } };
  }): Promise<void>;
  /** Reconcile: owns for adopted actors' Story Element Items. */
  contributor: LifecycleContributor;
}

const PRESENT = new Set<string>(['person', 'creature']);
const LIMITED = 1;
const OBSERVER = 2;
const INHERIT = -1;
const EMBEDDED_ITEM = /^(Actor\.[^.]+)\.Item\.[^.]+$/;

const sceneIdOf = (uuid: string) => /^Scene\.([^.]+)$/.exec(uuid)?.[1];

/** Players see a doc at `min` or more (`default` or a player's own level). */
export function playersSee(
  ownership: Record<string, number> | undefined,
  isPlayer: (userId: string) => boolean,
  min: number,
): boolean {
  if (!ownership) return false;
  return Object.entries(ownership).some(
    ([id, level]) => level >= min && (id === 'default' || isPlayer(id)),
  );
}

/** Foundry page levels: a user's own level, else `default`; INHERIT falls back to the journal. */
function pageSeen(
  journal: Record<string, number>,
  page: Record<string, number>,
  isPlayer: (userId: string) => boolean,
): boolean {
  const level = (own: Record<string, number>, user: string) => own[user] ?? own['default'] ?? 0;
  const users = [...new Set([...Object.keys(journal), ...Object.keys(page)])].filter(
    (id) => id !== 'default' && isPlayer(id),
  );
  return ['default', ...users].some((user) => {
    const mine = level(page, user);
    return (mine === INHERIT ? level(journal, user) : mine) >= OBSERVER;
  });
}

export function createAdopt(deps: AdoptDeps): Adopt {
  const { docs, scenes, system } = deps;
  const wc = () => deps.workingCopy();
  const ctx: LayoutContext = { system, newId: deps.newId, localize: (k) => deps.localize(k) };
  const element = (id: string | undefined) => (id ? readElement(wc().get(id)) : undefined);
  const elements = () => [...wc().records().values()].flatMap((r) => readElement(r) ?? []);
  const byUuid = (uuid: string) => elements().find((el) => el.uuid === uuid);

  function candidate(uuid: string): Candidate | undefined {
    const sceneId = sceneIdOf(uuid);
    if (sceneId) {
      const scene = scenes.get(sceneId);
      return scene && { kind: 'scene', scene, uuid };
    }
    const doc = docs.get(uuid);
    return doc && { kind: 'doc', doc };
  }

  const nameOf = (c: Candidate) => (c.kind === 'doc' ? c.doc.name : c.scene.name);
  const inferOf = (c: Candidate) =>
    c.kind === 'scene'
      ? inferClass({ documentName: 'Scene' })
      : inferClass({ documentName: c.doc.documentName, type: c.doc.type, pages: c.doc.pages });

  /** The Story Element this doc already is (or the one its Companion / Scene belongs to). */
  function existingOf(c: Candidate): StoryElement | undefined {
    if (c.kind === 'scene') {
      const el = element(c.scene.flags.silk?.sceneOf);
      return el && scenes.scenes().find((s) => s.flags.silk?.sceneOf === el.id)?._id === c.scene._id
        ? el
        : undefined;
    }
    const silk = c.doc.flags.silk;
    const el = element(silk.id);
    if (el?.uuid === c.doc.uuid) return el;
    const owner = element(silk.companionOf);
    const main = owner?.uuid ? docs.get(owner.uuid) : undefined;
    return owner && main?.flags.silk.companion === c.doc._id ? owner : undefined;
  }

  /** A copied Silk id (or other Silk flags) on a doc that is no Story Element. */
  async function stripStale(c: Candidate) {
    if (c.kind === 'scene') {
      if (Object.keys(c.scene.flags.silk ?? {}).length)
        await scenes.update(c.scene._id, { 'flags.-=silk': null });
      return;
    }
    if (Object.keys(c.doc.flags.silk).length) await docs.unflag(c.doc.uuid);
  }

  async function writeElement(id: string, data: ElementData) {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await wc().set([elementRecord(id, clean as unknown as ElementData)]);
  }

  async function join(id: string, at: Point) {
    const changed = applyMoves(wc().records(), [{ id, ...at }]);
    if (changed.length) await wc().set(changed);
  }

  function resolveClass(c: Candidate, wanted: string | undefined): ElementClassId {
    const inference = inferOf(c);
    if ('refused' in inference)
      throw new Error(deps.localize('SILK.Adopt.Refused', { name: nameOf(c) }));
    if (!wanted) return bulkClass(inference) as ElementClassId;
    const allowed =
      c.kind === 'scene'
        ? allowedClasses({ documentName: 'Scene' })
        : allowedClasses({
            documentName: c.doc.documentName,
            type: c.doc.type,
            pages: c.doc.pages,
          });
    const cls = elementClass(wanted)?.id;
    if (!cls || !allowed.includes(cls))
      throw new Error(deps.localize('SILK.Adopt.WrongClass', { name: nameOf(c), class: wanted }));
    return cls;
  }

  /** A Ghost whose snapshot came from the same compendium entry (§6 Duplicates). */
  function ghostFromSource(doc: DocSnapshot, cls: ElementClassId) {
    const source = (doc as { _stats?: { compendiumSource?: unknown } })._stats?.compendiumSource;
    if (typeof source !== 'string' || !source) return undefined;
    const kind = elementClass(cls)?.docKind;
    return elements().find((el) => {
      if (el.uuid || elementClass(el.class)?.docKind !== kind) return false;
      const sheet = readSheet(wc().get(sheetId(el.id)));
      const stats = (sheet?.doc as { _stats?: { compendiumSource?: unknown } } | undefined)?._stats;
      return stats?.compendiumSource === source;
    });
  }

  /** Link flags and layout pieces onto the doc; Actor/Item get their Companion Journal. */
  async function linkDoc(id: string, cls: ElementClassId, doc: DocSnapshot, ghost?: StoryElement) {
    const flags: SilkDocFlags = { id };
    if (hasCompanion(cls)) {
      const folder = await docs.ensureFolder(
        'JournalEntry',
        'companions',
        deps.localize('SILK.Folder.companions'),
      );
      const sheet = ghost ? readSheet(wc().get(sheetId(ghost.id))) : undefined;
      const companionId = deps.newId();
      const connections = connectionsPage(deps.newId(), ctx);
      const notes = playerNotesCategory(deps.newId(), ctx);
      // A Ghost brings its Info Blocks; a fresh Adopt starts empty (no default blocks).
      const blocks: PageData[] = (ghost?.infoBlocks ?? []).map((b, i) =>
        blockPage(b, (i + 1) * SORT_STEP),
      );
      const companion = sheet?.companion
        ? structuredClone(sheet.companion)
        : {
            _id: companionId,
            name: doc.name,
            folder,
            flags: {
              silk: { companionOf: id, connections: connections._id, playerNotes: notes._id },
            },
            pages: [...blocks, connections],
            categories: [notes],
          };
      Object.assign(companion, {
        _id: sheet?.companion?._id ?? companionId,
        name: doc.name,
        folder,
        ownership: { default: OWNERSHIP_NONE },
      });
      companion.flags = { ...companion.flags, silk: { ...companion.flags.silk, companionOf: id } };
      await docs.create('JournalEntry', companion);
      flags.companion = companion._id;
    } else {
      // Journal: the quest is the existing dsaquestlog page; layout pieces only if missing.
      const quest = doc.pages?.find((p) => p.type === QUEST_PAGE);
      const key = Object.keys((quest?.system as { quests?: object } | undefined)?.quests ?? {})[0];
      if (cls === 'quest' && quest && key)
        Object.assign(flags, { quest: quest._id, questKey: key });
      const add = missingLayout(
        { flags: { silk: flags }, pages: doc.pages ?? [], categories: doc.categories ?? [] },
        { class: cls, name: doc.name, img: undefined, status: undefined },
        ctx,
      );
      // No Cover: the journal keeps its own first page (Silk writes as little as possible).
      const cover = add.flags.cover;
      delete add.flags.cover;
      const pages = add.pages.filter((p) => p._id !== cover);
      if (add.categories.length) await docs.createCategories(doc.uuid, add.categories);
      if (pages.length) await docs.createPages(doc.uuid, pages);
      Object.assign(flags, add.flags);
    }
    await docs.update(doc.uuid, { flags: { silk: flags } });
    if (cls === 'quest') await docs.registerQuestJournal(doc.uuid, doc.name);
  }

  /** §8: a doc players can already see counts as Revealed (ownership untouched). */
  async function revealVisible(id: string, doc: DocSnapshot) {
    const ownership = doc.ownership as Record<string, number> | undefined;
    if (!deps.markRevealed || !playersSee(ownership, deps.foundry.isPlayer, LIMITED)) return;
    const infoBlocks =
      doc.documentName === 'JournalEntry'
        ? (element(id)?.infoBlocks ?? [])
            .filter((b) => {
              const page = doc.pages?.find((p) => p._id === b._id);
              return pageSeen(ownership ?? {}, page?.ownership ?? {}, deps.foundry.isPlayer);
            })
            .map((b) => b._id)
        : [];
    await deps.markRevealed({ elements: [id], infoBlocks });
  }

  /** owns for every Story Element Item embedded in a Story Element actor (§6 Connections). */
  async function inferOwns() {
    const all = elements();
    const ownedItems = new Set(
      connectionsIn(wc().records())
        .filter((c) => c.type === 'owns')
        .map((c) => c.to),
    );
    for (const item of all) {
      const actorUuid = item.uuid && EMBEDDED_ITEM.exec(item.uuid)?.[1];
      if (!actorUuid || item.class !== 'item' || ownedItems.has(item.id)) continue;
      const owner = all.find((el) => el.uuid === actorUuid);
      if (!owner || !validTypes(owner.class, 'item').includes('owns')) continue;
      await addConnection(owner.id, item.id, 'owns');
      ownedItems.add(item.id);
    }
  }

  async function addConnection(from: string, to: string, type: 'owns' | 'presentAt') {
    const exists = connectionsIn(wc().records()).some(
      (c) => c.type === type && c.from === from && c.to === to,
    );
    if (exists) return;
    const data = { from, to, type, direction: 'directed' as const, label: '' };
    const result = check(wc().records(), data);
    if (!result.ok) return;
    await wc().set([connectionRecord(deps.newId(), data)]);
    if (result.replaces.length) await wc().delete(result.replaces);
  }

  /** present at from tokens on Event Scenes, for pairs involving `id`. */
  async function inferPresentAt(id: string) {
    const all = elements();
    const actorOf = (actorId: string | null) =>
      all.find((el) => PRESENT.has(el.class) && el.uuid === `Actor.${actorId}`);
    for (const scene of scenes.scenes()) {
      const event = all.find((el) => el.id === scene.flags.silk?.sceneOf);
      if (event?.class !== 'event') continue;
      for (const token of scene.tokens) {
        const actor = actorOf(token.actorId);
        if (actor && (actor.id === id || event.id === id))
          await addConnection(actor.id, event.id, 'presentAt');
      }
    }
  }

  async function adoptScene(
    c: Extract<Candidate, { kind: 'scene' }>,
    cls: ElementClassId,
    at: Point,
  ) {
    const id = deps.newId();
    await writeElement(id, { class: cls, name: c.scene.name, position: at, adopted: true });
    await join(id, at);
    // Link first: the Materialize then finds the Scene instead of generating one.
    await scenes.update(c.scene._id, { 'flags.silk.sceneOf': id });
    if (cls === 'event') await inferPresentAt(id);
    await deps.materializer.materialize([id]);
    return id;
  }

  async function adoptFoundryDoc(
    doc: DocSnapshot,
    cls: ElementClassId,
    at: Point,
    ghost?: StoryElement,
  ) {
    const id = ghost?.id ?? deps.newId();
    await linkDoc(id, cls, doc, ghost);
    const base = ghost ?? { class: cls, name: doc.name, position: at };
    const { id: _drop, ...data } = { id, ...base } as StoryElement;
    void _drop;
    await writeElement(id, { ...data, uuid: doc.uuid, adopted: true, restoredFrom: undefined });
    if (!ghost) await join(id, at);
    await deps.materializer.sync(id);
    await inferOwns();
    if (PRESENT.has(cls)) await inferPresentAt(id);
    await deps.afterAdopt?.(id);
    await revealVisible(id, docs.get(doc.uuid) ?? doc);
    return id;
  }

  /** One doc; `bulk` skips prompts (and the compendium question). */
  async function adoptOne(
    uuid: string,
    wanted: string | undefined,
    at: Point,
    bulk: boolean,
  ): Promise<{ id: string; name: string; existing?: boolean } | null> {
    const c = candidate(uuid);
    if (!c) throw new Error(deps.localize('SILK.Adopt.Missing', { uuid }));
    const existing = existingOf(c);
    if (existing) return { id: existing.id, name: existing.name, existing: true };
    const cls = resolveClass(c, wanted);
    await stripStale(c);
    if (c.kind === 'scene') return { id: await adoptScene(c, cls, at), name: c.scene.name };
    const doc = docs.get(uuid) ?? c.doc;
    const ghost = bulk ? undefined : ghostFromSource(doc, cls);
    if (ghost) {
      const answer = await (deps.chooseUseFor?.({ doc: doc.name, element: ghost.name }) ??
        Promise.resolve<UseForAnswer>('new'));
      if (answer === null) return null;
      if (answer === 'use') {
        const id = await adoptFoundryDoc(doc, ghost.class, at, ghost);
        return { id, name: element(id)?.name ?? doc.name };
      }
    }
    return { id: await adoptFoundryDoc(doc, cls, at), name: doc.name };
  }

  async function adoptDoc(args: AdoptDocArgs): Promise<AdoptResult | null> {
    let uuid = args.uuid;
    if (uuid.startsWith('Compendium.')) uuid = await deps.foundry.importFromCompendium(uuid);
    const at = args.at ?? deps.viewCenter();
    let actorId: string | undefined;
    const actorUuid = EMBEDDED_ITEM.exec(uuid)?.[1];
    if (args.alsoAdoptActor && actorUuid && !byUuid(actorUuid)) {
      const actor = await adoptOne(actorUuid, undefined, { x: at.x - 280, y: at.y }, false);
      actorId = actor?.id;
    }
    const done = await adoptOne(uuid, args.class, at, false);
    if (!done) return null;
    const result: AdoptResult = { ...done, ...(actorId ? { actorId } : {}) };
    if (done.existing) {
      await deps.select?.([done.id]);
      deps.flash?.(done.id);
      return result;
    }
    const origin = element(args.connectTo);
    const created = element(done.id);
    if (origin && created && origin.id !== created.id) {
      const connection = resolveCreateFrom(origin.class, created.class);
      const made = (await deps.run('connection.create', {
        from: origin.id,
        to: created.id,
        ...connection,
      })) as { id: string };
      result.connectionId = made.id;
    }
    return result;
  }

  async function adoptFolder({ folderId, confirmed }: { folderId: string; confirmed?: boolean }) {
    const root = deps.foundry.folder(folderId);
    if (!root) throw new Error(deps.localize('SILK.Adopt.NoFolder'));
    // Rows: what will be adopted (refused docs and Story Elements are skipped).
    const rows: { uuid: string; name: string; class: ElementClassId }[] = [];
    const prune = (folder: AdoptFolder): FolderNode | undefined => {
      const items: string[] = [];
      for (const uuid of folder.docs) {
        const c = candidate(uuid);
        if (!c || existingOf(c)) continue;
        const cls = bulkClass(inferOf(c));
        if (!cls) continue;
        rows.push({ uuid, name: nameOf(c), class: cls });
        items.push(uuid);
      }
      const children = folder.children.flatMap((f) => prune(f) ?? []);
      if (!items.length && !children.length) return undefined;
      return { key: folder.id, label: folder.name, items, children };
    };
    const tree = prune(root);
    if (!tree) return { ids: [] };
    if (!confirmed && deps.confirmFolder) {
      const ok = await deps.confirmFolder(
        rows.map((r) => ({ name: r.name, class: deps.localize(`SILK.Class.${r.class}`) })),
      );
      if (!ok) return { ids: [] };
    }
    const layout = folderLayout(tree, deps.viewCenter());
    const groupIds = new Map(layout.groups.map((g) => [g.key, deps.newId()]));
    await wc().set(
      layout.groups.map((g) =>
        groupRecord({
          id: groupIds.get(g.key) as string,
          label: g.label,
          parent: g.parent ? (groupIds.get(g.parent) ?? null) : null,
          position: g.position,
          size: g.size,
        }),
      ),
    );
    const ids: string[] = [];
    for (const row of rows) {
      const at = layout.positions.get(row.uuid) ?? deps.viewCenter();
      const done = await adoptOne(row.uuid, row.class, at, true);
      if (!done || done.existing) continue;
      ids.push(done.id);
      const record = wc().get(done.id);
      const group = groupIds.get(layout.items.get(row.uuid) ?? '') ?? null;
      if (record)
        await wc().set([
          { ...record, data: withElementGroup({ ...record.data, position: at } as never, group) },
        ]);
    }
    await deps.select?.(ids);
    return { ids };
  }

  async function adHoc(): Promise<AdHocDoc[]> {
    const since = await deps.lastCommitTime();
    const known = new Set(elements().flatMap((el) => el.uuid ?? []));
    return deps.foundry
      .worldDocs()
      .filter((d) => {
        const silk = (d.flags.silk ?? {}) as Record<string, unknown>;
        if (silk['id'] || silk['companionOf'] || silk['sceneOf'] || silk['ignored']) return false;
        if (silk['workingCopy'] || known.has(d.uuid)) return false;
        return since === null || d.createdTime > since;
      })
      .map(({ uuid, name, documentName }) => ({ uuid, name, documentName }));
  }

  async function ignore(uuid: string) {
    const sceneId = sceneIdOf(uuid);
    if (sceneId) await scenes.update(sceneId, { 'flags.silk.ignored': true });
    else await docs.update(uuid, { 'flags.silk.ignored': true });
  }

  const contributor: LifecycleContributor = {
    reconcile: () => inferOwns(),
  };

  return {
    inspect(uuid) {
      const c = uuid.startsWith('Compendium.') ? undefined : candidate(uuid);
      if (!c) return undefined;
      const existing = existingOf(c)?.id;
      const actorUuid = EMBEDDED_ITEM.exec(uuid)?.[1];
      const actor = actorUuid && !byUuid(actorUuid) ? docs.get(actorUuid) : undefined;
      return {
        name: nameOf(c),
        inference: inferOf(c),
        ...(existing ? { existing } : {}),
        ...(actor && actorUuid ? { embedded: { actor: actorUuid, actorName: actor.name } } : {}),
      };
    },
    adoptDoc,
    adoptFolder,
    ignore,
    adHoc,
    async endPlaySession() {
      const rows = await adHoc();
      const commit = await deps.commit(deps.localize('SILK.Adopt.EndPlaySessionLabel'));
      if (rows.length) deps.showAdHoc?.(rows);
      return { commit, adHoc: rows };
    },
    async docCreated(doc) {
      const silk = doc.flags.silk ?? {};
      if (doc.documentName === 'Scene') {
        const sceneId = sceneIdOf(doc.uuid);
        const owner = silk.sceneOf;
        const original = scenes
          .scenes()
          .find((s) => s._id !== sceneId && s.flags.silk?.sceneOf === owner);
        if (sceneId && owner && original) await scenes.update(sceneId, { 'flags.-=silk': null });
        return;
      }
      if (!silk.id && !silk.companionOf) return;
      const c = candidate(doc.uuid);
      if (c && !existingOf(c)) await docs.unflag(doc.uuid);
    },
    contributor,
  };
}

/** Commands (spec §15 "Materialize / Adopt", "History"). GM only. */
export function adoptCommands(adopt: Adopt): Command[] {
  const gm = (ctx: { isGM: boolean }) => ctx.isGM;
  return [
    {
      name: 'adopt.doc',
      title: 'SILK.Commands.adopt.doc',
      available: gm,
      run: (args: AdoptDocArgs) => adopt.adoptDoc(args),
    },
    {
      name: 'adopt.folder',
      title: 'SILK.Commands.adopt.folder',
      available: gm,
      run: (args: { folderId: string; confirmed?: boolean }) => adopt.adoptFolder(args),
    },
    {
      name: 'adopt.ignore',
      title: 'SILK.Commands.adopt.ignore',
      available: gm,
      run: (args: { uuid: string }) => adopt.ignore(args.uuid),
    },
    {
      name: 'history.endPlaySession',
      title: 'SILK.Commands.history.endPlaySession',
      available: gm,
      run: () => adopt.endPlaySession(),
    },
  ] as Command[];
}
