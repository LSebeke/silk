/**
 * Base of every detail window (Element Detail; Connection Detail, v1.1 §F.2): one window
 * per record, `silk-detail` styling, resizable. Its component renders `DetailShell`.
 */
import type { DeepPartial } from 'fvtt-types/utils';
import { SvelteApplication } from '../SvelteApplication.svelte';

type ApplicationV2 = foundry.applications.api.ApplicationV2;

export abstract class DetailWindow<
  Props extends Record<string, unknown> = Record<string, unknown>,
> extends SvelteApplication<Props> {
  static override DEFAULT_OPTIONS: DeepPartial<foundry.applications.api.ApplicationV2.Configuration> =
    {
      classes: ['silk', 'silk-detail-window'],
      window: { resizable: true, icon: 'fa-solid fa-eye' },
      position: { width: 420, height: 560 },
    };

  /**
   * Opens the detail window with `id`, or brings the open one to front. `prepare` runs on
   * it (new or existing) before the render.
   */
  static async open<W extends ApplicationV2>(
    id: string,
    create: () => W,
    prepare?: (window: W) => void,
  ): Promise<W> {
    const existing = foundry.applications.instances.get(id) as W | undefined;
    const window = existing ?? create();
    prepare?.(window);
    await window.render({ force: true });
    if (existing) existing.bringToFront();
    return window;
  }
}
