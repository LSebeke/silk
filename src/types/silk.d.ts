/// <reference types="vite/client" />
import type { CommandRegistry } from '../core/commands/registry';

declare module 'fvtt-types/configuration' {
  interface ModuleConfig {
    silk: { api: CommandRegistry };
  }

  /** Mirrors `SETTINGS` in src/adapter/settings.ts. */
  interface SettingConfig {
    'silk.materializeMode': 'immediate' | 'onDemand';
    'silk.hoodedImage': string;
    'silk.playerView': object;
    'silk.viewState': object;
    'silk.detailDrop': boolean;
    'silk.renderBudgetWarning': number;
    'silk.confirmDelete': boolean;
    'silk.warnUnmaterializeReveal': boolean;
    'silk.windowState': object;
  }
}
