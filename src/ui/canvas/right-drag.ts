/**
 * Right-click / right-drag on the canvas (spec 1.1 §A): where the press starts and ends
 * decides the result. Pure: start Node, end Node (undefined = canvas), modifiers at release.
 * Directions are relative to the pipeline origin (`from`), as `element.create` expects.
 */
import type { RelativeDirection } from '../../core/connections';

export type RightDragAction =
  | { kind: 'nodeMenu'; id: string }
  | { kind: 'connect'; from: string; to: string; direction: RelativeDirection }
  /** `at`: the drop point (`end`) or the press point (`start`). */
  | { kind: 'create'; at: 'start' | 'end'; from?: string; direction?: RelativeDirection };

export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
}

/** From the start of the drag: default outgoing, Shift = incoming, Alt = mutual. */
const directionOf = (m: Modifiers): RelativeDirection =>
  m.shiftKey ? 'in' : m.altKey ? 'mutual' : 'out';

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
  const direction = directionOf(mods);
  if (start && start === end) return { kind: 'nodeMenu', id: start };
  if (start && end) return { kind: 'connect', from: start, to: end, direction };
  if (start) return { kind: 'create', at: 'end', from: start, direction };
  // The new element is the start: seen from B, the direction flips.
  if (end) return { kind: 'create', at: 'start', from: end, direction: REVERSE[direction] };
  return { kind: 'create', at: 'start' };
}
