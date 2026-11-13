/**
 * What a pointer event on the World Canvas lands on (spec 1.1 §F.1, #138): one classifier for
 * right-press, context menu and double-click. xyflow renders edge labels in a portal outside
 * the edge, so the label is found by its own marker (`data-garn-edge`), not by the edge.
 */
export type PointerTarget =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'edgeLabel'; id: string }
  /** Empty canvas; Visual Group frames count as canvas. */
  | { kind: 'pane' };

/** The DOM surface the classifier reads (an `Element`). */
export interface TargetElement {
  closest(selector: string): TargetElement | null;
  getAttribute(name: string): string | null;
}

/** Text fields and the inline Connection editor keep their own pointer handling. */
const OWN_POINTER = 'input, textarea, select, [contenteditable], [data-garn-connection-editor]';

/** `undefined`: not on the canvas (toolbar, menus, overlays) or on a control that owns it. */
export function pointerTarget(target: TargetElement | null): PointerTarget | undefined {
  if (!target?.closest?.('.svelte-flow__pane') || target.closest(OWN_POINTER)) return undefined;
  const node = target.closest('[data-garn-node]')?.getAttribute('data-garn-node');
  if (node) return { kind: 'node', id: node };
  const label = target.closest('[data-garn-edge]')?.getAttribute('data-garn-edge');
  if (label) return { kind: 'edgeLabel', id: label };
  const edge = target.closest('.svelte-flow__edge')?.getAttribute('data-id');
  if (edge) return { kind: 'edge', id: edge };
  return { kind: 'pane' };
}

/** The Connection behind an edge or its label. */
export const connectionOf = (t: PointerTarget | undefined): string | undefined =>
  t && (t.kind === 'edge' || t.kind === 'edgeLabel') ? t.id : undefined;

/** Left/middle-button gestures (xyflow runs the drags), for the legend (§E.3). */
export interface PointerGesture {
  gesture: 'leftDrag' | 'drag' | 'doubleClick';
  /** `edge`: the edge or its label. */
  target: 'node' | 'canvas' | 'edge';
  /** The command a double-click runs with `{ id }`. */
  command?: string;
  /** i18n key. */
  label: string;
}

const pointerGesture = (
  gesture: PointerGesture['gesture'],
  target: PointerGesture['target'],
  command?: string,
): PointerGesture => ({
  gesture,
  target,
  ...(command ? { command } : {}),
  label: `GARN.Canvas.Gesture.${gesture}-${target}`,
});

/** `doubleClickCommand` reads the double-click rows, so the legend cannot drift. */
export const POINTER_GESTURES: readonly PointerGesture[] = [
  pointerGesture('leftDrag', 'node'),
  pointerGesture('drag', 'canvas'),
  pointerGesture('doubleClick', 'node', 'element.openDetail'),
  pointerGesture('doubleClick', 'edge', 'connection.openDetail'),
];

/** What a double-click runs: Element Detail on a Node, Connection Detail on an edge or label. */
export function doubleClickCommand(
  t: PointerTarget | undefined,
): { name: string; args: { id: string } } | undefined {
  if (!t || t.kind === 'pane') return undefined;
  const target = t.kind === 'node' ? 'node' : 'edge';
  const row = POINTER_GESTURES.find((g) => g.gesture === 'doubleClick' && g.target === target);
  return row?.command ? { name: row.command, args: { id: t.id } } : undefined;
}
