/**
 * Merge window (spec §11.4). Loaded lazily by `adventure.end` / resume. Renders the open
 * merge (`Merges.view()`); refreshes when the draft in the working copy changes.
 * T21/T22 reuse it: the view carries its own title and column labels.
 */
import type { DeepPartial } from 'fvtt-types/utils';
import type { MergeView } from '../../core/merge';
import type { WorkingCopy } from '../../core/working-copy';
import { MERGE_DRAFT } from '../../core/merge';
import { SvelteApplication } from '../SvelteApplication.svelte';
import MergeRoot from './MergeRoot.svelte';

type RenderOptions = foundry.applications.api.ApplicationV2.RenderOptions;

export interface MergeDeps {
  view(): Promise<MergeView | null>;
  workingCopy(): WorkingCopy;
  run(name: string, args?: object): Promise<unknown>;
  t(key: string, data?: Record<string, string>): string;
}

export interface MergePanelProps extends Record<string, unknown> {
  view: MergeView | null;
  /** Record whose drawer is open; `field` = the conflict to highlight. */
  focus: { recordId: string; field?: string } | null;
  select(recordId: string | null): void;
  /** Runs a command; errors become notifications. */
  run(name: string, args?: object): Promise<void>;
  t(key: string, data?: Record<string, string>): string;
}

export class MergeWindow extends SvelteApplication<MergePanelProps> {
  static readonly ID = 'silk-merge';

  static override DEFAULT_OPTIONS = {
    id: MergeWindow.ID,
    classes: ['silk', 'silk-merge-window'],
    window: { title: 'SILK.Merge.Title', resizable: true, icon: 'fa-solid fa-code-merge' },
    position: { width: 1200, height: 700 },
  };

  protected readonly component = MergeRoot;
  readonly #deps: MergeDeps;
  #view: MergeView | null = null;
  #focus: MergePanelProps['focus'] = null;
  /** Last draft cursor seen. */
  #cursor = '';
  #unwatch: (() => void) | undefined;

  constructor(deps: MergeDeps) {
    super();
    this.#deps = deps;
  }

  /** Open the drawer of a record (and highlight one of its fields). */
  async focusOn(recordId: string | null, field?: string) {
    this.#focus = recordId ? { recordId, ...(field !== undefined && { field }) } : null;
    await this.render();
  }

  protected override async _renderHTML(): Promise<MergePanelProps> {
    this.#view = await this.#deps.view();
    // `merge.nextConflict` moves the draft's cursor: follow it.
    const cursor = this.#view?.draft.cursor;
    const key = cursor ? `${cursor.recordId}\n${cursor.field}` : '';
    if (key !== this.#cursor) {
      this.#cursor = key;
      if (cursor) this.#focus = { ...cursor };
    }
    this.#unwatch ??= this.#deps.workingCopy().watch((change) => {
      if (change.meta?.includes(MERGE_DRAFT)) void this.render();
    });
    return this.getProps();
  }

  protected getProps(): MergePanelProps {
    return {
      view: this.#view,
      focus: this.#focus,
      select: (recordId) => void this.focusOn(recordId),
      run: async (name, args) => {
        try {
          await this.#deps.run(name, args);
        } catch (error) {
          ui.notifications?.error(error instanceof Error ? error.message : String(error));
        }
      },
      t: this.#deps.t,
    };
  }

  protected override _onClose(options: DeepPartial<RenderOptions>): void {
    this.#unwatch?.();
    this.#unwatch = undefined;
    super._onClose(options);
  }
}
