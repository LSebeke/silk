/** Compendium picker window (spec 1.1 §B.2). Loaded lazily by the Source Step's ↑ choice. */
import type { CompendiumPicker as Picker, SourcePick } from '../../core/canvas';
import { SvelteApplication } from '../SvelteApplication.svelte';
import CompendiumPicker from './CompendiumPicker.svelte';

type Props = {
  picker: Picker;
  localize: (key: string) => string;
  done: (pick: SourcePick | undefined) => void;
};

class CompendiumPickerWindow extends SvelteApplication<Props> {
  static override DEFAULT_OPTIONS = {
    id: 'silk-compendium-picker',
    classes: ['silk', 'silk-picker-window'],
    window: { title: 'SILK.Picker.Title', resizable: true, icon: 'fa-solid fa-book-atlas' },
    position: { width: 520, height: 480 },
  };

  protected readonly component = CompendiumPicker;

  readonly #props: Props;
  #settle: (pick: SourcePick | undefined) => void;

  constructor(picker: Picker, localize: (key: string) => string, settle: Props['done']) {
    super({});
    this.#settle = settle;
    this.#props = {
      picker,
      localize,
      done: (pick) => {
        this.#finish(pick);
        void this.close();
      },
    };
  }

  #finish(pick: SourcePick | undefined) {
    const settle = this.#settle;
    this.#settle = () => undefined;
    settle(pick);
  }

  protected getProps() {
    return this.#props;
  }

  protected override _onClose(options: Parameters<SvelteApplication['_onClose']>[0]) {
    // Closed by its X or Foundry's Esc: back to the Source Step.
    this.#finish(undefined);
    super._onClose(options);
  }
}

/** Shows the picker; resolves with the pick, or undefined when closed. `signal` closes it. */
export function openCompendiumPicker(
  picker: Picker,
  signal: AbortSignal,
  localize: (key: string) => string,
): Promise<SourcePick | undefined> {
  return new Promise((resolve) => {
    const app = new CompendiumPickerWindow(picker, localize, resolve);
    signal.addEventListener('abort', () => void app.close(), { once: true });
    void app.render({ force: true });
  });
}
