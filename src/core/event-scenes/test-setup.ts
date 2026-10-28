/** Unit-test wiring for Event Scenes: elements, Connections, Materialize, lifecycle, Scenes. */
import { dsa5Mapping } from '../../adapter/dsa5';
import type { Snapshot } from '../canon';
import { createRegistry } from '../commands/registry';
import { connectionCommands, connectOnCreate, readConnection } from '../connections';
import { elementCommands, readElement, type StoryElement } from '../elements';
import {
  createLifecycle,
  createMaterializer,
  createMemoryDocs,
  lifecycleCommands,
  materializeCommands,
  type DeletedDoc,
  type DocSnapshot,
  type Lifecycle,
  type MaterializeMode,
} from '../materialize';
import { must } from '../materialize/test-setup';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createEventScenes, eventSceneCommands, type EventScenes } from './event-scenes';
import { createMemoryScenes } from './memory-scenes';
import type { SceneSnapshot } from './port';

export function setup(opts: { mode?: MaterializeMode } = {}) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const docs = createMemoryDocs();
  const scenes = createMemoryScenes();
  const registry = createRegistry(() => ({ isGM: true }));
  const toasts: string[] = [];
  const warnings: string[] = [];
  let mode: MaterializeMode = opts.mode ?? 'immediate';
  let deferring = false;
  let n = 0;
  const newId = () => `id${String(++n).padStart(14, '0')}`;
  const localize = (key: string, data?: Record<string, string>) =>
    `${key.split('.').pop() ?? key}${data ? JSON.stringify(data) : ''}`;
  let lastCommit: { hash: string; snapshot: Snapshot } | null = null;
  // eslint-disable-next-line prefer-const -- wired after the materializer that needs it
  let lifecycle: Lifecycle;
  const materializer = createMaterializer({
    workingCopy: () => workingCopy,
    docs,
    system: dsa5Mapping,
    mode: () => mode,
    newId,
    localize,
    notify: (message) => toasts.push(message),
    confirm: async () => true,
    visibleIds: () => [],
    selection: () => [],
    deferImmediate: () => deferring,
    restorePlan: (el, folders) => lifecycle.restorePlan(el, folders),
    afterMaterialize: (id) => lifecycle.afterMaterialize(id),
  });
  lifecycle = createLifecycle({
    workingCopy: () => workingCopy,
    docs,
    system: dsa5Mapping,
    materializer,
    newId,
    localize,
    warn: (message) => warnings.push(message),
    isRevealed: async () => false,
    warnRevealed: () => false,
    confirmUnmaterialize: async () => true,
    confirmDeleteEnabled: () => false,
    confirmDelete: async () => ({ keepFoundryDoc: true }),
    lastCommit: async () => lastCommit,
  });
  const eventScenes: EventScenes = createEventScenes({
    workingCopy: () => workingCopy,
    docs,
    scenes,
    materializer,
    mode: () => mode,
    deferImmediate: () => deferring,
    newId,
    localize,
    notify: (message) => toasts.push(message),
    lastCommit: async () => lastCommit,
  });
  lifecycle.contribute(eventScenes.contributor);
  for (const command of [
    ...elementCommands({
      workingCopy: () => workingCopy,
      newId,
      afterCreate: [
        connectOnCreate({ workingCopy: () => workingCopy, run: (c, a) => registry.run(c, a) }),
        (element) => materializer.afterCreate(element),
      ],
      afterRename: [
        (element) => materializer.writeName(element.id),
        (element) => eventScenes.renamed(element.id),
      ],
    }),
    ...materializeCommands(materializer),
    ...lifecycleCommands(lifecycle, () => []),
    ...eventScenes.wrap(connectionCommands({ workingCopy: () => workingCopy, newId })),
    ...eventSceneCommands(eventScenes),
  ])
    registry.register(command);

  const create = async (cls: string, name: string, from?: string) =>
    (
      await registry.run<{ id: string }>('element.create', {
        class: cls,
        name,
        ...(from ? { from } : {}),
      })
    ).id;
  const element = (id: string) => readElement(workingCopy.get(id)) as StoryElement;
  const doc = (id: string): DocSnapshot =>
    must(docs.docs.get(must(element(id).uuid, `uuid of ${id}`)), `doc of ${id}`);
  /** The element's Scene (live). */
  const scene = (id: string): SceneSnapshot =>
    must(
      [...scenes.all.values()].find((s) => s.flags.silk?.sceneOf === id),
      `Scene of ${id}`,
    );
  const actorId = (id: string) => must(element(id).uuid).replace(/^Actor\./, '');
  /** Actor ids of the tokens on the element's Scene. */
  const tokens = (id: string) => scene(id).tokens.map((t) => t.actorId);
  const presentAt = (event: string) =>
    [...workingCopy.records().values()]
      .flatMap((r) => readConnection(r) ?? [])
      .filter((c) => c.type === 'presentAt' && c.to === event)
      .map((c) => c.from);
  const connect = (from: string, to: string, type = 'presentAt') =>
    registry.run<{ id: string }>('connection.create', { from, to, type }).then((r) => r.id);
  return {
    registry,
    workingCopy,
    docs,
    scenes,
    materializer,
    lifecycle,
    eventScenes,
    toasts,
    warnings,
    create,
    element,
    doc,
    scene,
    actorId,
    tokens,
    presentAt,
    connect,
    materialize: (...ids: string[]) => registry.run('materialize.elements', { ids }),
    /** Simulate a Commit: the head snapshot is the working copy now. */
    commit: async (hash: string) => {
      await lifecycle.capture();
      lastCommit = { hash, snapshot: new Map(workingCopy.records()) };
    },
    /** Simulates the GM deleting the element's Scene in Foundry, firing the delete hook. */
    deleteSceneInFoundry: async (id: string) => {
      const deleted = scene(id);
      scenes.all.delete(deleted._id);
      await lifecycle.docDeleted({
        ...deleted,
        folder: null,
        uuid: `Scene.${deleted._id}`,
        documentName: 'Scene',
      } as unknown as DeletedDoc);
    },
    setMode: (m: MaterializeMode) => (mode = m),
    setDeferring: (on: boolean) => (deferring = on),
  };
}
