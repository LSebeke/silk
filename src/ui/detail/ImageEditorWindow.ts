/** Image & token editor window (v1.1 §G.3), one per element. Loaded lazily by `element.openImageEditor`. */
import type { DetailContext } from './context';
import { DetailWindow } from './DetailWindow';
import ImageEditor from './ImageEditor.svelte';

type Props = { ctx: DetailContext; id: string };

export class ImageEditorWindow extends DetailWindow<Props> {
  static override DEFAULT_OPTIONS = {
    window: { title: 'SILK.ImageEditor.Title', icon: 'fa-solid fa-image' },
    position: { width: 360, height: 600 },
  };

  static idFor = (elementId: string) => `silk-image-editor-${elementId}`;

  protected readonly component = ImageEditor;

  readonly #ctx: DetailContext;
  readonly #id: string;

  constructor(ctx: DetailContext, elementId: string) {
    super({ id: ImageEditorWindow.idFor(elementId) });
    this.#ctx = ctx;
    this.#id = elementId;
  }

  protected getProps() {
    return { ctx: this.#ctx, id: this.#id };
  }
}
