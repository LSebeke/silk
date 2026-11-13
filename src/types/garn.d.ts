/// <reference types="vite/client" />
import type { Session } from '../adapter/session';
import type { CommandRegistry } from '../core/commands/registry';

declare global {
  /** True in dev builds only (vite.config.ts): registers the `dev.*` commands. */
  const __GARN_DEV__: boolean;
}

declare module 'fvtt-types/configuration' {
  interface ModuleConfig {
    garn: { api: CommandRegistry; session: () => Session };
  }

  /** Mirrors `SETTINGS` in src/adapter/settings.ts. */
  interface SettingConfig {
    'garn.materializeMode': 'immediate' | 'onDemand';
    'garn.hoodedImage': string;
    'garn.playerView': object;
    'garn.revealState': object;
    'garn.viewState': object;
    'garn.detailDrop': boolean;
    'garn.renderBudgetWarning': number;
    'garn.confirmDelete': boolean;
    'garn.warnUnmaterializeReveal': boolean;
    'garn.playerViewState': object;
    'garn.windowState': object;
    'garn.fileBrowseNoticeShown': boolean;
    'garn.lookMigrated': boolean;
    'garn.legendOpen': boolean;
  }
}
