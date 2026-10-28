/**
 * Shared base for every Silk window (spec §2): an ApplicationV2 whose content is a
 * Svelte 5 component, mounted once in `_replaceHTML`. Later renders only refresh props.
 *
 * Windows that set `persistWindowState` keep position and detached state in the client
 * setting `windowState` and re-detach on open (v14 doesn't). On detach/attach the
 * component is remounted so it binds to its new `ownerDocument`.
 */
import { mount, unmount, type Component } from 'svelte';
import type { DeepPartial } from 'fvtt-types/utils';
import {
  readWindowState,
  withWindowState,
  type WindowPosition,
  type WindowState,
} from '../adapter/window-state';
import { MODULE_ID } from '../constants';

/** Not a private member: `_initializeApplicationOptions` runs inside the base constructor. */
const persists = (app: object) =>
  (app.constructor as unknown as { persistWindowState: boolean }).persistWindowState;

type RenderOptions = foundry.applications.api.ApplicationV2.RenderOptions;
type Position = foundry.applications.api.ApplicationV2.Position;

export abstract class SvelteApplication<
  Props extends Record<string, unknown> = Record<string, unknown>,
>
  extends foundry.applications.api.ApplicationV2
{
  /** The root component rendered into the window content. */
  protected abstract readonly component: Component<Props>;

  /** Props for the component; re-read on every render. */
  protected abstract getProps(): Props;

  /** Persist position and detached state per window id (spec §2). Static: read in the constructor. */
  static persistWindowState = false;

  #props: Props | undefined;
  #instance: Record<string, unknown> | undefined;
  #content: HTMLElement | undefined;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Saved state of this window, for `render({ window: { detached } })` on open. */
  savedWindowState(): WindowState {
    return readWindowState(game.settings?.get(MODULE_ID, 'windowState'), this.id);
  }

  #saveWindowState(patch: Partial<WindowState>) {
    if (!persists(this)) return;
    const all = game.settings?.get(MODULE_ID, 'windowState');
    void game.settings?.set(MODULE_ID, 'windowState', withWindowState(all, this.id, patch));
  }

  protected override _initializeApplicationOptions(
    options: DeepPartial<foundry.applications.api.ApplicationV2.Configuration>,
  ) {
    const resolved = super._initializeApplicationOptions(options);
    const saved = persists(this)
      ? readWindowState(game.settings?.get(MODULE_ID, 'windowState'), resolved.id)
      : undefined;
    if (saved?.position) Object.assign(resolved.position, saved.position);
    return resolved;
  }

  protected override async _renderHTML(): Promise<Props> {
    return this.getProps();
  }

  protected override _replaceHTML(result: unknown, content: HTMLElement): void {
    const props = result as Props;
    if (this.#props) {
      Object.assign(this.#props, props);
      return;
    }
    this.#mount(props, content);
  }

  #mount(props: Props, content: HTMLElement) {
    const reactiveProps = $state(props);
    this.#props = reactiveProps;
    this.#content = content;
    this.#instance = mount(this.component, { target: content, props: reactiveProps });
  }

  #remount() {
    if (!this.#instance || !this.#content || !this.#props) return;
    void unmount(this.#instance);
    this.#content.replaceChildren();
    this.#mount({ ...this.#props }, this.#content);
  }

  protected override _onPosition(position: Position): void {
    super._onPosition(position);
    // Positions inside a detached window are relative to that window: not restorable.
    if (!persists(this) || this.window.windowId) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      const { left, top, width, height } = this.position;
      if ([left, top, width, height].every((v) => typeof v === 'number'))
        this.#saveWindowState({ position: { left, top, width, height } as WindowPosition });
    }, 300);
  }

  protected override _onDetach(from: Document, to: Document) {
    super._onDetach(from, to);
    this.#saveWindowState({ detached: true });
    this.#remount();
  }

  protected override _onAttach(from: Document, to: Document) {
    super._onAttach(from, to);
    this.#saveWindowState({ detached: false });
    this.#remount();
  }

  protected override _onClose(options: DeepPartial<RenderOptions>): void {
    clearTimeout(this.#saveTimer);
    if (this.#instance) void unmount(this.#instance);
    this.#instance = undefined;
    this.#props = undefined;
    this.#content = undefined;
    super._onClose(options);
  }
}
