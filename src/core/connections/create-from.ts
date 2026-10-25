/**
 * `element.create` with `from` (spec §5 create-from defaults, §10.3): an `afterCreate`
 * hook that connects the new element to its origin via `connection.create`.
 */
import { readElement, type ElementCommandDeps, type ElementClassId } from '../elements';
import type { WorkingCopy } from '../working-copy';
import type { ConnectionCreateArgs, RelativeDirection } from './commands';
import type { ConnectionType } from './connection';
import { createFromDefault } from './rules';

type AfterCreate = NonNullable<ElementCommandDeps['afterCreate']>[number];

/** `element.create`'s `connection` arg: direction is relative to the origin. */
export interface CreateFromConnection {
  type?: ConnectionType;
  direction?: RelativeDirection;
  label?: string;
}

/**
 * The Connection args from origin to the new element. An explicit direction keeps the
 * default Behavioural type only when that type points the same way; otherwise free-form.
 */
export function resolveCreateFrom(
  origin: ElementClassId,
  created: ElementClassId,
  wanted: CreateFromConnection = {},
): Omit<ConnectionCreateArgs, 'from' | 'to'> {
  const label = wanted.label === undefined ? {} : { label: wanted.label };
  if (wanted.type) return { type: wanted.type, direction: wanted.direction ?? 'out', ...label };
  const fallback = createFromDefault(origin, created);
  const way: RelativeDirection | undefined = fallback && (fallback.reverse ? 'in' : 'out');
  if (fallback && (wanted.direction === undefined || wanted.direction === way))
    return { type: fallback.type, direction: way, ...label };
  return { type: 'free', direction: wanted.direction ?? 'out', ...label };
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
