/**
 * owns ↔ inventory (spec §5 owns, §6 implicit Materialize, §7 owns).
 *
 * - Placement: an Item owned by a Materialized actor Materializes embedded in that actor's
 *   inventory; that embedded copy *is* the Item's doc. Unowned → world Item.
 * - Silk-driven changes (Connection commands, Materialize) move the doc to its placement.
 * - Foundry-driven changes (hooks) move the Connection instead: the Silk id follows the
 *   Item only when the original doc is deleted in the process (a move between actors).
 *   Copies get no Silk id. When the doc leaves its actor otherwise, owns is deleted.
 *
 * Pure core over the `FoundryDocs` port.
 */
import type { Command } from '../commands/registry';
import { check, connectionRecord, connectionsIn, validTypes } from '../connections';
import {
  elementClass,
  elementRecord,
  readElement,
  type ElementData,
  type StoryElement,
} from '../elements';
import {
  documentName,
  type DocData,
  type DocSnapshot,
  type FoundryDocs,
  type MaterializeMode,
  type Materializer,
} from '../materialize';
import type { WorkingCopy } from '../working-copy';

export interface OwnsDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  materializer: Pick<Materializer, 'ensureMaterialized' | 'elementIdOf'>;
  mode(): MaterializeMode;
  /** True while the Creation Pipeline is in its class box: implicit Materialize waits. */
  deferImmediate?(): boolean;
  newId(): string;
  /** Milliseconds; pairs a copy with the original's deletion (a move). */
  now(): number;
  localize(key: string): string;
}

export interface Owns {
  /** Materializer `parentOf`: the owner's Actor uuid if it is Materialized, else world. */
  parentOf(itemId: string): string | undefined;
  /** Materializer `afterMaterialize`: a new actor takes in its Materialized Items. */
  afterMaterialize(id: string): Promise<void>;
  /** Wraps Connection commands: owns changes Materialize implicitly and move the doc. */
  wrap(commands: Command[]): Command[];
  /** Creation Pipeline finished: run the implicit Materialize it held back. */
  afterPipeline(id: string): Promise<void>;
  /** Foundry `createItem` (not Silk's own write). */
  itemCreated(doc: DocSnapshot): Promise<void>;
  /** Foundry `deleteItem` (not Silk's own write). */
  itemDeleted(doc: DocSnapshot): Promise<void>;
  /** Foundry `createActor`: embedded Items of a copied actor are copies too. */
  actorCreated(doc: DocSnapshot): Promise<void>;
}

/** A copy and the original's deletion closer than this are one move. */
export const MOVE_WINDOW_MS = 10_000;

/** A snapshot as create data (without Silk's identity fields). */
export function sourceData(doc: DocSnapshot): DocData {
  const data: Partial<DocSnapshot> = structuredClone(doc);
  delete data.uuid;
  delete data.documentName;
  delete data.parent;
  return data as DocData;
}

const silkId = (doc: { flags?: { silk?: { id?: unknown } } }) => {
  const id = doc.flags?.silk?.id;
  return typeof id === 'string' ? id : undefined;
};

