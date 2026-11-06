/**
 * Creation Pipeline (spec §10.3, 1.1 §B): every way of creating ends here.
 *   1. class box (searchable, at the spot)
 *   2. Source Step, only for classes that have one (Person, Creature; 1.1 §B.1): a compass of
 *      Compendium / Generator / Blank → `element.create` with `source`. Classes without one
 *      run `element.create` straight from step 1.
 *   3. name field, focused (prefilled with the source's name) → `element.rename`
 *   4. Connection editor, focused on its label, when created from a Node (`element.create`
 *      returned a `connectionId`) → `connection.setLabel`
 * Entry points (right-click / right-drag, spec 1.1 §A; palette; Node menu) differ only in
 * `open()` args (`from` + relative `connection.direction`); digit keys
 * skip the class box with `create()`. A Connection made on its own opens step 3 directly.
 * Pure: runs commands through the injected `run`.
 */
import { ELEMENT_CLASSES, type ElementClass, type ElementClassId } from '../elements/classes';
import type { ElementCreateArgs, ElementCreateResult } from '../elements/commands';
import type { Point } from '../elements/element';
import {
  SOURCE_KIND_ORDER,
  sourceKinds,
  type ElementSource,
  type SourceKind,
} from '../elements/sources';

export interface PipelineOrigin {
  /** Where the new Node goes, in canvas coordinates. */
  at: Point;
  /** Where the class box shows, in window-local pixels (UI only). */
  anchor?: Point;
  from?: string;
  connection?: ElementCreateArgs['connection'];
  /** Adopt (§6): the class box offers `classes` (first = pre-selected) and runs `adopt.doc`. */
  adopt?: PipelineAdopt;
}

export interface PipelineAdopt {
  uuid: string;
  classes: ElementClassId[];
  /** Dropped onto this Node. */
  connectTo?: string;
  /** With `connectTo`: the wanted Connection, direction relative to `connectTo`. */
  connection?: ElementCreateArgs['connection'];
  alsoAdoptActor?: boolean;
}

/** One compass button of the Source Step. Greyed (`available: false`) choices are inert. */
export interface SourceChoice {
  kind: SourceKind;
  available: boolean;
  /** i18n key of the tooltip on a greyed choice. */
  reason?: string;
}

export type PipelineStep =
  | { step: 'idle' }
  | ({ step: 'classBox'; query: string } & PipelineOrigin)
  | ({
      step: 'source';
      class: ElementClassId;
      /** In compass order: ↑ Compendium, ← Generator, → Blank. */
      choices: SourceChoice[];
      /** A provider (picker window, generator) is open; the compass waits for it. */
      pending?: Exclude<SourceKind, 'blank'>;
    } & PipelineOrigin)
  | { step: 'name'; id: string }
  /** `id` = Connection; `elementId` set when it belongs to a new element. */
  | { step: 'connection'; id: string; elementId?: string };

/**
 * A non-blank Source Step choice (Compendium T33, Generator T34). Registered per kind in
 * `CreationPipelineDeps.sources`; a kind without a provider is greyed.
 */
export interface SourceProvider {
  /** Undefined = available for the class; else the i18n key of the greyed tooltip. */
  unavailable(cls: ElementClassId): string | undefined;
  /**
   * Runs the choice (opens its window). Resolves with the pick, or undefined when closed
   * without one (back to the Source Step). `signal` aborts when the creation is cancelled.
   */
  pick(request: SourceRequest): Promise<SourcePick | undefined>;
}

export interface SourceRequest {
  class: ElementClassId;
  at: Point;
  signal: AbortSignal;
}

/**
 * The new element is `element.create`d with `source`; the name step is prefilled with `name`.
 * `adopt` instead (a Compendium World actor, 1.1 §B.2 Outcome): the doc is Adopted (§6).
 */
export type SourcePick =
  | { source: Exclude<ElementSource, { kind: 'blank' }>; name: string }
  | { adopt: { uuid: string }; name: string };

export type SourceProviders = Partial<Record<Exclude<SourceKind, 'blank'>, SourceProvider>>;

export interface CreationPipelineDeps {
  run(name: string, args: object): Promise<unknown>;
  /** Localised class name; also the new element's default name. */
  label(id: ElementClassId): string;
  /** Source Step choices beyond Blank. */
  sources?: SourceProviders;
}

export interface CreationPipeline {
  get(): PipelineStep;
  subscribe(run: (step: PipelineStep) => void): () => void;
  open(origin: PipelineOrigin): void;
  setQuery(query: string): void;
  /** Creatable classes matching the query (name substring or digit). */
  options(): ElementClass[];
  /**
   * Resolves with the new element's id, or undefined when the class takes the Source Step
   * first (nothing is created yet).
   */
  pickClass(id: ElementClassId): Promise<string | undefined>;
  pickFirst(): Promise<string | undefined>;
  /** Class box skipped (digit keys, palette): the Source Step or create at once. */
  create(origin: PipelineOrigin, id: ElementClassId): Promise<string | undefined>;
  /**
   * Source Step pick (compass). Resolves with the new element's id; undefined when the
   * choice is greyed, a provider is open, it closed without a pick, or the step was cancelled.
   */
  pickSource(kind: SourceKind): Promise<string | undefined>;
  /**
   * In the class box or the Source Step, where `element.create` runs before the name is
   * typed: immediate Materialize waits for the end of the pipeline.
   */
  picking(): boolean;
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
  /** Aborts the open provider when the Source Step ends. */
  let sourceAbort: AbortController | undefined;
  /** A Source Step pick is running `element.create`: further picks are ignored. */
  let sourceCreating = false;
  const subscribers = new Set<(step: PipelineStep) => void>();
  const listeners = new Set<(done: { id: string }) => void>();

