/** Silk settings (spec §13). Registered on `init` by the adapter. */
import { MODULE_ID } from '../constants';

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
  name: `SILK.Settings.${key}.Name`,
  hint: `SILK.Settings.${key}.Hint`,
});

export const SETTINGS: Record<string, SettingData> = {
  materializeMode: {
    ...label('materializeMode'),
    scope: 'world',
    config: true,
    type: String,
    default: 'immediate',
    choices: {
      immediate: 'SILK.Settings.materializeMode.Immediate',
      onDemand: 'SILK.Settings.materializeMode.OnDemand',
    },
  },
  hoodedImage: {
    ...label('hoodedImage'),
    scope: 'world',
    config: true,
    type: String,
    default: `modules/${MODULE_ID}/assets/hooded.svg`,
    filePicker: 'image',
  },
  /** Internal, written by the active GM only (§9). */
  playerView: { scope: 'world', config: false, type: Object, default: {} },
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
  /** Internal: window position and detached state per window (§2). */
  windowState: { scope: 'client', config: false, type: Object, default: {} },
};

export function registerSettings(register: RegisterSetting): void {
  for (const [key, data] of Object.entries(SETTINGS)) register(MODULE_ID, key, data);
}
