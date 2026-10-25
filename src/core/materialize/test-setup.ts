/** Shared unit-test wiring: registry + working copy + in-memory Foundry docs. */
import { dsa5Mapping } from '../../adapter/dsa5';
import type { Snapshot } from '../canon';
import { createRegistry } from '../commands/registry';
import { connectionCommands } from '../connections';
import { elementCommands, readElement, type InfoBlock, type StoryElement } from '../elements';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createLifecycle, lifecycleCommands, type DeleteAnswer, type Lifecycle } from './lifecycle';
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
    restorePlan: (el, folders) => lifecycle.restorePlan(el, folders),
    afterMaterialize: (id) => lifecycle.afterMaterialize(id),
  });
  const revealed = new Set<string>();
  const warnings: string[] = [];
  const settings = { warnUnmaterializeReveal: true, confirmDelete: false };
  const prompts = {
    unmaterialize: [] as string[][],
    delete: [] as { names: string[]; adopted: number; keepFoundryDoc: boolean }[],
  };
  const answers: { unmaterialize: boolean; delete: DeleteAnswer | null } = {
    unmaterialize: true,
    delete: { keepFoundryDoc: true },
  };
  let lastCommit: { hash: string; snapshot: Snapshot } | null = null;
  const lifecycle: Lifecycle = createLifecycle({
    workingCopy: () => workingCopy,
    docs,
    system: dsa5Mapping,
    materializer,
    newId,
    localize: (key, data) => `${key.split('.').pop() ?? key}${data ? JSON.stringify(data) : ''}`,
    warn: (message) => warnings.push(message),
    isRevealed: async (id) => revealed.has(id),
    warnRevealed: () => settings.warnUnmaterializeReveal,
    confirmUnmaterialize: async (names) => {
      prompts.unmaterialize.push(names);
      return answers.unmaterialize;
    },
    confirmDeleteEnabled: () => settings.confirmDelete,
    confirmDelete: async (args) => {
      prompts.delete.push(args);
      return answers.delete;
    },
    lastCommit: async () => lastCommit,
  });
  for (const command of [
    ...connectionCommands({ workingCopy: () => workingCopy, newId }),
    ...lifecycleCommands(lifecycle, () => selection),
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
    lifecycle,
    revealed,
    warnings,
    settings,
    prompts,
    answers,
    /** Simulate a Commit: the head snapshot is the working copy now. */
    commit: (hash: string) => (lastCommit = { hash, snapshot: new Map(workingCopy.records()) }),
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
