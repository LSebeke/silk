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

export interface RightDragGesture {
  start: 'node' | 'canvas' | 'edge';
  end: 'sameNode' | 'otherNode' | 'node' | 'canvas' | 'anywhere';
  /** What `rightDragAction` returns for it; `edgeMenu`: the edge's own context menu. */
  result: RightDragAction['kind'] | 'edgeMenu';
  /** i18n key. */
  label: string;
}

const gesture = (
  start: RightDragGesture['start'],
  end: RightDragGesture['end'],
  result: RightDragGesture['result'],
): RightDragGesture => ({ start, end, result, label: `SILK.Canvas.Gesture.${start}-${end}` });

/**
 * The §A table, for the legend (1.1 §E.3). `rightDragAction` decides the Node/canvas rows
 * (right-drag.test.ts checks each `result` against it); the edge row is the edge's own
 * context menu. Modifiers: `MODIFIER_CONNECTIONS`.
 */
export const RIGHT_DRAG_GESTURES: readonly RightDragGesture[] = [
  gesture('node', 'sameNode', 'nodeMenu'),
  gesture('node', 'otherNode', 'connect'),
  gesture('node', 'canvas', 'create'),
  gesture('canvas', 'canvas', 'create'),
  gesture('canvas', 'node', 'create'),
  gesture('edge', 'anywhere', 'edgeMenu'),
];

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
