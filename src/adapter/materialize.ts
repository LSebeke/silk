/**
 * Foundry side of Materialize (spec §6, §7): the real `FoundryApi`, and the hooks that let
 * Foundry edits flow back into Story Elements. Hooks fire on every client; only the
 * active GM mirrors, and Silk's own writes (tagged `SILK_WRITE`) are skipped.
 */
import type { Materializer } from '../core/materialize';
import type { FoundryApi, FoundryDoc, FoundryDocumentClass } from './foundry-docs';
import { isSilkWrite } from './working-copy-journal';

/** `FoundryApi` over the running Foundry. Globals are read lazily, per call. */
export function foundryApi(): FoundryApi {
  return {
    documentClass: (name) =>
      (CONFIG as unknown as Record<string, { documentClass: FoundryDocumentClass }>)[name]
        ?.documentClass as FoundryDocumentClass,
    fromUuid: (uuid) => fromUuidSync(uuid) as FoundryDoc | null,
    journal: (id) => game.journal?.get(id) as unknown as FoundryDoc | undefined,
    folders: () => (game.folders ?? []) as never,
    replace: (value) => foundry.data.operators.ForcedReplacement.create(value) as object,
  };
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
    if (!deps.isActiveGM() || isSilkWrite(options)) return;
    const id = hookedElementId(materializer, doc as Doc, embedded);
    if (id) materializer.sync(id).catch((error: unknown) => console.error(error));
  };
  for (const name of ['Actor', 'Item', 'JournalEntry']) {
    deps.on(`create${name}`, (doc, options) => handle(doc, options, false));
    deps.on(`update${name}`, (doc, _changed, options) => handle(doc, options, false));
  }
  for (const name of ['JournalEntryPage', 'JournalEntryCategory']) {
    deps.on(`create${name}`, (doc, options) => handle(doc, options, true));
    deps.on(`update${name}`, (doc, _changed, options) => handle(doc, options, true));
    deps.on(`delete${name}`, (doc, options) => handle(doc, options, true));
  }
}
