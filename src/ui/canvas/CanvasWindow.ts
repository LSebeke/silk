/** World Canvas window. Placeholder until the canvas ticket lands. Loaded lazily. */
import { SvelteApplication } from '../SvelteApplication.svelte';
import CanvasPlaceholder from './CanvasPlaceholder.svelte';

export class CanvasWindow extends SvelteApplication<{ message: string }> {
  static override DEFAULT_OPTIONS = {
    id: 'silk-canvas',
    classes: ['silk'],
    window: { title: 'SILK.Canvas.Title', resizable: true },
    position: { width: 900, height: 600 },
  };

  protected readonly component = CanvasPlaceholder;

  protected getProps() {
    return { message: game.i18n?.localize('SILK.Canvas.Placeholder') ?? '' };
  }
}
