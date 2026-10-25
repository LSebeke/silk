/**
 * Reveal (spec §8). Truth is ownership in the World; it is mirrored in two places:
 * - the checked-out Campaign's Revelation Map (§11.5), written on every Reveal/un-reveal;
 * - the World's reveal state (world setting `revealState`): the map last applied here.
 *   It answers "is this Revealed?" synchronously (eye toggles, Connections pages) and
 *   stays as the last Adventure left it under the main Checkout (§8). Player View (T17)
 *   derives from it.
 *
 * Checkout and Materialize apply the map to ownership; reconcile on load reads ownership
 * back into the map ("ownership wins") and repairs derived ownership. Pure core over the
 * `FoundryDocs` port; tokens and the Show popup go through `RevealStage`.
 */
import type { Command } from '../commands/registry';
import {
  isRevealed,
  setRevealed,
  type RevealKind,
  type RevelationMap,
} from '../campaigns';
import { connectionsIn } from '../connections/rules';
import { readElement, type StoryElement } from '../elements';
import { blockJournal, infoBlockPages } from '../materialize/layout';
import type { Materializer } from '../materialize/materializer';
import type { DocSnapshot, FoundryDocs, SystemMapping } from '../materialize/port';
import type { WorkingCopy } from '../working-copy';
import { OWNERSHIP, hasAppearance, isHooded, ownershipWrites, type RevealWrite } from './ownership';
import { applyReveal, touchedElements, type RevealGraph, type RevealTarget } from './rules';

/** Foundry effects outside the docs port. */
export interface RevealStage {
  /** Updates every placed token of the actor (all Scenes) where it differs. */
  updateTokens(actorUuid: string, data: Record<string, unknown>): Promise<void>;
  /** Forced `Journal.show` of a journal/page (`uuid`), or a shared image. */
  show(target: { uuid?: string; image?: string; title?: string }): Promise<void>;
}

export interface RevealDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  materializer: Pick<Materializer, 'docsOf' | 'ensureMaterialized'>;
  system: SystemMapping;
  /** The checked-out Campaign's map (`null` id under main or unbound). */
  campaign: {
    current(): Promise<string | null>;
    read(id: string): Promise<RevelationMap>;
    write(id: string, map: RevelationMap): Promise<void>;
  };
  /** World setting `revealState`. */
  world: { get(): RevelationMap; set(map: RevelationMap): Promise<void> };
  /** An Adventure is checked out (sync, for command availability). */
  adventure(): boolean;
  /** World setting `hoodedImage`. */
  hood(): string;
  stage: RevealStage;
  localize(key: string): string;
  /** Rewrite these elements' Connections pages (they list Revealed sentences only). */
  refreshPages(ids: readonly string[]): Promise<void>;
}

export interface Reveal {
  /** Reveal commands need a checked-out Adventure (§8 "Under the main Checkout"). */
  available(): boolean;
  /** `reveal.element/appearance/infoBlock/connection`. */
  set(kind: RevealTarget, id: string, revealed: boolean): Promise<void>;
  /** `reveal.showToPlayers`: Reveal if needed + forced Show. `id` = element or Info Block. */
  showToPlayers(id: string): Promise<void>;
  /** The World's reveal state (sync). */
  isRevealed(kind: RevealKind, id: string): boolean;
  state(): RevelationMap;
  /** Svelte-store shape: called now and on every reveal state change. */
  subscribe(fn: (state: RevelationMap) => void): () => void;
  /** The world setting changed elsewhere (another GM). */
  reload(): void;
  /** Checkout of an Adventure: `map` becomes World ownership (session seam). */
  applyMap(map: RevelationMap): Promise<void>;
  /** After a Materialize: the element's docs get its ownership. */
  afterMaterialize(id: string): Promise<void>;
  /** Re-apply one element (a Foundry-side edit undid the hood). */
  repair(id: string): Promise<void>;
  /** Reconcile on load (lifecycle contributor). */
  reconcile(): Promise<void>;
}

