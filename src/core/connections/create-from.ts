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
  /** Explicit (a modifier, a pick): kept as asked. Undefined: the default (below). */
  direction?: RelativeDirection;
  label?: string;
  /**
   * The gesture started on the new element (right-drag canvas → Node, v1.1 §A): a free-form
   * default points new → origin instead of origin → new.
   */
  newFirst?: boolean;
}

interface End {
  id: string;
  class: ElementClassId;
}

/**
 * The `connection.create` args for a new element and its origin, the same for every gesture.
 * Explicit direction: as asked, never swapped. Without a direction, a Behavioural default is
 * asked new → origin (v1 §5: a new Location sits inside its origin; `connection.create` swaps
 * it where only origin → new is valid, v1.1 §F.3); free-form points origin → new (`newFirst`:
 * new → origin).
 */
export function resolveCreateFrom(
  origin: End,
  created: End,
  { newFirst, ...wanted }: CreateFromConnection = {},
): ConnectionCreateArgs {
  const towardsOrigin =
    wanted.direction === undefined &&
    (!!newFirst || (!wanted.type && !!defaultConnection(created.class, origin.class)));
  return towardsOrigin
    ? { ...wanted, from: created.id, to: origin.id }
    : { ...wanted, from: origin.id, to: created.id };
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
      origin,
      element,
      args.connection as CreateFromConnection | undefined,
    );
    const { id } = (await deps.run('connection.create', connection)) as { id: string };
    return { connectionId: id };
  };
}
