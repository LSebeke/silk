/// <reference types="vite/client" />
import type { Session } from '../adapter/session';
import type { CommandRegistry } from '../core/commands/registry';

declare global {
  /** True in dev builds only (vite.config.ts): registers the `dev.*` commands. */
  const __SILK_DEV__: boolean;
}

declare module 'fvtt-types/configuration' {
  interface ModuleConfig {
    silk: { api: CommandRegistry; session: () => Session };
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
    'silk.fileBrowseNoticeShown': boolean;
  }
}
