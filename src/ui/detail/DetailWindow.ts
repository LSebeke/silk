/**
 * Base of every detail window (Element Detail; Connection Detail, v1.1 §F.2; image & token
 * editor, §G.3): one window per record, `garn-detail` styling, resizable. Its component
 * renders `DetailShell` and gets the context and the record id.
 */
import type { DeepPartial } from 'fvtt-types/utils';
import { SvelteApplication } from '../SvelteApplication.svelte';
import type { DetailContext } from './context';

export type DetailProps = { ctx: DetailContext; id: string };

type DetailWindowClass<W> = (new (ctx: DetailContext, recordId: string) => W) & {
  prefix: string;
};

export abstract class DetailWindow<
  Props extends DetailProps = DetailProps,
> extends SvelteApplication<Props> {
  static override DEFAULT_OPTIONS: DeepPartial<foundry.applications.api.ApplicationV2.Configuration> =
    {
      classes: ['garn', 'garn-detail-window'],
      window: { resizable: true, icon: 'fa-solid fa-eye' },
      position: { width: 420, height: 560 },
    };

  /** Window id prefix: the window of record `id` is `<prefix>-<id>`. */
  static prefix = 'garn-detail';

  protected readonly ctx: DetailContext;
  protected readonly recordId: string;

  constructor(ctx: DetailContext, recordId: string) {
    super({ id: `${(new.target as typeof DetailWindow).prefix}-${recordId}` });
    this.ctx = ctx;
    this.recordId = recordId;
  }

  /** Props beyond `ctx` and `id`. */
  protected moreProps(): Omit<Props, keyof DetailProps> {
    return {} as Omit<Props, keyof DetailProps>;
  }

  protected getProps(): Props {
    return { ctx: this.ctx, id: this.recordId, ...this.moreProps() } as Props;
  }

  /**
   * Opens the window of record `id`, or brings the open one to front. `prepare` runs on it
   * (new or existing) before the render.
   */
  static async show<W extends DetailWindow>(
    this: DetailWindowClass<W>,
    ctx: DetailContext,
    id: string,
    prepare?: (window: W) => void,
  ): Promise<W> {
    const existing = foundry.applications.instances.get(`${this.prefix}-${id}`) as W | undefined;
    const window = existing ?? new this(ctx, id);
    prepare?.(window);
    await window.render({ force: true });
    if (existing) existing.bringToFront();
    return window;
  }
}
