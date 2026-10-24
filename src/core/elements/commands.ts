/** Element commands (spec §15, "Elements"). */
import type { Command } from '../commands/registry';
import type { WorkingCopy } from '../working-copy';
import { elementClass } from './classes';
import { elementRecord, readElement, type ElementData, type Point } from './element';

export interface ElementCreateArgs {
  class: string;
  name: string;
  /** Node position in canvas coordinates. */
  at?: Point;
  /** Origin element: the new one is connected to it (T7). */
  from?: string;
  connection?: { type?: string; direction?: string; label?: string };
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
}

export function elementCommands(deps: ElementCommandDeps): Command[] {
  const create: Command<ElementCreateArgs, ElementCreateResult> = {
    name: 'element.create',
    title: 'SILK.Commands.element.create',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const cls = elementClass(args.class);
      if (!cls) throw new Error(`Silk: unknown Element class "${args.class}"`);
      if (!cls.creatable)
        throw new Error(`Silk: ${cls.id} elements are never created, only Adopted`);
      const id = deps.newId();
      const data: ElementData = {
        class: cls.id,
        name: args.name.trim(),
        position: { x: args.at?.x ?? 0, y: args.at?.y ?? 0 },
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
    title: 'SILK.Commands.element.rename',
    available: (ctx) => ctx.isGM,
    async run({ id, name }) {
      const wc = deps.workingCopy();
      const record = wc.get(id);
      if (!record || !readElement(record)) throw new Error(`Silk: no element "${id}"`);
      await wc.set([{ ...record, data: { ...record.data, name: name.trim() } }]);
    },
  };

  return [create, rename];
}