export function createReveal(deps: RevealDeps): Reveal {
  const listeners = new Set<(state: RevelationMap) => void>();
  let state = deps.world.get();
  /** Reveal writes run one at a time. */
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job);
    queue = next.catch(() => {});
    return next;
  };

  const records = () => deps.workingCopy().records();
  const read = (id: string) => readElement(records().get(id));
  const notify = () => {
    for (const fn of listeners) fn(state);
  };

  function graph(): RevealGraph {
    const recs = records();
    const connections = connectionsIn(recs);
    const appearanceName = deps.localize('SILK.InfoBlock.Appearance');
    const blocks = (id: string) => readElement(recs.get(id))?.infoBlocks ?? [];
    return {
      elementOfBlock(id) {
        for (const r of recs.values()) {
          const el = readElement(r);
          if (el?.infoBlocks?.some((b) => b._id === id)) return el.id;
        }
        return undefined;
      },
      endsOf(id) {
        const c = connections.find((x) => x.id === id);
        return c ? [c.from, c.to] : undefined;
      },
      blocksOf: (id) => blocks(id).map((b) => b._id),
      connectionsOf: (id) =>
        connections.filter((c) => c.from === id || c.to === id).map((c) => c.id),
      appearanceBlock(id) {
        const el = readElement(recs.get(id));
        if (!el || !hasAppearance(el.class)) return undefined;
        return el.infoBlocks?.find((b) => b.name === appearanceName)?._id;
      },
      hasAppearance: (id) => hasAppearance(readElement(recs.get(id))?.class ?? ''),
    };
  }

  function revealedConnections(map: RevelationMap, id: string) {
    return connectionsIn(records()).filter(
      (c) => (c.from === id || c.to === id) && isRevealed(map, 'connection', c.id),
    ).length;
  }

  async function write(w: RevealWrite) {
    if (w.op === 'update') await deps.docs.update(w.uuid, w.data);
    else if (w.op === 'page') await deps.docs.updatePage(w.uuid, w.pageId, w.data);
    else await deps.stage.updateTokens(w.uuid, w.data);
  }

  /** Makes the element's docs match `map`. */
  async function applyOne(el: StoryElement, map: RevelationMap) {
    const found = deps.materializer.docsOf(el.id);
    if (!found) return;
    const writes = ownershipWrites({
      element: el,
      main: found.main,
      ...(found.companion ? { companion: found.companion } : {}),
      map,
      revealedConnections: revealedConnections(map, el.id),
      hood: deps.hood(),
      system: deps.system,
    });
    for (const w of writes) await write(w);
  }

  async function setWorld(map: RevelationMap) {
    if (JSON.stringify(map) === JSON.stringify(state)) return;
    state = map;
    await deps.world.set(map);
    notify();
  }

  async function applyTo(ids: readonly string[], map: RevelationMap) {
    for (const id of ids) {
      const el = read(id);
      if (el) await applyOne(el, map);
    }
    if (ids.length) await deps.refreshPages(ids);
  }

  async function requireCampaign() {
    const id = deps.adventure() ? await deps.campaign.current() : null;
    if (!id) throw new Error('Silk: start an Adventure to Reveal');
    return id;
  }

  /** Elements that must be Materialized before `kind`/`id` can be Revealed. */
  function elementsOf(kind: RevealTarget, id: string, g: RevealGraph): string[] {
    if (kind === 'connection') return [...(g.endsOf(id) ?? [])];
    if (kind === 'infoBlock') return [g.elementOfBlock(id) ?? []].flat();
    return [id];
  }

  async function set(kind: RevealTarget, id: string, revealed: boolean) {
    const campaign = await requireCampaign();
    let g = graph();
    const owners = elementsOf(kind, id, g);
    if (!owners.length || owners.some((o) => !read(o)))
      throw new Error(`Silk: nothing to Reveal for "${id}"`);
    // Only Materialized elements can be Revealed: a Ghost is Materialized first (§8).
    if (revealed) {
      let materialized = false;
      for (const o of owners)
        if (!read(o)?.uuid) {
          await deps.materializer.ensureMaterialized(o);
          materialized = true;
        }
      if (materialized) g = graph(); // Info Block ids are page ids now.
    }
    const before = await deps.campaign.read(campaign);
    const after = applyReveal(before, kind, id, revealed, g);
    await deps.campaign.write(campaign, after);
    // The World's state: what was applied here, plus this change.
    const world = applyReveal(state, kind, id, revealed, g);
    await setWorld(world);
    await applyTo(touchedElements(before, after, g).concat(owners), world);
  }

  /** Reconcile: ownership → reveal state, for Materialized elements (§8 "ownership wins"). */
  function fromOwnership(prev: RevelationMap): RevelationMap {
    let map = prev;
    const g = graph();
    for (const r of records().values()) {
      const el = readElement(r);
      const found = el?.uuid ? deps.materializer.docsOf(el.id) : undefined;
      if (!el || !found) continue;
      const level = found.main.ownership?.default ?? OWNERSHIP.NONE;
      const revealed = level >= OWNERSHIP.LIMITED;
      map = setRevealed(map, 'element', el.id, revealed);
      const holder = blockJournal(found.main, found.companion);
      const pages = new Map((holder?.pages ?? []).map((p) => [p._id, p]));
      for (const b of holder ? infoBlockPages(holder) : [])
        map = setRevealed(
          map,
          'infoBlock',
          b._id,
          revealed && (pages.get(b._id)?.ownership?.default ?? 0) >= OWNERSHIP.OBSERVER,
        );
      if (g.hasAppearance(el.id))
        map = setRevealed(map, 'appearance', el.id, revealed && !isHooded(found.main));
    }
    // A Revealed Connection needs both ends Revealed.
    for (const c of map.connections) {
      const ends = g.endsOf(c);
      if (!ends || ends.some((e) => !isRevealed(map, 'element', e)))
        map = setRevealed(map, 'connection', c, false);
    }
    return map;
  }

  async function applyAll(map: RevelationMap) {
    const ids: string[] = [];
    for (const r of records().values()) {
      const el = readElement(r);
      if (el?.uuid) ids.push(el.id);
    }
    await applyTo(ids, map);
  }

  async function showToPlayers(id: string) {
    const g = graph();
    const blockOwner = read(id) ? undefined : g.elementOfBlock(id);
    const elementId = blockOwner ?? id;
    if (!read(elementId)) throw new Error(`Silk: nothing to show for "${id}"`);
    if (blockOwner) {
      if (!isRevealed(state, 'infoBlock', id)) await set('infoBlock', id, true);
    } else if (!isRevealed(state, 'element', id)) await set('element', id, true);
    const el = read(elementId) as StoryElement;
    const found = deps.materializer.docsOf(elementId);
    if (!found) return;
    const holder = blockJournal(found.main, found.companion);
    if (blockOwner && holder) {
      await deps.stage.show({ uuid: `${holder.uuid}.JournalEntryPage.${id}` });
      return;
    }
    if (found.main.documentName === 'JournalEntry') {
      await deps.stage.show({ uuid: found.main.uuid });
      return;
    }
    const companionOpen =
      found.companion &&
      (deps.docs.get(found.companion.uuid)?.ownership?.default ?? 0) >= OWNERSHIP.OBSERVER;
    if (companionOpen && found.companion) await deps.stage.show({ uuid: found.companion.uuid });
    else {
      const main = deps.docs.get(found.main.uuid) as DocSnapshot;
      await deps.stage.show({ image: main.img ?? '', title: el.name });
    }
  }

  return {
    available: () => deps.adventure(),
    set: (kind, id, revealed) => serial(() => set(kind, id, revealed)),
    showToPlayers: (id) => serial(() => showToPlayers(id)),
    isRevealed: (kind, id) => isRevealed(state, kind, id),
    state: () => state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => void listeners.delete(fn);
    },
    reload() {
      const next = deps.world.get();
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      notify();
    },
    applyMap: (map) =>
      serial(async () => {
        await setWorld(map);
        await applyAll(map);
      }),
    // Not queued: a Reveal of a Ghost Materializes it from inside the queue.
    async afterMaterialize(id) {
      const el = read(id);
      if (el) await applyOne(el, state);
    },
    async repair(id) {
      const el = read(id);
      if (el) await applyOne(el, state);
    },
    reconcile: () =>
      serial(async () => {
        const map = fromOwnership(state);
        const campaign = deps.adventure() ? await deps.campaign.current() : null;
        if (campaign) {
          const stored = await deps.campaign.read(campaign);
          // Ghosts keep their map entries; Materialized elements follow ownership.
          const merged = fromOwnership(stored);
          if (JSON.stringify(merged) !== JSON.stringify(stored))
            await deps.campaign.write(campaign, merged);
          await setWorld(merged);
          await applyAll(merged);
          return;
        }
        await setWorld(map);
        await applyAll(map);
      }),
  };
}

/** Commands (spec §15 "Reveal"). GM only, and only with an Adventure checked out. */
export function revealCommands(reveal: Reveal): Command[] {
  const available = (ctx: { isGM: boolean }) => ctx.isGM && reveal.available();
  const target = (kind: RevealTarget): Command<{ id: string; revealed?: boolean }> => ({
    name: `reveal.${kind}`,
    title: `SILK.Commands.reveal.${kind}`,
    available,
    run: ({ id, revealed = true }) => reveal.set(kind, id, revealed),
  });
  return [
    target('element'),
    target('appearance'),
    target('infoBlock'),
    target('connection'),
    {
      name: 'reveal.showToPlayers',
      title: 'SILK.Commands.reveal.showToPlayers',
      available,
      run: ({ id }: { id: string }) => reveal.showToPlayers(id),
    },
  ];
}

