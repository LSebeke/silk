/** Canon window (spec §11.5): Canon, Checkout, Adventures, history, Campaigns. Loaded lazily. */
import type { DeepPartial } from 'fvtt-types/utils';
import { getSession } from '../../adapter/session';
import { MODULE_ID } from '../../constants';
import type { CanonOverview } from '../../core/campaigns';
import { SvelteApplication } from '../SvelteApplication.svelte';
import CanonPanel from './CanonPanel.svelte';

type RenderOptions = foundry.applications.api.ApplicationV2.RenderOptions;

export interface CanonPanelProps extends Record<string, unknown> {
  overview: CanonOverview;
  /** Runs a command, reports errors, refreshes the window. */
  run(name: string, args?: object): Promise<void>;
  t(key: string): string;
}

export class CanonWindow extends SvelteApplication<CanonPanelProps> {
  static override DEFAULT_OPTIONS = {
    id: 'silk-canon',
    classes: ['silk'],
    window: { title: 'SILK.Canon.Title', resizable: true },
    position: { width: 520, height: 640 },
  };

  protected readonly component = CanonPanel;
  #overview: CanonOverview = {
    canon: null,
    checkout: null,
    dirty: false,
    adventures: [],
    campaigns: [],
    log: [],
  };
  #unwatch: (() => void) | undefined;

  protected override async _renderHTML(): Promise<CanonPanelProps> {
    this.#overview = await getSession().campaigns.overview();
    this.#unwatch ??= getSession().workingCopy.watch((change) => {
      if (change.binding) void this.render();
    });
    return this.getProps();
  }

  protected getProps(): CanonPanelProps {
    return {
      overview: this.#overview,
      run: async (name, args) => {
        try {
          const api = game.modules?.get(MODULE_ID)?.api;
          if (!api) throw new Error('Silk: not ready yet');
          await api.run(name, args);
        } catch (error) {
          ui.notifications?.error(error instanceof Error ? error.message : String(error));
        }
        await this.render();
      },
      t: (key) => game.i18n?.localize(key) ?? key,
    };
  }

  protected override _onClose(options: DeepPartial<RenderOptions>): void {
    this.#unwatch?.();
    this.#unwatch = undefined;
    super._onClose(options);
  }
}
