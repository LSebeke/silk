/**
 * Canvas legend (spec 1.1 §E.3). Built from the tables the canvas runs on (`CANVAS_KEYS`,
 * `POINTER_GESTURES`, `RIGHT_DRAG_GESTURES`, `MODIFIER_CONNECTIONS`) and the live Foundry keybindings, so it
 * cannot drift from the code. Pure: rows carry i18n keys; the component localises.
 */
import type { LiveKeybinding } from '../../adapter/keybindings';
import type { Command } from '../../core/commands/registry';
import { classLabelKey } from '../../core/elements';
import {
  CANVAS_KEYS,
  KEY_CONDITION_LABELS,
  MODIFIER_CONNECTIONS,
  type CanvasKeyBinding,
  type KeyModifiers,
} from './keys';
import { POINTER_GESTURES } from './pointer-target';
import { RIGHT_DRAG_GESTURES } from './right-drag';

export interface LegendRow {
  /** Display strings, e.g. `Ctrl+F`; empty when the label says it all. */
  keys: readonly string[];
  /** i18n key. */
  label: string;
  /** `{name}` placeholders → i18n keys. */
  args?: Record<string, string>;
  /** i18n key of the selection the key needs. */
  when?: string;
  /** A sub-heading inside its group. */
  heading?: true;
}

export interface LegendGroup {
  id: 'keys' | 'mouse' | 'foundry';
  title: string;
  rows: LegendRow[];
}

const KEY_NAMES: Partial<Record<string, string>> = { Delete: 'Del' };

/** `KeyboardEvent.code` → label, as Foundry shows codes; Numpad digits fold into digits. */
function codeName(code: string): string {
  return KEY_NAMES[code] ?? code.replace(/^(Digit|Numpad(?=\d)|Key)/, '');
}

const MOD_PREFIX: Partial<Record<KeyModifiers, string>> = { primary: 'Ctrl+', shift: 'Shift+' };

function keyRow(b: CanvasKeyBinding): LegendRow {
  const prefix = MOD_PREFIX[b.mods] ?? '';
  const keys = [...new Set([...b.codes.map(codeName), ...(b.keys ?? [])])].map((k) => prefix + k);
  return {
    keys,
    label: b.label,
    ...(b.action.kind === 'create' ? { args: { class: classLabelKey(b.action.class) } } : {}),
    ...(b.when === 'always' ? {} : { when: KEY_CONDITION_LABELS[b.when] }),
  };
}

export function legendGroups(foundry: readonly LiveKeybinding[]): LegendGroup[] {
  return [
    { id: 'keys', title: 'SILK.Legend.Keys', rows: CANVAS_KEYS.map(keyRow) },
    {
      id: 'mouse',
      title: 'SILK.Legend.Mouse',
      rows: [
        ...[...POINTER_GESTURES, ...RIGHT_DRAG_GESTURES].map((g) => ({ keys: [], label: g.label })),
        { keys: [], label: 'SILK.Legend.Modifiers', heading: true },
        ...MODIFIER_CONNECTIONS.map((m) => ({ keys: [], label: m.label })),
      ],
    },
    {
      id: 'foundry',
      title: 'SILK.Legend.Foundry',
      rows: foundry.map((b) => ({ keys: b.keys, label: b.title })),
    },
  ];
}

/** Open/closed, a client setting (§E.3). Svelte-store `subscribe`. */
export interface LegendState {
  get(): boolean;
  set(open: boolean): Promise<void>;
  subscribe(fn: (open: boolean) => void): () => void;
}

export function createLegendState(setting: {
  get(): boolean;
  set(open: boolean): Promise<unknown>;
}): LegendState {
  const subscribers = new Set<(open: boolean) => void>();
  return {
    get: () => setting.get(),
    async set(open) {
      await setting.set(open);
      for (const fn of subscribers) fn(open);
    },
    subscribe(fn) {
      subscribers.add(fn);
      fn(setting.get());
      return () => subscribers.delete(fn);
    },
  };
}

/** `legend.toggle { open? }` (§D): without `open`, flips it. */
export function legendCommands(state: LegendState): Command[] {
  const toggle: Command<{ open?: boolean } | undefined, { open: boolean }> = {
    name: 'legend.toggle',
    title: 'SILK.Commands.legend.toggle',
    available: (ctx) => ctx.isGM,
    async run(args) {
      const open = args?.open ?? !state.get();
      await state.set(open);
      return { open };
    },
  };
  return [toggle as Command];
}
