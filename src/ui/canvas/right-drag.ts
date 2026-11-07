/**
 * Right-click / right-drag on the canvas (spec 1.1 §A): where the press starts and ends
 * decides the result. Pure: start Node, end Node (undefined = canvas), modifiers at release.
 * Connections are relative to the pipeline origin (`from`), as `element.create` expects.
 */
import type { CreateFromConnection, RelativeDirection } from '../../core/connections';
import { modifierConnection, type Modifiers } from './keys';

export type RightDragAction =
  | { kind: 'nodeMenu'; id: string }
  | { kind: 'connect'; from: string; to: string; connection: CreateFromConnection }
  /** `at`: the drop point (`end`) or the press point (`start`). */
  | { kind: 'create'; at: 'start' | 'end'; from?: string; connection?: CreateFromConnection };

const REVERSE: Record<RelativeDirection, RelativeDirection> = {
  out: 'in',
  in: 'out',
  mutual: 'mutual',
};

export function rightDragAction(
  start: string | undefined,
  end: string | undefined,
  mods: Modifiers,
): RightDragAction {
  // From the start of the drag, as the digit keys: default outgoing.
  const connection = modifierConnection(mods) ?? { direction: 'out' };
  if (start && start === end) return { kind: 'nodeMenu', id: start };
  if (start && end) return { kind: 'connect', from: start, to: end, connection };
  if (start) return { kind: 'create', at: 'end', from: start, connection };
  // The new element is the start: seen from B, the direction flips.
  if (end) {
    const direction = REVERSE[connection.direction ?? 'out'];
    return { kind: 'create', at: 'start', from: end, connection: { ...connection, direction } };
  }
  return { kind: 'create', at: 'start' };
}
