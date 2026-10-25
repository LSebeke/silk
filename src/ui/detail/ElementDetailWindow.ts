/** Element Detail window (spec §8 Controls), one per element. Loaded lazily by `element.openDetail`. */
import { SvelteApplication } from '../SvelteApplication.svelte';
import type { DetailContext } from './context';
import ElementDetail from './ElementDetail.svelte';

export class ElementDetailWindow extends SvelteApplication<{ ctx: DetailContext; id: string }> {
  static override DEFAULT_OPTIONS = {
    classes: ['silk', 'silk-detail-window'],
    window: { title: 'SILK.Detail.Title', resizable: true, icon: 'fa-solid fa-eye' },
    position: { width: 420, height: 560 },
  };

  static idFor = (elementId: string) => `silk-detail-${elementId}`;

  protected readonly component = ElementDetail;

  readonly #ctx: DetailContext;
  readonly #id: string;

  constructor(ctx: DetailContext, elementId: string) {
    super({ id: ElementDetailWindow.idFor(elementId) });
    this.#ctx = ctx;
    this.#id = elementId;
  }

  protected getProps() {
    return { ctx: this.#ctx, id: this.#id };
  }
}
