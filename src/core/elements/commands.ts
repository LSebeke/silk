/** Element commands (spec §15, "Elements"). */
import type { Command } from '../commands/registry';
import type { WorkingCopy } from '../working-copy';
import { elementClass } from './classes';
import {
  elementRecord,
  readElement,
  type ElementData,
  type Point,
  type StoryElement,
} from './element';
import { classTakesSource, type ElementSource } from './sources';

export interface ElementCreateArgs {
  class: string;
  name: string;
  /** Node position in canvas coordinates. */
  at?: Point;
  /** Origin element: the new one is connected to it (T7). */
  from?: string;
  connection?: { type?: string; direction?: string; label?: string };
  /** What it starts from (spec 1.1 §B.1, §D); default blank. Non-blank is stored on the element. */
  source?: ElementSource;
  /** Image path (a compendium pick's portrait, shown on the Ghost until Materialize). */
  img?: string;
  /** A Scene pick's card image (1.1 §B.2.1): its `thumb` or a WebP data URL. */
  thumb?: string;
}

export interface ElementCreateResult {
  id: string;
  /** Set when `from` produced a Connection (T7); the Creation Pipeline then edits it. */
  connectionId?: string;
}

export interface ElementCommandDeps {
  /** Throws until the adapter has wired the working copy (Foundry `ready`). */
  workingCopy(): WorkingCopy;
  /** A fresh record id (flag-key safe). */
  newId(): string;
  /**
   * Runs after the element record is written, inside `element.create`. Later features
   * hook here: T7 adds the Connection to `from`, T8 Materializes in immediate mode.
   */
  afterCreate?: ((
    element: { id: string } & ElementData,
    args: ElementCreateArgs,
  ) => Promise<Partial<ElementCreateResult> | undefined>)[];
  /** Runs after `element.rename` wrote the record. T8 writes the name through to Foundry. */
  afterRename?: ((element: StoryElement) => Promise<void>)[];
}

export function elementCommands(deps: ElementCommandDeps): Command[] {
  const create: Command<ElementCreateArgs, ElementCreateResult> = {
    name: 'element.create',
    title: 'GARN.Commands.element.create',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const cls = elementClass(args.class);
      if (!cls) throw new Error(`Garn: unknown Element class "${args.class}"`);
      if (!cls.creatable)
        throw new Error(`Garn: ${cls.id} elements are never created, only Adopted`);
      const source = args.source;
      if (source && !classTakesSource(cls.id, source.kind))
        throw new Error(`Garn: ${cls.id} elements take no ${source.kind} source`);
      if (source?.kind === 'generator' && typeof source.actorUuid !== 'string')
        throw new Error('Garn: a generator source needs the actorUuid of the Actor it created');
      const id = deps.newId();
      const data: ElementData = {
        class: cls.id,
        name: args.name.trim(),
        position: { x: args.at?.x ?? 0, y: args.at?.y ?? 0 },
        ...(source && source.kind !== 'blank' ? { source } : {}),
        ...(typeof args.img === 'string' && args.img ? { img: args.img } : {}),
        ...(typeof args.thumb === 'string' && args.thumb ? { thumb: args.thumb } : {}),
      };
      await deps.workingCopy().set([elementRecord(id, data)]);
      let result: ElementCreateResult = { id };
      for (const hook of deps.afterCreate ?? [])
        result = { ...result, ...(await hook({ id, ...data }, args)) };
      return result;
    },
  };

  const rename: Command<{ id: string; name: string }, void> = {
    name: 'element.rename',
    title: 'GARN.Commands.element.rename',
    available: (ctx) => ctx.isGM,
    async run({ id, name }) {
      const wc = deps.workingCopy();
      const record = wc.get(id);
      if (!record || !readElement(record)) throw new Error(`Garn: no element "${id}"`);
      const renamed = { ...record, data: { ...record.data, name: name.trim() } };
      await wc.set([renamed]);
      for (const hook of deps.afterRename ?? []) await hook(readElement(renamed) as StoryElement);
    },
  };

  return [create, rename];
}
