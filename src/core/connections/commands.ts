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
  type ConnectionType,
} from './connection';
import { check, duplicateOf, validTypes } from './rules';

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

  const strip = ({ from, to, type, direction, label }: Connection): ConnectionData => ({
    from,
    to,
    type,
    direction,
    label,
  });

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

  const cycleDirection: Command<{ id: string }, void> = {
    name: 'connection.cycleDirection',
    title: 'SILK.Commands.connection.cycleDirection',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      if (c.type !== 'free') return;
      // Stateless 3-cycle over id order (A < B): A→B, B→A, mutual, A→B, …
      const [a, b] = c.from < c.to ? [c.from, c.to] : [c.to, c.from];
      const next: ConnectionData =
        c.direction === 'mutual'
          ? { ...strip(c), from: a, to: b, direction: 'directed' }
          : c.from === a
            ? { ...strip(c), from: b, to: a }
            : { ...strip(c), direction: 'mutual' };
      await deps.workingCopy().set([connectionRecord(id, next)]);
    },
  };

  const cycleType: Command<{ id: string }, void> = {
    name: 'connection.cycleType',
    title: 'SILK.Commands.connection.cycleType',
    available: (ctx) => ctx.isGM,
    async run({ id }) {
      const c = existing(id);
      const wc = deps.workingCopy();
      const from = readElement(wc.get(c.from));
      const to = readElement(wc.get(c.to));
      if (!from || !to) throw new Error(`Silk: Connection "${id}" has a missing endpoint`);
      const options: ConnectionType[] = [
        ...validTypes(from.class, to.class).filter(
          (type) => check(wc.records(), { ...strip(c), type, direction: 'directed' }, id).ok,
        ),
        'free',
      ];
      const type = options[(options.indexOf(c.type) + 1) % options.length] ?? 'free';
      if (type === c.type) return;
      await store(id, {
        ...strip(c),
        type,
        direction: type === 'free' ? c.direction : 'directed',
        label: type === 'free' ? c.label : '',
      });
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

  return [create, setLabel, cycleDirection, cycleType, flip, remove];
}
