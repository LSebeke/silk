/** Connection commands (spec §15, "Connections"). */
import type { Command } from '../commands/registry';
import { readElement } from '../elements';
import type { WorkingCopy } from '../working-copy';
import {
  BEHAVIOURAL_TYPES,
  connectionRecord,
  otherDirection,
  readConnection,
  togglesDirection,
  type Connection,
  type ConnectionData,
  type ConnectionDirection,
  type ConnectionType,
} from './connection';
import { check, defaultConnection, duplicateOf, typeOptions } from './rules';

/** Direction relative to `from`: out = from → to (default), in = to → from. */
export type RelativeDirection = 'out' | 'in' | 'mutual';

export interface ConnectionCreateArgs {
  from: string;
  to: string;
  type?: ConnectionType;
  /**
   * Explicit (a modifier, a pick): the pair stays as asked. Undefined (no modifier): from →
   * to, and the default Connection may swap it (v1.1 §F.3).
   */
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
    if (!result.ok) throw new Error(`Garn: ${result.reason}`);
    await wc.set([connectionRecord(id, data)]);
    if (result.replaces.length) await wc.delete(result.replaces);
  }

  function existing(id: string): Connection {
    const connection = readConnection(deps.workingCopy().get(id));
    if (!connection) throw new Error(`Garn: no Connection "${id}"`);
    return connection;
  }

  // Every data field (also `notes`) carries over; only the id goes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
  const strip = ({ id: _, ...data }: Connection): ConnectionData => data;

  const create: Command<ConnectionCreateArgs, { id: string }> = {
    name: 'connection.create',
    title: 'GARN.Commands.connection.create',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const wc = deps.workingCopy();
      const classOf = (end: string) => {
        const element = readElement(wc.get(end));
        if (!element) throw new Error(`Garn: no element "${end}"`);
        return element.class;
      };
      const requireEnds = (...ends: string[]) => ends.forEach(classOf);
      requireEnds(args.from, args.to);
      if (args.from === args.to) throw new Error('Garn: an element cannot connect to itself');
      if (args.type !== undefined && !isType(args.type))
        throw new Error(`Garn: unknown Connection type "${String(args.type)}"`);
      const mutual = args.direction === 'mutual';
      // The asked pair. Without a type, the default Connection (v1.1 §F.3); only without a
      // direction (no modifier) may it swap the pair. An explicit direction it does not fit
      // is free-form.
      let [from, to] = args.direction === 'in' ? [args.to, args.from] : [args.from, args.to];
      let type = args.type ?? 'free';
      const fallback =
        args.type === undefined && !mutual
          ? defaultConnection(classOf(from), classOf(to))
          : undefined;
      if (fallback && (!fallback.reverse || args.direction === undefined)) {
        type = fallback.type;
        if (fallback.reverse) [from, to] = [to, from];
      }
      const data: ConnectionData = {
        from,
        to,
        type,
        direction: mutual ? 'mutual' : 'directed',
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
    title: 'GARN.Commands.connection.setLabel',
    available: (ctx) => ctx.isGM,
    async run({ id, label }) {
      const c = existing(id);
      if (c.type !== 'free') return;
      await deps.workingCopy().set([connectionRecord(id, { ...strip(c), label: label.trim() })]);
    },
  };

  const setNotes: Command<{ id: string; notes: string }, void> = {
    name: 'connection.setNotes',
    title: 'GARN.Commands.connection.setNotes',
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
    if (!togglesDirection(c)) return;
    if (c.direction === direction && c.from === from && c.to === to) return;
    await deps.workingCopy().set([connectionRecord(c.id, { ...strip(c), direction, from, to })]);
  }

  /** Writes `type` if `typeOptions` offers it, replacing what it conflicts with. */
  async function writeType(c: Connection, type: ConnectionType) {
    const options = typeOptions(deps.workingCopy().records(), c);
    if (!options.length) throw new Error(`Garn: Connection "${c.id}" has a missing endpoint`);
    if (!options.includes(type))
      throw new Error(`Garn: Connection "${c.id}" cannot be ${String(type)}`);
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
    title: 'GARN.Commands.connection.setDirection',
    available: (ctx) => ctx.isGM,
    async run({ id, direction }) {
      const c = existing(id);
      if (direction !== 'directed' && direction !== 'mutual')
        throw new Error(`Garn: unknown direction "${String(direction)}"`);
      if (c.direction === direction) return;
      await writeDirection(c, direction, direction === 'directed' ? ordered(c) : undefined);
    },
  };

  /**
   * v1.1 §F.1 Directed ⇄ Mutual (`Tab`, edge menu, the label editor's button): the other
   * direction, as `setDirection`; never reverses. A no-op on a Behavioural Connection.
   */
  const toggleDirection: Command<{ id: string }, void> = {
    name: 'connection.toggleDirection',
    title: 'GARN.Commands.connection.toggleDirection',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      if (!togglesDirection(c)) return;
      await setDirection.run({ id, direction: otherDirection(c.direction) });
    },
  };

  /** v1.1 §F.2 select: one of `typeOptions`. */
  const setType: Command<{ id: string; type: ConnectionType }, void> = {
    name: 'connection.setType',
    title: 'GARN.Commands.connection.setType',
    available: (ctx) => ctx.isGM,
    run: ({ id, type }) => writeType(existing(id), type),
  };

  const cycleType: Command<{ id: string }, void> = {
    name: 'connection.cycleType',
    title: 'GARN.Commands.connection.cycleType',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      const options = typeOptions(deps.workingCopy().records(), c);
      if (!options.length) throw new Error(`Garn: Connection "${id}" has a missing endpoint`);
      await writeType(c, options[(options.indexOf(c.type) + 1) % options.length] ?? 'free');
    },
  };

  const flip: Command<{ id: string }, void> = {
    name: 'connection.flip',
    title: 'GARN.Commands.connection.flip',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      const next = { ...strip(c), from: c.to, to: c.from };
      if (c.type !== 'free' && !check(deps.workingCopy().records(), next, id).ok)
        throw new Error(`Garn: cannot flip ${c.type}: the reversed pair is not valid`);
      await store(id, next);
    },
  };

  const remove: Command<{ ids: string[] }, void> = {
    name: 'connection.delete',
    title: 'GARN.Commands.connection.delete',
    available: (ctx) => ctx.isGM,
    async run({ ids }) {
      const wc = deps.workingCopy();
      const doomed = ids.filter((id) => readConnection(wc.get(id)));
      if (doomed.length) await wc.delete(doomed);
    },
  };

  return [
    create,
    setLabel,
    setNotes,
    setDirection,
    toggleDirection,
    setType,
    cycleType,
    flip,
    remove,
  ];
}
