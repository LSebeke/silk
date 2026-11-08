/** Connection commands (spec §15, "Connections"). */
import type { Command } from '../commands/registry';
import { readElement } from '../elements';
import type { WorkingCopy } from '../working-copy';
import {
  BEHAVIOURAL_TYPES,
  connectionRecord,
  readConnection,
  type Connection,
  type ConnectionData,
  type ConnectionDirection,
  type ConnectionType,
} from './connection';
import { check, duplicateOf, typeOptions } from './rules';

/** Direction relative to `from`: out = from → to (default), in = to → from. */
export type RelativeDirection = 'out' | 'in' | 'mutual';

export interface ConnectionCreateArgs {
  from: string;
  to: string;
  type?: ConnectionType;
  direction?: RelativeDirection;
  label?: string;
}

export interface ConnectionCommandDeps {
  workingCopy(): WorkingCopy;
  newId(): string;
}

const isType = (t: unknown): t is ConnectionType =>
  t === 'free' || (BEHAVIOURAL_TYPES as readonly unknown[]).includes(t);

export function connectionCommands(deps: ConnectionCommandDeps): Command[] {
  /** Validate and write `data` as Connection `id`, replacing what it conflicts with. */
  async function store(id: string, data: ConnectionData) {
    const wc = deps.workingCopy();
    const result = check(wc.records(), data, id);
    if (!result.ok) throw new Error(`Silk: ${result.reason}`);
    await wc.set([connectionRecord(id, data)]);
    if (result.replaces.length) await wc.delete(result.replaces);
  }

  function existing(id: string): Connection {
    const connection = readConnection(deps.workingCopy().get(id));
    if (!connection) throw new Error(`Silk: no Connection "${id}"`);
    return connection;
  }

  // Every data field (also `notes`) carries over; only the id goes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const strip = ({ id: _, ...data }: Connection): ConnectionData => data;

  const create: Command<ConnectionCreateArgs, { id: string }> = {
    name: 'connection.create',
    title: 'SILK.Commands.connection.create',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const wc = deps.workingCopy();
      for (const end of [args.from, args.to])
        if (!readElement(wc.get(end))) throw new Error(`Silk: no element "${end}"`);
      if (args.from === args.to) throw new Error('Silk: an element cannot connect to itself');
      const type = args.type ?? 'free';
      if (!isType(type)) throw new Error(`Silk: unknown Connection type "${String(type)}"`);
      const reverse = args.direction === 'in';
      const data: ConnectionData = {
        from: reverse ? args.to : args.from,
        to: reverse ? args.from : args.to,
        type,
        direction: args.direction === 'mutual' ? 'mutual' : 'directed',
        label: type === 'free' ? (args.label ?? '').trim() : '',
      };
      const duplicate = check(wc.records(), data).ok && duplicateOf(wc.records(), data);
      if (duplicate) return { id: duplicate.id };
      const id = deps.newId();
      await store(id, data);
      return { id };
    },
  };

  const setLabel: Command<{ id: string; label: string }, void> = {
    name: 'connection.setLabel',
    title: 'SILK.Commands.connection.setLabel',
    available: (ctx) => ctx.isGM,
    async run({ id, label }) {
      const c = existing(id);
      if (c.type !== 'free') return;
      await deps.workingCopy().set([connectionRecord(id, { ...strip(c), label: label.trim() })]);
    },
  };

  const setNotes: Command<{ id: string; notes: string }, void> = {
    name: 'connection.setNotes',
    title: 'SILK.Commands.connection.setNotes',
    available: (ctx) => ctx.isGM,
    async run({ id, notes }) {
      const c = existing(id);
      await deps.workingCopy().set([connectionRecord(id, { ...strip(c), notes })]);
    },
  };

  /** Ends in id order (A < B). */
  const ordered = (c: Connection): [string, string] =>
    c.from < c.to ? [c.from, c.to] : [c.to, c.from];

  /** Free-form only: writes `direction` with endpoints `ends` (default: unchanged). */
  async function writeDirection(
    c: Connection,
    direction: ConnectionDirection,
    [from, to]: [string, string] = [c.from, c.to],
  ) {
    if (c.type !== 'free') return;
    if (c.direction === direction && c.from === from && c.to === to) return;
    await deps.workingCopy().set([connectionRecord(c.id, { ...strip(c), direction, from, to })]);
  }

  /** Writes `type` if `typeOptions` offers it, replacing what it conflicts with. */
  async function writeType(c: Connection, type: ConnectionType) {
    const options = typeOptions(deps.workingCopy().records(), c);
    if (!options.length) throw new Error(`Silk: Connection "${c.id}" has a missing endpoint`);
    if (!options.includes(type))
      throw new Error(`Silk: Connection "${c.id}" cannot be ${String(type)}`);
    if (type === c.type) return;
    await store(c.id, {
      ...strip(c),
      type,
      direction: type === 'free' ? c.direction : 'directed',
      label: type === 'free' ? c.label : '',
    });
  }

  /** v1.1 §F.2 select. Mutual → directed points in id order (A→B); directed stays as is. */
  const setDirection: Command<{ id: string; direction: ConnectionDirection }, void> = {
    name: 'connection.setDirection',
    title: 'SILK.Commands.connection.setDirection',
    available: (ctx) => ctx.isGM,
    async run({ id, direction }) {
      const c = existing(id);
      if (direction !== 'directed' && direction !== 'mutual')
        throw new Error(`Silk: unknown direction "${String(direction)}"`);
      if (c.direction === direction) return;
      await writeDirection(c, direction, direction === 'directed' ? ordered(c) : undefined);
    },
  };

  /** v1.1 §F.2 select: one of `typeOptions`. */
  const setType: Command<{ id: string; type: ConnectionType }, void> = {
    name: 'connection.setType',
    title: 'SILK.Commands.connection.setType',
    available: (ctx) => ctx.isGM,
    run: ({ id, type }) => writeType(existing(id), type),
  };

  const cycleType: Command<{ id: string }, void> = {
    name: 'connection.cycleType',
    title: 'SILK.Commands.connection.cycleType',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      const options = typeOptions(deps.workingCopy().records(), c);
      if (!options.length) throw new Error(`Silk: Connection "${id}" has a missing endpoint`);
      await writeType(c, options[(options.indexOf(c.type) + 1) % options.length] ?? 'free');
    },
  };

  const flip: Command<{ id: string }, void> = {
    name: 'connection.flip',
    title: 'SILK.Commands.connection.flip',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      const next = { ...strip(c), from: c.to, to: c.from };
      if (c.type !== 'free' && !check(deps.workingCopy().records(), next, id).ok)
        throw new Error(`Silk: cannot flip ${c.type}: the reversed pair is not valid`);
      await store(id, next);
    },
  };

  const remove: Command<{ ids: string[] }, void> = {
    name: 'connection.delete',
    title: 'SILK.Commands.connection.delete',
    available: (ctx) => ctx.isGM,
    async run({ ids }) {
      const wc = deps.workingCopy();
      const doomed = ids.filter((id) => readConnection(wc.get(id)));
      if (doomed.length) await wc.delete(doomed);
    },
  };

  return [create, setLabel, setNotes, setDirection, setType, cycleType, flip, remove];
}
