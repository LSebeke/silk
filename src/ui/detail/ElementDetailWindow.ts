/** Element Detail window (spec §8 Controls), one per element. Loaded lazily by `element.openDetail`. */
import { DetailWindow, type DetailProps } from './DetailWindow';
import ElementDetail from './ElementDetail.svelte';

type Props = DetailProps & { focus: string | undefined };

export class ElementDetailWindow extends DetailWindow<Props> {
  static override DEFAULT_OPTIONS = { window: { title: 'SILK.Detail.Title' } };
  static override prefix = 'silk-detail';

  protected readonly component = ElementDetail;

  /** Info Block whose name field gets focus on the next render (v1.1 §C.1). */
  #focus: string | undefined;

  focusBlock(blockId: string) {
    this.#focus = blockId;
  }

  protected override moreProps() {
    return { focus: this.#focus };
  }
}
