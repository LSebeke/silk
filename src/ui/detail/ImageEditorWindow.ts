/** Image & token editor window (v1.1 §G.3), one per element. Loaded lazily by `element.openImageEditor`. */
import { DetailWindow } from './DetailWindow';
import ImageEditor from './ImageEditor.svelte';

export class ImageEditorWindow extends DetailWindow {
  static override DEFAULT_OPTIONS = {
    window: { title: 'SILK.ImageEditor.Title', icon: 'fa-solid fa-image' },
    position: { width: 360, height: 640 },
  };
  static override prefix = 'silk-image-editor';

  protected readonly component = ImageEditor;
}
