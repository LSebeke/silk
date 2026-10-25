/** Unit-test wiring for Adopt: elements, Connections, Materialize, lifecycle, owns, Scenes. */
import { dsa5Mapping } from '../../adapter/dsa5';
import type { Snapshot } from '../canon';
import { layoutCommands, readGroup, createCanvasState } from '../canvas';
import { createRegistry } from '../commands/registry';
import { connectionCommands, connectOnCreate, readConnection } from '../connections';
import { elementCommands, readElement, type Point, type StoryElement } from '../elements';
import { createEventScenes, createMemoryScenes, type SceneSnapshot } from '../event-scenes';
import {
  createLifecycle,
  createMaterializer,
  createMemoryDocs,
  lifecycleCommands,
  materializeCommands,
  type DocSnapshot,
  type Lifecycle,
  type PageData,
} from '../materialize';
import { must } from '../materialize/test-setup';
import { createOwns, type Owns } from '../owns';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { adoptCommands, createAdopt, type AdoptFolder, type UseForAnswer } from './adopt';

export function setup() {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const docs = createMemoryDocs();
  const scenes = createMemoryScenes();
  const registry = createRegistry(() => ({ isGM: true }));
  const toasts: string[] = [];
  let n = 0;
  const newId = () => `id${String(++n).padStart(14, '0')}`;
  const localize = (key: string, data?: Record<string, string>) =>
    `${key.split('.').pop() ?? key}${data ? JSON.stringify(data) : ''}`;
  let lastCommit: { hash: string; snapshot: Snapshot } | null = null;
  // eslint-disable-next-line prefer-const -- wired after the materializer that needs them
  let lifecycle: Lifecycle;
  // eslint-disable-next-line prefer-const -- as above
  let owns: Owns;
  const materializer = createMaterializer({
    workingCopy: () => workingCopy,
    docs,
    system: dsa5Mapping,
    mode: () => 'immediate',
    newId,
    localize,
    notify: (message) => toasts.push(message),
    confirm: async () => true,
    visibleIds: () => [],
    selection: () => [],
    parentOf: (id) => owns.parentOf(id),
    restorePlan: (el, folders) => lifecycle.restorePlan(el, folders),
    afterMaterialize: async (id) => {
      await owns.afterMaterialize(id);
      await lifecycle.afterMaterialize(id);
    },
  });
  owns = createOwns({
    workingCopy: () => workingCopy,
    docs,
    materializer,
    mode: () => 'immediate',
    newId,
    now: () => 0,
    localize,
  });
  lifecycle = createLifecycle({
    workingCopy: () => workingCopy,
    docs,
    system: dsa5Mapping,
    materializer,
    newId,
    localize,
    warn: (message) => toasts.push(message),
    isRevealed: async () => false,
    warnRevealed: () => false,
    confirmUnmaterialize: async () => true,
    confirmDeleteEnabled: () => false,
    confirmDelete: async () => ({ keepFoundryDoc: true }),
    lastCommit: async () => lastCommit,
  });
  const eventScenes = createEventScenes({
    workingCopy: () => workingCopy,
    docs,
    scenes,
    materializer,
    mode: () => 'immediate',
    newId,
    localize,
    notify: (message) => toasts.push(message),
    lastCommit: async () => lastCommit,
  });
  lifecycle.contribute(eventScenes.contributor);

  const players = new Set(['player1']);
  const folders = new Map<string, AdoptFolder>();
  const compendium = new Map<string, DocSnapshot>();
  const revealed: { elements: string[]; infoBlocks: string[] }[] = [];
  const selected: string[][] = [];
  const flashed: string[] = [];
  const folderPrompts: { name: string; class: string }[][] = [];
  const useForPrompts: { doc: string; element: string }[] = [];
  const shownAdHoc: { uuid: string; name: string }[][] = [];
  const answers = { useFor: 'use' as UseForAnswer, folder: true };
  let center: Point = { x: 500, y: 300 };
  let lastCommitTime: number | null = null;
  const commits: string[] = [];
  const canvasState = createCanvasState();

  const adopt = createAdopt({
    workingCopy: () => workingCopy,
    docs,
    scenes,
    system: dsa5Mapping,
    newId,
    localize,
    materializer,
    foundry: {
      async importFromCompendium(uuid) {
        const entry = must(compendium.get(uuid), uuid);
        const copy = structuredClone(entry) as DocSnapshot & { _stats?: object };
        const id = newId();
        copy._id = id;
        copy.uuid = `${entry.documentName}.${id}`;
        copy._stats = { compendiumSource: uuid };
        docs.docs.set(copy.uuid, copy);
        return copy.uuid;
      },
      folder: (id) => folders.get(id),
      worldDocs: () => [
        ...[...docs.docs.values()]
          .filter((d) => !d.parent)
          .map((d) => ({
            uuid: d.uuid,
            name: d.name,
            documentName: d.documentName as string,
            flags: d.flags,
            createdTime: (d as { _stats?: { createdTime?: number } })._stats?.createdTime ?? 0,
          })),
        ...[...scenes.all.values()].map((s) => ({
          uuid: `Scene.${s._id}`,
          name: s.name,
          documentName: 'Scene',
          flags: s.flags,
          createdTime: (s['_stats'] as { createdTime?: number } | undefined)?.createdTime ?? 0,
        })),
      ],
      isPlayer: (id) => players.has(id),
    },
    run: (name, args) => registry.run(name, args),
    afterAdopt: async (id) => {
      await owns.afterMaterialize(id);
      await lifecycle.afterMaterialize(id);
    },
    markRevealed: async (parts) => void revealed.push(parts),
    viewCenter: () => center,
    select: (ids) => void selected.push([...ids]),
    flash: (id) => void flashed.push(id),
    chooseUseFor: async (args) => {
      useForPrompts.push(args);
      return answers.useFor;
    },
    confirmFolder: async (rows) => {
      folderPrompts.push(rows);
      return answers.folder;
    },
    commit: async (label) => {
      await lifecycle.capture();
      const hash = `commit${commits.length + 1}`;
      commits.push(label ?? '');
      lastCommit = { hash, snapshot: new Map(workingCopy.records()) };
      return hash;
    },
    lastCommitTime: async () => lastCommitTime,
    showAdHoc: (rows) => void shownAdHoc.push(rows),
  });
  lifecycle.contribute(adopt.contributor);

  for (const command of [
    ...elementCommands({
      workingCopy: () => workingCopy,
      newId,
      afterCreate: [
        connectOnCreate({ workingCopy: () => workingCopy, run: (c, a) => registry.run(c, a) }),
        (element) => materializer.afterCreate(element),
      ],
      afterRename: [(element) => materializer.writeName(element.id)],
    }),
    ...materializeCommands(materializer),
    ...lifecycleCommands(lifecycle, () => []),
    ...eventScenes.wrap(owns.wrap(connectionCommands({ workingCopy: () => workingCopy, newId }))),
    ...layoutCommands({
      workingCopy: () => workingCopy,
      state: canvasState,
      newId,
      groupLabel: () => 'Group',
    }),
    ...adoptCommands(adopt),
  ])
    registry.register(command);

  /** Puts an existing (non-Silk) Foundry doc into the World. */
  function foundryDoc(
    documentName: 'Actor' | 'Item' | 'JournalEntry',
    data: Partial<DocSnapshot> & { name: string },
    parent?: string,
  ): DocSnapshot {
    const id = newId();
    const uuid = parent ? `${parent}.${documentName}.${id}` : `${documentName}.${id}`;
    const doc = {
      _id: id,
      folder: 'userFolder',
      flags: { silk: {} },
      ownership: { default: 0 },
      ...data,
      uuid,
      documentName,
      ...(parent ? { parent } : {}),
    } as DocSnapshot;
    docs.docs.set(uuid, doc);
    return doc;
  }
  const textPage = (name: string, text: string, extra: Partial<PageData> = {}): PageData => ({
    _id: newId(),
    name,
    type: 'text',
    sort: 0,
    ownership: { default: -1 },
    text: { content: text },
    ...extra,
  });
  function foundryScene(name: string, tokens: string[] = []): SceneSnapshot {
    const id = newId();
    const scene: SceneSnapshot = {
      _id: id,
      name,
      flags: {},
      active: false,
      tokens: tokens.map((actorId) => ({
        _id: newId(),
        actorId,
        x: 0,
        y: 0,
        hidden: false,
      })),
      grid: { type: 1, size: 77 },
    };
    scenes.all.set(id, scene);
    return scene;
  }

  const element = (id: string) => readElement(workingCopy.get(id)) as StoryElement;
  const elements = () => [...workingCopy.records().values()].flatMap((r) => readElement(r) ?? []);
  const connections = (type: string) =>
    [...workingCopy.records().values()]
      .flatMap((r) => readConnection(r) ?? [])
      .filter((c) => c.type === type)
      .map((c) => [c.from, c.to]);
  const connectionIds = (type: string) =>
    [...workingCopy.records().values()]
      .flatMap((r) => readConnection(r) ?? [])
      .filter((c) => c.type === type)
      .map((c) => c.id);
  const groups = () => [...workingCopy.records().values()].flatMap((r) => readGroup(r) ?? []);
  const run = <T>(name: string, args: object) => registry.run<T>(name, args);
  const adoptDoc = (args: object) =>
    run<{ id: string; name: string; existing?: boolean; connectionId?: string; actorId?: string }>(
      'adopt.doc',
      args,
    );

  return {
    registry,
    workingCopy,
    docs,
    scenes,
    adopt,
    toasts,
    players,
    folders,
    compendium,
    revealed,
    selected,
    flashed,
    folderPrompts,
    useForPrompts,
    shownAdHoc,
    answers,
    commits,
    setCenter: (p: Point) => (center = p),
    setLastCommitTime: (t: number | null) => (lastCommitTime = t),
    foundryDoc,
    foundryScene,
    textPage,
    element,
    elements,
    connections,
    connectionIds,
    groups,
    run,
    adoptDoc,
    create: async (cls: string, name: string) =>
      (await run<{ id: string }>('element.create', { class: cls, name })).id,
    doc: (id: string) => must(docs.docs.get(must(element(id).uuid, `uuid of ${id}`))),
    newId,
  };
}
