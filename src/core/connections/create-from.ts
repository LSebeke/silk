/**
 * `element.create` with `from` (spec §5 create-from defaults, §10.3): an `afterCreate`
 * hook that connects the new element to its origin via `connection.create`.
 */
import { readElement, type ElementCommandDeps, type ElementClassId } from '../elements';
import type { WorkingCopy } from '../working-copy';
import type { ConnectionCreateArgs, RelativeDirection } from './commands';
import type { ConnectionType } from './connection';
import { defaultConnection } from './rules';

type AfterCreate = NonNullable<ElementCommandDeps['afterCreate']>[number];

/** `element.create`'s `connection` arg: direction is relative to the origin. */
export interface CreateFromConnection {
  type?: ConnectionType;
  direction?: RelativeDirection;
  label?: string;
}

/**
 * The `connection.create` args from origin to the new element; without a type, it picks the
 * default Connection (v1.1 §F.3). Without type and direction, a Behavioural default is asked
 * new → origin (v1 §5: a new Location sits inside its origin); otherwise origin → new.
 */
export function resolveCreateFrom(
  origin: ElementClassId,
  created: ElementClassId,
  wanted: CreateFromConnection = {},
): Omit<ConnectionCreateArgs, 'from' | 'to'> {
  const fallback: RelativeDirection =
    !wanted.type && defaultConnection(created, origin) ? 'in' : 'out';
  return { ...wanted, direction: wanted.direction ?? fallback };
}

export function connectOnCreate(deps: {
  workingCopy(): WorkingCopy;
  run(name: string, args: object): Promise<unknown>;
}): AfterCreate {
  return async (element, args) => {
    if (!args.from) return undefined;
    const origin = readElement(deps.workingCopy().get(args.from));
    if (!origin) return undefined;
    const connection = resolveCreateFrom(
      origin.class,
      element.class,
      args.connection as CreateFromConnection | undefined,
    );
    const { id } = (await deps.run('connection.create', {
      from: origin.id,
      to: element.id,
      ...connection,
    })) as { id: string };
    return { connectionId: id };
  };
}
