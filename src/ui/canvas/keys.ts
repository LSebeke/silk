/**
 * Canvas-local keys (spec §10.3). Handled on the canvas root, not as Foundry keybindings:
 * digits are Foundry's hotbar keys, and the canvas may live in a detached window.
 * Pure: event + what is selected → action.
 */
import type { CreateFromConnection } from '../../core/connections';
import { ELEMENT_CLASSES, type ElementClassId, type SourceKind } from '../../core/elements';

export type CanvasKeyAction =
  | { kind: 'create'; class: ElementClassId; connection?: CreateFromConnection }
  | { kind: 'connect' }
  | { kind: 'search' }
  | { kind: 'rename' }
  | { kind: 'status' }
  | { kind: 'pin' }
  | { kind: 'reveal' }
  | { kind: 'editConnection' }
  | { kind: 'delete' }
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

/** Held modifiers of a key or pointer event. */
export type Modifiers = Pick<KeyLike, 'shiftKey' | 'ctrlKey' | 'altKey'>;

/**
 * The Connection a modifier picks (digit keys, right-drag release; spec §10.3, 1.1 §A),
 * relative to the origin. First held wins.
 */
export const MODIFIER_CONNECTIONS: readonly {
  modifier: keyof Modifiers;
  connection: CreateFromConnection;
  label: string;
}[] = [
  { modifier: 'shiftKey', connection: { direction: 'in' }, label: 'SILK.Canvas.Modifier.shift' },
  { modifier: 'ctrlKey', connection: { direction: 'mutual' }, label: 'SILK.Canvas.Modifier.ctrl' },
  {
    modifier: 'altKey',
    connection: { type: 'free', direction: 'out' },
    label: 'SILK.Canvas.Modifier.alt',
  },
];

/** Undefined = no modifier (the default). */
export function modifierConnection(m: Modifiers): CreateFromConnection | undefined {
  return MODIFIER_CONNECTIONS.find((c) => m[c.modifier])?.connection;
}

export interface Selected {
  node: boolean;
  edge: boolean;
}

/** What must be selected for a key to act. */
export type KeyCondition = 'always' | 'node' | 'edge' | 'nodeOrEdge';

export const KEY_CONDITION_LABELS: Record<KeyCondition, string> = {
  always: 'SILK.Canvas.KeyWhen.always',
  node: 'SILK.Canvas.KeyWhen.node',
  edge: 'SILK.Canvas.KeyWhen.edge',
  nodeOrEdge: 'SILK.Canvas.KeyWhen.nodeOrEdge',
};

const MET: Record<KeyCondition, (s: Selected) => boolean> = {
  always: () => true,
  node: (s) => s.node,
  edge: (s) => s.edge,
  nodeOrEdge: (s) => s.node || s.edge,
};

/**
 * Modifiers a key accepts:
 * - `none`: no modifier.
 * - `shiftOk`: Shift or none.
 * - `primary`: Ctrl or Cmd, without Shift/Alt.
 * - `connection`: any of Shift/Ctrl/Alt, which pick the Connection (`MODIFIER_CONNECTIONS`); no Cmd.
 */
export type KeyModifiers = 'none' | 'shiftOk' | 'primary' | 'connection';

const ACCEPTS: Record<KeyModifiers, (e: KeyLike) => boolean> = {
  none: (e) => !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey,
  shiftOk: (e) => !e.ctrlKey && !e.altKey && !e.metaKey,
  primary: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey,
  connection: (e) => !e.metaKey,
};

export interface CanvasKeyBinding {
  /** `KeyboardEvent.code` values. */
  codes: readonly string[];
  mods: KeyModifiers;
  when: KeyCondition;
  /** For `create`, the action without a modifier (`canvasKey` adds the Connection). */
  action: CanvasKeyAction;
  /** i18n key; a `create` row's takes `{class}`. */
  label: string;
}

const row = (
  codes: readonly string[],
  when: KeyCondition,
  action: CanvasKeyAction,
  label: string,
  mods: KeyModifiers = 'none',
): CanvasKeyBinding => ({ codes, mods, when, action, label: `SILK.Canvas.Key.${label}` });

/**
 * The canvas keymap (spec §10.3, 1.1 §E): `canvasKey` and the legend read it.
 * First match wins. Player Characters have no digit: they are never created.
 */
export const CANVAS_KEYS: readonly CanvasKeyBinding[] = [
  ...ELEMENT_CLASSES.filter((c) => c.creatable).map((c) =>
    row(
      [`Digit${c.digit}`, `Numpad${c.digit}`],
      'always',
      { kind: 'create', class: c.id },
      'create',
      'connection',
    ),
  ),
  row(['KeyZ'], 'always', { kind: 'layout', name: 'canvas.undo' }, 'undo', 'primary'),
  // Search (§10.8): only while the canvas has focus, so not a Foundry keybinding.
  row(['KeyF'], 'always', { kind: 'search' }, 'search', 'primary'),
  row(['F2'], 'edge', { kind: 'editConnection' }, 'editConnection', 'shiftOk'),
  row(['F2'], 'node', { kind: 'rename' }, 'rename', 'shiftOk'),
  row(['KeyC'], 'node', { kind: 'connect' }, 'connect'),
  row(['KeyS'], 'node', { kind: 'status' }, 'status'),
  row(['KeyP'], 'node', { kind: 'pin' }, 'pin'),
  row(['KeyR'], 'nodeOrEdge', { kind: 'reveal' }, 'reveal'),
  row(['Delete', 'Backspace'], 'node', { kind: 'delete' }, 'delete'),
  row(['KeyG'], 'node', { kind: 'layout', name: 'canvas.group' }, 'group'),
  row(['KeyU'], 'node', { kind: 'layout', name: 'canvas.untangle' }, 'untangle'),
  row(['Tab'], 'edge', { kind: 'command', name: 'connection.cycleDirection' }, 'cycleDirection'),
  row(['KeyQ'], 'edge', { kind: 'command', name: 'connection.cycleType' }, 'cycleType'),
];

export function canvasKey(e: KeyLike, selected: Selected): CanvasKeyAction | undefined {
  const hit = CANVAS_KEYS.find(
    (b) => b.codes.includes(e.code) && ACCEPTS[b.mods](e) && MET[b.when](selected),
  );
  if (hit?.action.kind !== 'create') return hit?.action;
  const connection = modifierConnection(e);
  return connection ? { ...hit.action, connection } : hit.action;
}

/** y/n confirm prompt (§10.3 `s`, `r`): only y confirms; the default is n. */
export function confirmKey(e: Pick<KeyLike, 'code'>): 'yes' | 'no' | undefined {
  if (e.code === 'KeyY') return 'yes';
  if (e.code === 'KeyN' || e.code === 'Enter' || e.code === 'Escape') return 'no';
  return undefined;
}

const SOURCE_KEYS: Partial<Record<string, SourceKind | 'cancel'>> = {
  ArrowUp: 'compendium',
  ArrowLeft: 'generator',
  ArrowRight: 'blank',
  ArrowDown: 'cancel',
};

/** Source Step compass (spec 1.1 §B.1): ↑ Compendium, ← Generator, → Blank, ↓ / Esc cancel. */
export function sourceKey(e: KeyLike): SourceKind | 'cancel' | undefined {
  if (e.code === 'Escape') return 'cancel';
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return undefined;
  return SOURCE_KEYS[e.code];
}
