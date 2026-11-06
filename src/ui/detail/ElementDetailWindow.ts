/** Element Detail window (spec §8 Controls), one per element. Loaded lazily by `element.openDetail`. */
import { SvelteApplication } from '../SvelteApplication.svelte';
import type { DetailContext } from './context';
import ElementDetail from './ElementDetail.svelte';

type Props = { ctx: DetailContext; id: string; focus: string | undefined };

export class ElementDetailWindow extends SvelteApplication<Props> {
  static override DEFAULT_OPTIONS = {
    classes: ['silk', 'silk-detail-window'],
    window: { title: 'SILK.Detail.Title', resizable: true, icon: 'fa-solid fa-eye' },
    position: { width: 420, height: 560 },
  };

  static idFor = (elementId: string) => `silk-detail-${elementId}`;

  protected readonly component = ElementDetail;

  readonly #ctx: DetailContext;
  readonly #id: string;
  /** Info Block whose name field gets focus on the next render (v1.1 §C.1). */
  #focus: string | undefined;

  constructor(ctx: DetailContext, elementId: string) {
    super({ id: ElementDetailWindow.idFor(elementId) });
    this.#ctx = ctx;
    this.#id = elementId;
  }

  focusBlock(blockId: string) {
    this.#focus = blockId;
  }

  protected getProps() {
    return { ctx: this.#ctx, id: this.#id, focus: this.#focus };
  }
}
