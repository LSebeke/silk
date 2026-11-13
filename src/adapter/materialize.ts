/**
 * Foundry side of Materialize (spec §6, §7): the real `FoundryApi`, and the hooks that let
 * Foundry edits flow back into Story Elements. Hooks fire on every client; only the
 * active GM mirrors, and Garn's own writes (tagged `GARN_WRITE`) are skipped.
 */
import type { Materializer } from '../core/materialize';
import type { FoundryApi, FoundryDoc, FoundryDocumentClass } from './foundry-docs';
import { isGarnWrite } from './working-copy-journal';

/** `FoundryApi` over the running Foundry. Globals are read lazily, per call. */
export function foundryApi(): FoundryApi {
  return {
    documentClass: (name) =>
      (CONFIG as unknown as Record<string, { documentClass: FoundryDocumentClass }>)[name]
        ?.documentClass as FoundryDocumentClass,
    fromUuid: (uuid) => fromUuidSync(uuid) as FoundryDoc | null,
    async importData(uuid) {
      // The data half of a normal Foundry import (`importFromCompendium`): no id, folder,
      // sort or ownership; `_stats.compendiumSource` set.
      const entry = (await fromUuid(uuid)) as unknown as {
        pack?: string;
        documentName: string;
      } | null;
      if (!entry?.pack) return undefined;
      const collection = game.collections?.get(entry.documentName as never) as unknown as
        { fromCompendium(doc: unknown, options?: object): object } | undefined;
      return collection?.fromCompendium(entry);
    },
    journal: (id) => game.journal?.get(id) as unknown as FoundryDoc | undefined,
    folders: () => (game.folders ?? []) as never,
    replace: (value) => foundry.data.operators.ForcedReplacement.create(value) as object,
    getSetting: (ns, key) => (game.settings as unknown as Settings | undefined)?.get(ns, key),
    setSetting: async (ns, key, value) =>
      (game.settings as unknown as Settings | undefined)?.set(ns, key, value),
  };
}

/** Untyped settings access: other packages' settings (DSA5) aren't in fvtt-types' config. */
interface Settings {
  get(namespace: string, key: string): unknown;
  set(namespace: string, key: string, value: unknown): Promise<unknown>;
}

type Doc = { flags?: unknown; parent?: Doc | null; isToken?: boolean };

/** Which Story Element a hooked doc belongs to; pages and categories count for their journal. */
export function hookedElementId(
  materializer: Pick<Materializer, 'elementIdOf'>,
  doc: Doc,
  embedded: boolean,
): string | undefined {
  const target = embedded ? doc.parent : doc;
  // An unlinked token's synthetic actor carries the base actor's flags: not the element.
  if (!target || target.isToken) return undefined;
  return materializer.elementIdOf(target);
}

export function registerMaterializeHooks(
  materializer: Materializer,
  deps: {
    on(hook: string, fn: (...args: unknown[]) => void): void;
    isActiveGM(): boolean;
  },
): void {
  const handle = (doc: unknown, options: unknown, embedded: boolean) => {
    if (!deps.isActiveGM() || isGarnWrite(options)) return;
    const id = hookedElementId(materializer, doc as Doc, embedded);
    if (id) materializer.sync(id).catch((error: unknown) => console.error(error));
  };
  for (const name of ['Actor', 'Item', 'JournalEntry']) {
    deps.on(`create${name}`, (doc, options) => handle(doc, options, false));
    deps.on(`update${name}`, (doc, _changed, options) => handle(doc, options, false));
  }
  // ActiveEffect: the dsa5 `dead` condition (§7 Dead) is an effect on the actor.
  for (const name of ['JournalEntryPage', 'JournalEntryCategory', 'ActiveEffect']) {
    deps.on(`create${name}`, (doc, options) => handle(doc, options, true));
    deps.on(`update${name}`, (doc, _changed, options) => handle(doc, options, true));
    deps.on(`delete${name}`, (doc, options) => handle(doc, options, true));
  }
}
