/**
 * Shared base for every Silk window (spec §2): an ApplicationV2 whose content is a
 * Svelte 5 component, mounted once in `_replaceHTML`. Later renders only refresh props.
 */
import { mount, unmount, type Component } from 'svelte';
import type { DeepPartial } from 'fvtt-types/utils';

type RenderOptions = foundry.applications.api.ApplicationV2.RenderOptions;

export abstract class SvelteApplication<
  Props extends Record<string, unknown> = Record<string, unknown>,
>
  extends foundry.applications.api.ApplicationV2
{
  /** The root component rendered into the window content. */
  protected abstract readonly component: Component<Props>;

  /** Props for the component; re-read on every render. */
  protected abstract getProps(): Props;

  #props: Props | undefined;
  #instance: Record<string, unknown> | undefined;

  protected override async _renderHTML(): Promise<Props> {
    return this.getProps();
  }

  protected override _replaceHTML(result: unknown, content: HTMLElement): void {
    const props = result as Props;
    if (this.#props) {
      Object.assign(this.#props, props);
      return;
    }
    const reactiveProps = $state(props);
    this.#props = reactiveProps;
    this.#instance = mount(this.component, { target: content, props: reactiveProps });
  }

  protected override _onClose(options: DeepPartial<RenderOptions>): void {
    if (this.#instance) void unmount(this.#instance);
    this.#instance = undefined;
    this.#props = undefined;
    super._onClose(options);
  }
}
