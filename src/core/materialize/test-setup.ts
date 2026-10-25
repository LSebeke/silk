/** Shared unit-test wiring: registry + working copy + in-memory Foundry docs. */
import { dsa5Mapping } from '../../adapter/dsa5';
import { createRegistry } from '../commands/registry';
import { elementCommands, readElement, type InfoBlock, type StoryElement } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createMaterializer, materializeCommands, type MaterializeMode } from './materializer';
import { createMemoryDocs } from './memory-docs';
import type { CategoryData, DocSnapshot, PageData, SilkDocFlags } from './port';

export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

/** A created doc as tests read it: embedded arrays and Silk flags present. */
export type TestDoc = DocSnapshot & {
  pages: PageData[];
  categories: CategoryData[];
  flags: { silk: Required<SilkDocFlags> };
};
export type TestElement = StoryElement & { infoBlocks: InfoBlock[] };

export const page = (doc: TestDoc, id: string) =>
  must(
    doc.pages.find((p) => p._id === id),
    `page ${id}`,
  );
export const pageNames = (doc: TestDoc) =>
  [...doc.pages].sort((a, b) => a.sort - b.sort).map((p) => p.name);

export function setup(
  opts: { mode?: MaterializeMode; visible?: string[]; confirm?: boolean } = {},
) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const docs = createMemoryDocs();
  const registry = createRegistry(() => ({ isGM: true }));
  const toasts: string[] = [];
  const confirms: number[] = [];
  let mode: MaterializeMode = opts.mode ?? 'onDemand';
  let n = 0;
  let selection: string[] = [];
  const newId = () => `id${String(++n).padStart(14, '0')}`;
  const materializer = createMaterializer({
    workingCopy: () => workingCopy,
    docs,
    system: dsa5Mapping,
    mode: () => mode,
    newId,
    localize: (key) => key.split('.').pop() ?? key,
    notify: (message) => toasts.push(message),
    confirm: async (count) => {
      confirms.push(count);
      return opts.confirm ?? true;
    },
    visibleIds: () => opts.visible ?? [...workingCopy.records().keys()],
    selection: () => selection,
  });
  for (const command of [
    ...elementCommands({
      workingCopy: () => workingCopy,
      newId,
      afterCreate: [(element) => materializer.afterCreate(element)],
      afterRename: [(element) => materializer.writeName(element.id)],
    }),
    ...materializeCommands(materializer),
  ])
    registry.register(command);

  const create = async (cls: string, name: string) =>
    (await registry.run<{ id: string }>('element.create', { class: cls, name })).id;
  const element = (id: string) => readElement(workingCopy.get(id)) as TestElement;
  /** The live doc (mutate it to simulate a Foundry-side edit). */
  const doc = (id: string) => {
    const uuid = must(element(id).uuid, `uuid of ${id} (Ghost)`);
    const live = must(docs.docs.get(uuid), uuid);
    live.pages ??= [];
    live.categories ??= [];
    return live as TestDoc;
  };
  const companion = (id: string) => {
    const live = must(docs.docs.get(`JournalEntry.${doc(id).flags.silk.companion}`), 'companion');
    return live as TestDoc;
  };
  return {
    registry,
    workingCopy,
    docs,
    materializer,
    toasts,
    confirms,
    create,
    element,
    doc,
    companion,
    setMode: (m: MaterializeMode) => (mode = m),
    select: (ids: string[]) => (selection = ids),
  };
}
