/**
 * Canvas-local keys (spec §10.3). Handled on the canvas root, not as Foundry keybindings:
 * digits are Foundry's hotbar keys, and the canvas may live in a detached window.
 * Pure: event + what is selected → action.
 */
import type { CreateFromConnection } from '../../core/connections';
import { ELEMENT_CLASSES, type ElementClassId } from '../../core/elements';

export type CanvasKeyAction =
  | { kind: 'create'; class: ElementClassId; connection?: CreateFromConnection }
  | { kind: 'connect' }
  | { kind: 'rename' }
  | { kind: 'editConnection' }
  | { kind: 'command'; name: 'connection.cycleDirection' | 'connection.cycleType' }
  | { kind: 'layout'; name: 'canvas.group' | 'canvas.untangle' | 'canvas.undo' };

export interface KeyLike {
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function canvasKey(
  e: KeyLike,
  selected: { node: boolean; edge: boolean },
): CanvasKeyAction | undefined {
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
  if (digit && !e.metaKey) {
    const cls = ELEMENT_CLASSES[Number(digit) - 1];
    if (!cls?.creatable) return undefined;
    const connection: CreateFromConnection | undefined = e.shiftKey
      ? { direction: 'in' }
      : e.ctrlKey
        ? { direction: 'mutual' }
        : e.altKey
          ? { type: 'free', direction: 'out' }
          : undefined;
    return { kind: 'create', class: cls.id, ...(connection ? { connection } : {}) };
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyZ')
    return { kind: 'layout', name: 'canvas.undo' };
  if (e.ctrlKey || e.altKey || e.metaKey) return undefined;
  if (e.code === 'F2')
    return selected.edge
      ? { kind: 'editConnection' }
      : selected.node
        ? { kind: 'rename' }
        : undefined;
  if (e.shiftKey) return undefined;
  if (e.code === 'KeyC' && selected.node) return { kind: 'connect' };
  if (e.code === 'KeyG' && selected.node) return { kind: 'layout', name: 'canvas.group' };
  if (e.code === 'KeyU' && selected.node) return { kind: 'layout', name: 'canvas.untangle' };
  if (e.code === 'Tab' && selected.edge)
    return { kind: 'command', name: 'connection.cycleDirection' };
  if (e.code === 'KeyQ' && selected.edge) return { kind: 'command', name: 'connection.cycleType' };
  return undefined;
}
