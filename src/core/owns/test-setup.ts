/** Unit-test wiring for owns ↔ inventory: elements, Connections, Materialize, owns. */
import { dsa5Mapping } from '../../adapter/dsa5';
import { createRegistry } from '../commands/registry';
import { connectionCommands, connectOnCreate, readConnection } from '../connections';
import { elementCommands, readElement, type StoryElement } from '../elements';
import {
  createMaterializer,
  createMemoryDocs,
  materializeCommands,
  type DocSnapshot,
  type MaterializeMode,
} from '../materialize';
import { must } from '../materialize/test-setup';
import { createMemoryBackend, createWorkingCopy } from '../working-copy';
import { createOwns, sourceData, type Owns } from './owns';

export function setup(opts: { mode?: MaterializeMode } = {}) {
  const workingCopy = createWorkingCopy(createMemoryBackend(), { canWrite: () => true });
  const docs = createMemoryDocs();
  const registry = createRegistry(() => ({ isGM: true }));
  const toasts: string[] = [];
  let mode: MaterializeMode = opts.mode ?? 'onDemand';
  let deferring = false;
  let clock = 1_000_000;
  let n = 0;
  const newId = () => `id${String(++n).padStart(14, '0')}`;
  const localize = (key: string) => key.split('.').pop() ?? key;
  // eslint-disable-next-line prefer-const -- wired after the materializer that needs it
  let owns: Owns;
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
    parentOf: (id) => owns.parentOf(id),
    afterMaterialize: (id) => owns.afterMaterialize(id),
  });
  owns = createOwns({
    workingCopy: () => workingCopy,
    docs,
    materializer,
    mode: () => mode,
    deferImmediate: () => deferring,
    newId,
    now: () => clock,
    localize,
  });
  for (const command of [
    ...elementCommands({
      workingCopy: () => workingCopy,
      newId,
      afterCreate: [
        connectOnCreate({ workingCopy: () => workingCopy, run: (c, a) => registry.run(c, a) }),
        (element) => materializer.afterCreate(element),
      ],
    }),
    ...materializeCommands(materializer),
    ...owns.wrap(connectionCommands({ workingCopy: () => workingCopy, newId })),
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
  const materialize = (...ids: string[]) => registry.run('materialize.elements', { ids });
  const connect = (from: string, to: string, type = 'owns') =>
    registry.run<{ id: string }>('connection.create', { from, to, type }).then((r) => r.id);
  /** The element's live doc. */
  const doc = (id: string): DocSnapshot =>
    must(docs.docs.get(must(element(id).uuid, `uuid of ${id}`)), `doc of ${id}`);
  /** Owner element ids of `item` per the owns Connections. */
  const owners = (item: string) =>
    [...workingCopy.records().values()]
      .flatMap((r) => readConnection(r) ?? [])
      .filter((c) => c.type === 'owns' && c.to === item)
      .map((c) => c.from);
  /** Simulates a user copying a doc in Foundry (flags included), firing createItem. */
  const copyItem = async (item: DocSnapshot, parent?: string) => {
    const uuid = await docs.create('Item', { ...sourceData(item), _id: newId() }, parent);
    await owns.itemCreated(must(docs.get(uuid)));
    return uuid;
  };
  /** Simulates a user deleting a doc in Foundry, firing deleteItem. */
  const deleteItem = async (uuid: string) => {
    const gone = must(docs.get(uuid));
    await docs.delete(uuid);
    await owns.itemDeleted(gone);
  };
  return {
    registry,
    workingCopy,
    docs,
    materializer,
    owns,
    toasts,
    create,
    element,
    materialize,
    connect,
    doc,
    owners,
    copyItem,
    deleteItem,
    setMode: (m: MaterializeMode) => (mode = m),
    setDeferring: (on: boolean) => (deferring = on),
    tick: (ms: number) => (clock += ms),
  };
}