  function set(next: PipelineStep) {
    if (step.step === 'source' && next.step !== 'source') {
      sourceAbort?.abort();
      sourceAbort = undefined;
    }
    step = next;
    for (const s of subscribers) s(step);
  }

  function options() {
    const query = step.step === 'classBox' ? step.query.trim().toLowerCase() : '';
    const adopt = step.step === 'classBox' ? step.adopt : undefined;
    const pool = adopt
      ? adopt.classes.flatMap((id) => ELEMENT_CLASSES.find((c) => c.id === id) ?? [])
      : ELEMENT_CLASSES.filter((c) => c.creatable);
    return pool.filter(
      (c) => !query || String(c.digit) === query || deps.label(c.id).toLowerCase().includes(query),
    );
  }

  async function pickClass(id: ElementClassId) {
    if (step.step !== 'classBox') throw new Error('Silk: the class box is not open');
    return createAt(step, id);
  }

  async function createAt(origin: PipelineOrigin, id: ElementClassId) {
    if (origin.adopt) return adoptAs(origin.at, origin.adopt, id);
    const kinds = sourceKinds(id);
    if (!kinds) return createElement(origin, id);
    const { at, anchor, from, connection } = origin;
    set({
      step: 'source',
      class: id,
      choices: SOURCE_KIND_ORDER.map((kind) => choice(id, kind, kinds)),
      at,
      ...(anchor ? { anchor } : {}),
      ...(from ? { from } : {}),
      ...(connection ? { connection } : {}),
    });
    return undefined;
  }

  function choice(
    id: ElementClassId,
    kind: SourceKind,
    kinds: readonly SourceKind[],
  ): SourceChoice {
    if (!kinds.includes(kind)) return { kind, available: false, reason: 'SILK.Source.NotForClass' };
    if (kind === 'blank') return { kind, available: true };
    const provider = deps.sources?.[kind];
    const reason = provider ? provider.unavailable(id) : 'SILK.Source.Unavailable';
    return reason ? { kind, available: false, reason } : { kind, available: true };
  }

  async function pickSource(kind: SourceKind) {
    const current = step;
    if (current.step !== 'source' || current.pending || sourceCreating) return undefined;
    if (!current.choices.some((c) => c.kind === kind && c.available)) return undefined;
    if (kind === 'blank') return createFromSource(current, { kind: 'blank' });
    const provider = deps.sources?.[kind];
    if (!provider) return undefined;
    const abort = new AbortController();
    sourceAbort = abort;
    set({ ...current, pending: kind });
    let pick: SourcePick | undefined;
    try {
      pick = await provider.pick({ class: current.class, at: current.at, signal: abort.signal });
    } finally {
      if (sourceAbort === abort) sourceAbort = undefined;
    }
    if (abort.signal.aborted || step.step !== 'source') return undefined;
    if (!pick) {
      set(current);
      return undefined;
    }
    if ('adopt' in pick) return adoptFromSource(current, pick.adopt.uuid);
    return createFromSource(current, pick.source, pick.name);
  }

  /** World pick: `adopt.doc` with the Source Step's origin; connected like a creation. */
  async function adoptFromSource(current: Extract<PipelineStep, { step: 'source' }>, uuid: string) {
    sourceCreating = true;
    try {
      const { at, from, connection } = current;
      const id = await adoptAs(
        at,
        {
          uuid,
          classes: [current.class],
          ...(from ? { connectTo: from } : {}),
          ...(connection ? { connection } : {}),
        },
        current.class,
      );
      return id || undefined;
    } finally {
      sourceCreating = false;
    }
  }

  async function createFromSource(
    current: Extract<PipelineStep, { step: 'source' }>,
    source: ElementSource,
    name?: string,
  ) {
    sourceCreating = true;
    try {
      return await createElement(current, current.class, source, name);
    } finally {
      sourceCreating = false;
    }
  }

  async function createElement(
    { at, from, connection }: PipelineOrigin,
    id: ElementClassId,
    source?: ElementSource,
    name = deps.label(id),
  ) {
    defaultName = name;
    const args: ElementCreateArgs = { class: id, name, at };
    if (from) args.from = from;
    if (connection) args.connection = connection;
    if (source) args.source = source;
    const result = (await deps.run('element.create', args)) as ElementCreateResult;
    connectionId = result.connectionId;
    renaming = false;
    set({ step: 'name', id: result.id });
    return result.id;
  }

  /** Adopt: `adopt.doc`, then the name step pre-filled with the doc's name. */
  async function adoptAs(at: Point, adopt: PipelineAdopt, id: ElementClassId) {
    set({ step: 'idle' });
    const { uuid, connectTo, connection, alsoAdoptActor } = adopt;
    const result = (await deps.run('adopt.doc', {
      uuid,
      class: id,
      at,
      ...(connectTo ? { connectTo } : {}),
      ...(connectTo && connection ? { connection } : {}),
      ...(alsoAdoptActor !== undefined ? { alsoAdoptActor } : {}),
    })) as { id: string; name: string; existing?: boolean; connectionId?: string } | null;
    if (!result || result.existing) return result?.id ?? '';
    defaultName = result.name;
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
    pickSource,
    picking: () => step.step === 'classBox' || step.step === 'source',
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