export function createOwns(deps: OwnsDeps): Owns {
  const { docs } = deps;
  /** Item element id → copies made recently (candidates for a move). */
  const copies = new Map<string, { uuid: string; companion?: string; at: number }[]>();
  /** Items whose implicit Materialize waits for the Creation Pipeline. */
  const held = new Set<string>();
  /** Hook reactions run one at a time, in hook order. */
  let queue: Promise<void> = Promise.resolve();
  const serial = (job: () => Promise<void>) => {
    const next = queue.then(job);
    queue = next.catch(() => undefined);
    return next;
  };

  const element = (id: string | undefined): StoryElement | undefined =>
    id ? readElement(deps.workingCopy().get(id)) : undefined;

  const ownsOf = (itemId: string) =>
    connectionsIn(deps.workingCopy().records()).filter((c) => c.type === 'owns' && c.to === itemId);

  const ownerOf = (itemId: string) => ownsOf(itemId)[0]?.from;

  /** The element's doc, if Materialized and present. */
  const docOf = (id: string) => {
    const uuid = element(id)?.uuid;
    return uuid ? docs.get(uuid) : undefined;
  };

  function parentOf(itemId: string) {
    const owner = ownerOf(itemId);
    const doc = owner ? docOf(owner) : undefined;
    return doc?.documentName === 'Actor' ? doc.uuid : undefined;
  }

  async function writeUuid(id: string, uuid: string) {
    const record = deps.workingCopy().get(id);
    if (!record) return;
    await deps
      .workingCopy()
      .set([elementRecord(id, { ...(record.data as unknown as ElementData), uuid })]);
  }

  /** Moves a Materialized Item's doc to where owns places it (Silk-driven). */
  async function relocate(itemId: string) {
    const current = docOf(itemId);
    if (!current || current.documentName !== 'Item') return;
    const target = parentOf(itemId);
    if (current.parent === target) return;
    const data = sourceData(current);
    data.folder = target
      ? null
      : await docs.ensureFolder('Item', 'item', deps.localize('SILK.Folder.item'));
    const moved = await docs.create('Item', data, target);
    await docs.delete(current.uuid);
    await writeUuid(itemId, moved);
  }

  const creatable = (el: StoryElement | undefined) => !!el && !!elementClass(el.class)?.creatable;

  /** An owns that changed: implicit Materialize (§6 on demand), then move the doc. */
  async function settle(itemId: string) {
    const owner = element(ownerOf(itemId));
    const item = element(itemId);
    if (owner && item && deps.mode() === 'onDemand') {
      const ghost = !item.uuid && owner.uuid ? item : !owner.uuid && item.uuid ? owner : undefined;
      if (ghost && creatable(ghost)) {
        if (deps.deferImmediate?.()) {
          held.add(itemId);
          return;
        }
        await deps.materializer.ensureMaterialized(ghost.id);
      }
    }
    await relocate(itemId);
  }

  /** item → owner, from the owns Connections. */
  const ownership = () =>
    new Map(
      connectionsIn(deps.workingCopy().records())
        .filter((c) => c.type === 'owns')
        .map((c) => [c.to, c.from]),
    );

  function wrapOne(command: Command): Command {
    return {
      ...command,
      async run(args) {
        const before = ownership();
        const result = await command.run(args);
        const after = ownership();
        for (const item of new Set([...before.keys(), ...after.keys()]))
          if (before.get(item) !== after.get(item) && element(item)) await settle(item);
        return result;
      },
    };
  }

  /** Sets the item's owner per Foundry (or none), replacing what conflicts. */
  async function setOwner(itemId: string, ownerId: string | undefined) {
    const wc = deps.workingCopy();
    const existing = ownsOf(itemId);
    if (existing.length === 1 && existing[0]?.from === ownerId) return;
    if (ownerId) {
      const data = {
        from: ownerId,
        to: itemId,
        type: 'owns' as const,
        direction: 'directed' as const,
        label: '',
      };
      const result = check(wc.records(), data);
      if (result.ok) {
        await wc.set([connectionRecord(deps.newId(), data)]);
        if (result.replaces.length) await wc.delete(result.replaces);
        return;
      }
    }
    if (existing.length) await wc.delete(existing.map((c) => c.id));
  }

  /** The Story Element that may own Items, for an Actor uuid. */
  function ownerElement(parent: string | undefined) {
    const doc = parent ? docs.get(parent) : undefined;
    const owner = element(doc ? deps.materializer.elementIdOf(doc) : undefined);
    return owner && owner.uuid === parent && validTypes(owner.class, 'item').includes('owns')
      ? owner.id
      : undefined;
  }

  async function strip(uuid: string) {
    await docs.update(uuid, { 'flags.silk.-=id': null, 'flags.silk.-=companion': null });
  }

  return {
    parentOf,

    async afterMaterialize(id) {
      const el = element(id);
      if (!el || documentName(el.class) !== 'Actor') return;
      for (const c of connectionsIn(deps.workingCopy().records()))
        if (c.type === 'owns' && c.from === id) await relocate(c.to);
    },

    wrap: (commands) => commands.map(wrapOne),

    async afterPipeline(id) {
      if (!held.delete(id)) return;
      await settle(id);
    },

    itemCreated(doc) {
      const id = silkId(doc);
      const el = element(id);
      if (!id || !el || el.uuid === doc.uuid) return Promise.resolve();
      // A copy: remember it now (the original's deletion may follow: a move).
      const original = el.uuid ? docs.get(el.uuid) : undefined;
      if (original) {
        const list = (copies.get(id) ?? []).filter((c) => deps.now() - c.at < MOVE_WINDOW_MS);
        const companion = doc.flags.silk.companion;
        list.push({ uuid: doc.uuid, at: deps.now(), ...(companion ? { companion } : {}) });
        copies.set(id, list);
      }
      return serial(() => strip(doc.uuid));
    },

    itemDeleted(doc) {
      const id = silkId(doc);
      const el = element(id);
      if (!id || !el || el.uuid !== doc.uuid) return Promise.resolve();
      const recent = (copies.get(id) ?? []).filter((c) => deps.now() - c.at < MOVE_WINDOW_MS);
      copies.delete(id);
      return serial(async () => {
        const moved = recent.reverse().find((c) => docs.get(c.uuid));
        if (!moved) {
          // The doc left its actor without a move: owns is deleted (§7). Unmaterialize: T9.
          if (doc.parent) await setOwner(id, undefined);
          return;
        }
        const silk = moved.companion ? { id, companion: moved.companion } : { id };
        await docs.update(moved.uuid, { flags: { silk } });
        await writeUuid(id, moved.uuid);
        await setOwner(id, ownerElement(docs.get(moved.uuid)?.parent));
      });
    },

    actorCreated(doc) {
      const stale = (doc.items ?? []).filter((item) => {
        const id = silkId(item);
        return id && element(id) && element(id)?.uuid !== `${doc.uuid}.Item.${item._id}`;
      });
      return serial(async () => {
        for (const item of stale) await strip(`${doc.uuid}.Item.${item._id}`);
      });
    },
  };
}
