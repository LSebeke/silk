/**
 * Layout commands (spec §10.4, §10.7, §15): Visual Groups, Untangle and its undo.
 * Without `ids`, a command acts on the canvas selection (keys `g`, `u`).
 */
import { GROUP_PARENT, type CanonRecord, type Snapshot } from '../canon';
import type { Command } from '../commands/registry';
import type { Point } from '../elements/element';
import type { WorkingCopy } from '../working-copy';
import type { CanvasState } from './canvas-state';
import {
  ancestorsOf,
  applyMoves,
  containerOf,
  frameAround,
  groupRecord,
  growFrames,
  readGroup,
  rectOf,
  union,
  withElementGroup,
} from './groups';
import { untangleLayout } from './untangle';

export interface LayoutCommandDeps {
  workingCopy(): WorkingCopy;
  state: CanvasState;
  newId(): string;
  /** Default label of a new Visual Group (localised). */
  groupLabel(): string;
  /** Called with the old positions just before Untangle (or its undo) writes new ones. */
  tween?(from: ReadonlyMap<string, Point>): void;
}

/** Set (or with `null`, remove) the record's container field. */
function withContainer(record: CanonRecord, group: string | null): CanonRecord {
  if (record.kind === 'layoutGroup')
    return { ...record, data: { ...record.data, [GROUP_PARENT]: group } };
  return { ...record, data: withElementGroup(record.data, group) };
}

/** The records with these ids, skipping missing ones. */
const pick = (records: Snapshot, ids: Iterable<string>) =>
  [...ids].flatMap((id) => records.get(id) ?? []);

/** `element.create` hook: a Node created inside a frame joins the innermost one (§10.4). */
export function joinFrameOnCreate(workingCopy: () => WorkingCopy) {
  return async (element: { id: string; position: Point }) => {
    const wc = workingCopy();
    const changed = applyMoves(wc.records(), [{ id: element.id, ...element.position }]);
    if (changed.length) await wc.set(changed);
    return undefined;
  };
}

export function layoutCommands(deps: LayoutCommandDeps): Command[] {
  const selectionOr = (ids: string[] | undefined) => ids ?? [...deps.state.get().selection];

  const group: Command<{ ids?: string[]; label?: string }, { id: string } | undefined> = {
    name: 'canvas.group',
    title: 'SILK.Commands.canvas.group',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const wc = deps.workingCopy();
      const records = new Map(wc.records());
      const items = selectionOr(args.ids).filter((id) => {
        const kind = records.get(id)?.kind;
        return kind === 'element' || kind === 'layoutGroup';
      });
      // Items inside another selected item stay where they are.
      const nested = items.filter((id) => !ancestorsOf(records, id).some((g) => items.includes(g)));
      if (!nested.length) return undefined;
      // The new group sits in the innermost group holding all items.
      const chains = nested.map((id) => ancestorsOf(records, id));
      const parent = chains[0]?.find((g) => chains.every((c) => c.includes(g))) ?? null;
      const content = union(nested.flatMap((id) => rectOf(records.get(id)) ?? []));
      if (!content) return undefined;
      const frame = frameAround(content);
      const id = deps.newId();
      records.set(
        id,
        groupRecord({
          id,
          label: args.label?.trim() || deps.groupLabel(),
          parent,
          position: { x: frame.x, y: frame.y },
          size: { width: frame.width, height: frame.height },
        }),
      );
      for (const item of pick(records, nested)) records.set(item.id, withContainer(item, id));
      const grown = growFrames(records, [id]);
      await wc.set(pick(records, [id, ...nested, ...grown]));
      return { id };
    },
  };

  const groupOf = (id: string) => {
    const record = deps.workingCopy().get(id);
    if (!record || !readGroup(record)) throw new Error(`Silk: no Visual Group "${id}"`);
    return record;
  };

  const ungroup: Command<{ groupId: string }, void> = {
    name: 'canvas.ungroup',
    title: 'SILK.Commands.canvas.ungroup',
    available: (ctx) => ctx.isGM,
    async run({ groupId }) {
      const wc = deps.workingCopy();
      groupOf(groupId);
      const records = wc.records();
      const parent = containerOf(records, groupId);
      // One write: contents move up, the frame goes.
      const next = new Map(records);
      for (const r of records.values())
        if (containerOf(records, r.id) === groupId) next.set(r.id, withContainer(r, parent));
      next.delete(groupId);
      await wc.replaceAll(next);
    },
  };

  const renameGroup: Command<{ groupId: string; label: string }, void> = {
    name: 'canvas.renameGroup',
    title: 'SILK.Commands.canvas.renameGroup',
    available: (ctx) => ctx.isGM,
    async run({ groupId, label }) {
      const record = groupOf(groupId);
      await deps.workingCopy().set([{ ...record, data: { ...record.data, label: label.trim() } }]);
    },
  };

  /** Records as they were before each Untangle, newest last. Client-local, not persisted. */
  const undoStack: CanonRecord[][] = [];
  const positionsOf = (records: Iterable<CanonRecord>) =>
    new Map(
      [...records]
        .filter((r) => r.kind === 'element')
        .map((r) => [r.id, r.data['position'] as unknown as Point]),
    );

  const untangle: Command<{ ids?: string[] }, void> = {
    name: 'canvas.untangle',
    title: 'SILK.Commands.canvas.untangle',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const wc = deps.workingCopy();
      const before = wc.records();
      const ids = [...new Set(selectionOr(args.ids))].filter(
        (id) => before.get(id)?.kind === 'element',
      );
      if (ids.length < 2) return;
      const layout = await untangleLayout(before, ids);
      const next = new Map(before);
      for (const record of pick(before, ids)) {
        const { x, y } = layout.get(record.id) ?? { x: 0, y: 0 };
        next.set(record.id, { ...record, data: { ...record.data, position: { x, y } } });
      }
      const changed = [...ids, ...growFrames(next, ids)];
      undoStack.push(pick(before, changed));
      deps.tween?.(positionsOf(pick(before, ids)));
      await wc.set(pick(next, changed));
    },
  };

  const undo: Command<object, void> = {
    name: 'canvas.undo',
    title: 'SILK.Commands.canvas.undo',
    available: (ctx) => ctx.isGM && undoStack.length > 0,
    async run() {
      const restore = undoStack.pop();
      if (!restore) return;
      const wc = deps.workingCopy();
      // Records deleted since are not brought back.
      const alive = restore.filter((r) => wc.get(r.id));
      deps.tween?.(
        positionsOf(
          pick(
            wc.records(),
            alive.map((r) => r.id),
          ),
        ),
      );
      await wc.set(alive);
    },
  };

  return [group, ungroup, renameGroup, untangle, undo];
}
