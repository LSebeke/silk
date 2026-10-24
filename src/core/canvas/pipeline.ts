/**
 * Creation Pipeline (spec §10.3): every way of creating ends here.
 *   1. class box (searchable, at the spot) → `element.create`
 *   2. name field, focused → `element.rename`
 *   3. Connection editor, focused on its label, when created from a Node (`element.create`
 *      returned a `connectionId`) → `connection.setLabel`
 * Entry points (right-click, drag-out, palette) differ only in `open()` args; digit keys
 * skip the class box with `create()`. A Connection made on its own opens step 3 directly.
 * Pure: runs commands through the injected `run`.
 */
import { ELEMENT_CLASSES, type ElementClass, type ElementClassId } from '../elements/classes';
import type { ElementCreateArgs, ElementCreateResult } from '../elements/commands';
import type { Point } from '../elements/element';

export interface PipelineOrigin {
  /** Where the new Node goes, in canvas coordinates. */
  at: Point;
  /** Where the class box shows, in window-local pixels (UI only). */
  anchor?: Point;
  from?: string;
  connection?: ElementCreateArgs['connection'];
}

export type PipelineStep =
  | { step: 'idle' }
  | ({ step: 'classBox'; query: string } & PipelineOrigin)
  | { step: 'name'; id: string }
  /** `id` = Connection; `elementId` set when it belongs to a new element. */
  | { step: 'connection'; id: string; elementId?: string };

export interface CreationPipelineDeps {
  run(name: string, args: object): Promise<unknown>;
  /** Localised class name; also the new element's default name. */
  label(id: ElementClassId): string;
}

export interface CreationPipeline {
  get(): PipelineStep;
  subscribe(run: (step: PipelineStep) => void): () => void;
  open(origin: PipelineOrigin): void;
  setQuery(query: string): void;
  /** Creatable classes matching the query (name substring or digit). */
  options(): ElementClass[];
  pickClass(id: ElementClassId): Promise<string>;
  pickFirst(): Promise<string | undefined>;
  /** Class box skipped (digit keys): create at once, then the name step. */
  create(origin: PipelineOrigin, id: ElementClassId): Promise<string>;
  submitName(name: string): Promise<void>;
  /** Open the Connection editor on an existing Connection (made on its own, `F2`). */
  editConnection(id: string): void;
  submitLabel(label: string): Promise<void>;
  /** Rename an existing element (`F2`) through the name step. */
  rename(id: string, current: string): void;
  cancel(): void;
  /** Called once a created element has finished the pipeline. */
  onComplete(listener: (done: { id: string }) => void): () => void;
}

export function createCreationPipeline(deps: CreationPipelineDeps): CreationPipeline {
  let step: PipelineStep = { step: 'idle' };
  let defaultName = '';
  let connectionId: string | undefined;
  /** The name step belongs to a rename, not a creation. */
  let renaming = false;
  const subscribers = new Set<(step: PipelineStep) => void>();
  const listeners = new Set<(done: { id: string }) => void>();

  function set(next: PipelineStep) {
    step = next;
    for (const s of subscribers) s(step);
  }

  function options() {
    const query = step.step === 'classBox' ? step.query.trim().toLowerCase() : '';
    return ELEMENT_CLASSES.filter(
      (c) =>
        c.creatable &&
        (!query || String(c.digit) === query || deps.label(c.id).toLowerCase().includes(query)),
    );
  }

  async function pickClass(id: ElementClassId) {
    if (step.step !== 'classBox') throw new Error('Silk: the class box is not open');
    return createAt(step, id);
  }

  async function createAt({ at, from, connection }: PipelineOrigin, id: ElementClassId) {
    defaultName = deps.label(id);
    const args: ElementCreateArgs = { class: id, name: defaultName, at };
    if (from) args.from = from;
    if (connection) args.connection = connection;
    const result = (await deps.run('element.create', args)) as ElementCreateResult;
    connectionId = result.connectionId;
    renaming = false;
    set({ step: 'name', id: result.id });
    return result.id;
  }

  async function submitName(name: string) {
    if (step.step !== 'name') return;
    const { id } = step;
    const trimmed = name.trim();
    const connection = connectionId;
    connectionId = undefined;
    set(connection ? { step: 'connection', id: connection, elementId: id } : { step: 'idle' });
    if (trimmed && trimmed !== defaultName) await deps.run('element.rename', { id, name: trimmed });
    if (!connection && !renaming) complete(id);
    renaming = false;
  }

  function complete(id: string | undefined) {
    if (id) for (const l of listeners) l({ id });
  }

  async function submitLabel(label: string) {
    if (step.step !== 'connection') return;
    const { id, elementId } = step;
    set({ step: 'idle' });
    const trimmed = label.trim();
    if (trimmed) await deps.run('connection.setLabel', { id, label: trimmed });
    complete(elementId);
  }

  return {
    get: () => step,
    subscribe(run) {
      subscribers.add(run);
      run(step);
      return () => subscribers.delete(run);
    },
    open: (origin) => set({ step: 'classBox', query: '', ...origin }),
    setQuery(query) {
      if (step.step === 'classBox') set({ ...step, query });
    },
    options,
    pickClass,
    async pickFirst() {
      const first = options()[0];
      return first && pickClass(first.id);
    },
    create: createAt,
    submitName,
    editConnection: (id) => set({ step: 'connection', id }),
    submitLabel,
    rename(id, current) {
      defaultName = current;
      connectionId = undefined;
      renaming = true;
      set({ step: 'name', id });
    },
    cancel() {
      // Leaving the name step keeps the default name; the element still completes.
      if (step.step === 'name') void submitName('');
      else if (step.step === 'connection') void submitLabel('');
      else set({ step: 'idle' });
    },
    onComplete(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
