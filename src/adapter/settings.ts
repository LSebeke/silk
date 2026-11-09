/** Garn settings (spec §13). Registered on `init` by the adapter. */
import { MODULE_ID } from '../constants';
import { HOODED_DEFAULT } from '../core/portrait';

export interface SettingData {
  scope: 'world' | 'client';
  config: boolean;
  type: typeof String | typeof Number | typeof Boolean | typeof Object;
  default?: unknown;
  name?: string;
  hint?: string;
  choices?: Record<string, string>;
  filePicker?: 'image';
}

export type RegisterSetting = (namespace: typeof MODULE_ID, key: string, data: SettingData) => void;

const label = (key: string) => ({
  name: `GARN.Settings.${key}.Name`,
  hint: `GARN.Settings.${key}.Hint`,
});

export const SETTINGS: Record<string, SettingData> = {
  materializeMode: {
    ...label('materializeMode'),
    scope: 'world',
    config: true,
    type: String,
    default: 'immediate',
    choices: {
      immediate: 'GARN.Settings.materializeMode.Immediate',
      onDemand: 'GARN.Settings.materializeMode.OnDemand',
    },
  },
  hoodedImage: {
    ...label('hoodedImage'),
    scope: 'world',
    config: true,
    type: String,
    default: HOODED_DEFAULT,
    filePicker: 'image',
  },
  /** Internal, written by the active GM only (§9). */
  playerView: { scope: 'world', config: false, type: Object, default: {} },
  /**
   * Internal, GM-written (§8 Truth): the World's reveal state, the Revelation Map last
   * applied here. Stays as the last Adventure left it under main. Player View derives from it.
   */
  revealState: { scope: 'world', config: false, type: Object, default: {} },
  /** Internal: pan/zoom, last view, filters, Focus Pins (§10.1). */
  viewState: { scope: 'world', config: false, type: Object, default: {} },
  detailDrop: {
    ...label('detailDrop'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  },
  renderBudgetWarning: {
    ...label('renderBudgetWarning'),
    scope: 'client',
    config: true,
    type: Number,
    default: 1000,
  },
  confirmDelete: {
    ...label('confirmDelete'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  },
  warnUnmaterializeReveal: {
    ...label('warnUnmaterializeReveal'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  },
  /** Internal: canvas legend open, per client (1.1 §E.3); toggled by `legend.toggle`. */
  legendOpen: { scope: 'client', config: false, type: Boolean, default: true },
  /** Internal: Player Canvas pan/zoom, per client (§9). */
  playerViewState: { scope: 'client', config: false, type: Object, default: {} },
  /** Internal: window position and detached state per window (§2). */
  windowState: { scope: 'client', config: false, type: Object, default: {} },
  /** Internal: a GM has seen the one-time FILES_BROWSE notice (§12). */
  fileBrowseNoticeShown: { scope: 'world', config: false, type: Boolean, default: false },
  /** Internal: the round 2 look migration ran in this World (v1.1 §G.3.2). */
  lookMigrated: { scope: 'world', config: false, type: Boolean, default: false },
};

export function registerSettings(register: RegisterSetting): void {
  for (const [key, data] of Object.entries(SETTINGS)) register(MODULE_ID, key, data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS mixin constructor shape
type AppClass = new (...args: any[]) => { render(...args: never[]): Promise<unknown> };

/** `game.settings.registerMenu` data. */
export interface MenuData<T extends AppClass> {
  name: string;
  label: string;
  hint: string;
  icon: string;
  type: T;
  restricted: boolean;
}

/**
 * Module Settings button "Open Canon window" (v1.1 §H), GM only. Foundry constructs and
 * renders an ApplicationV2 subclass; this one only runs `canon.openWindow`.
 */
export function canonWindowMenu<T extends AppClass>(
  Base: T,
  run: (command: string) => Promise<unknown>,
): MenuData<T> {
  class CanonWindowLauncher extends Base {
    override render() {
      return run('canon.openWindow').then(() => this);
    }
  }
  return {
    name: 'GARN.Settings.canonWindow.Name',
    label: 'GARN.Commands.canon.openWindow',
    hint: 'GARN.Settings.canonWindow.Hint',
    icon: 'fa-solid fa-book-atlas',
    type: CanonWindowLauncher,
    restricted: true,
  };
}
