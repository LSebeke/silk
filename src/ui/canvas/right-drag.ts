/**
 * Right-click / right-drag on the canvas (spec 1.1 §A): where the press starts and ends
 * decides the result. Pure: the start's pointer target, the end Node (undefined = canvas),
 * modifiers at release.
 * Connections are relative to the pipeline origin (`from`), as `element.create` expects.
 */
import type { CreateFromConnection, RelativeDirection } from '../../core/connections';
import { modifierConnection, type Modifiers } from './keys';
import { connectionOf, type PointerTarget } from './pointer-target';

export type RightDragAction =
  | { kind: 'nodeMenu'; id: string }
  /** A press on an edge or its label: that Connection's context menu (§F.1). */
  | { kind: 'edgeMenu'; id: string }
  | { kind: 'connect'; from: string; to: string; connection: CreateFromConnection }
  /** `at`: the drop point (`end`) or the press point (`start`). */
  | { kind: 'create'; at: 'start' | 'end'; from?: string; connection?: CreateFromConnection };

export interface RightDragGesture {
  start: 'node' | 'canvas' | 'edge';
  end: 'sameNode' | 'otherNode' | 'node' | 'canvas' | 'anywhere';
  /** What `rightDragAction` returns for it. `edge`: the edge or its label. */
  result: RightDragAction['kind'];
  /** i18n key. */
  label: string;
}

const gesture = (
  start: RightDragGesture['start'],
  end: RightDragGesture['end'],
  result: RightDragGesture['result'],
): RightDragGesture => ({ start, end, result, label: `SILK.Canvas.Gesture.${start}-${end}` });

/**
 * The §A table, for the legend (1.1 §E.3). `rightDragAction` decides every row
 * (right-drag.test.ts checks each `result` against it). Modifiers: `MODIFIER_CONNECTIONS`.
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
  target: PointerTarget,
  end: string | undefined,
  mods: Modifiers,
): RightDragAction {
  // Never the Creation Pipeline from an edge or its label (#138).
  const edge = connectionOf(target);
  if (edge) return { kind: 'edgeMenu', id: edge };
  const start = target.kind === 'node' ? target.id : undefined;
  // A modifier picks an explicit direction (from the start of the drag, as the digit keys).
  // None: the default, outgoing from the start, which the default Connection may swap and
  // which gives a new element the same Connection as the palette (v1 §5, v1.1 §F.3).
  const picked = modifierConnection(mods);
  const connection = picked ?? {};
  if (start && start === end) return { kind: 'nodeMenu', id: start };
  if (start && end) return { kind: 'connect', from: start, to: end, connection };
  if (start) return { kind: 'create', at: 'end', from: start, connection };
  // The new element is the start: seen from B, the direction flips.
  if (end) {
    const seenFromB: CreateFromConnection = picked?.direction
      ? { ...picked, direction: REVERSE[picked.direction] }
      : { ...connection, newFirst: true };
    return { kind: 'create', at: 'start', from: end, connection: seenFromB };
  }
  return { kind: 'create', at: 'start' };
}
