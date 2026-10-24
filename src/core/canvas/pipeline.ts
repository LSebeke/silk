/**
 * Creation Pipeline (spec §10.3): every way of creating ends here.
 *   1. class box (searchable, at the spot) → `element.create`
 *   2. name field, focused → `element.rename`
 *   3. (T7) Connection editor when created from a Node: `element.create` returns a
 *      `connectionId`; add a `connection` step here.
 * Entry points (right-click, drag-out, digit keys, palette) differ only in `open()` args.
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
  | { step: 'name'; id: string };

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
  submitName(name: string): Promise<void>;
  cancel(): void;
  /** Called once a created element has finished the pipeline. */
  onComplete(listener: (done: { id: string }) => void): () => void;
}

export function createCreationPipeline(deps: CreationPipelineDeps): CreationPipeline {
  let step: PipelineStep = { step: 'idle' };
  let defaultName = '';
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
    const { at, from, connection } = step;
    defaultName = deps.label(id);
    const args: ElementCreateArgs = { class: id, name: defaultName, at };
    if (from) args.from = from;
    if (connection) args.connection = connection;
    const result = (await deps.run('element.create', args)) as ElementCreateResult;
    set({ step: 'name', id: result.id });
    return result.id;
  }

  async function submitName(name: string) {
    if (step.step !== 'name') return;
    const { id } = step;
    const trimmed = name.trim();
    set({ step: 'idle' });
    if (trimmed && trimmed !== defaultName) await deps.run('element.rename', { id, name: trimmed });
    for (const l of listeners) l({ id });
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
    submitName,
    cancel() {
      // Leaving the name step keeps the default name; the element still completes.
      if (step.step === 'name') void submitName('');
      else set({ step: 'idle' });
    },
    onComplete(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
