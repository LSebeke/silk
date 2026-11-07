/** Compendium picker window (spec 1.1 §B.2). Loaded lazily by the Source Step's ↑ choice. */
import type { CompendiumPicker as Picker } from '../../core/canvas';
import { SvelteApplication } from '../SvelteApplication.svelte';
import CompendiumPicker from './CompendiumPicker.svelte';

type Props = {
  picker: Picker;
  localize: (key: string) => string;
  run: (name: string, args?: object) => Promise<unknown>;
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
  /** Closed by Silk (pick, cancel, aborted creation), not by the user. */
  #closing = false;

  constructor(props: Props) {
    super({});
    this.#props = props;
  }

  protected getProps() {
    return this.#props;
  }

  dismiss() {
    this.#closing = true;
    void this.close();
  }

  protected override _onClose(options: Parameters<SvelteApplication['_onClose']>[0]) {
    // Closed by its X or Foundry's Esc: back to the Source Step.
    if (!this.#closing) void this.#props.run('picker.cancel').catch(() => undefined);
    super._onClose(options);
  }
}

/** Shows the picker; resolves with the function that closes it. */
export async function openCompendiumPicker(
  picker: Picker,
  options: Omit<Props, 'picker'>,
): Promise<() => void> {
  const app = new CompendiumPickerWindow({ picker, ...options });
  void app.render({ force: true });
  return () => app.dismiss();
}
