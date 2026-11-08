/** What the Element Detail window talks to (spec §8 Controls). Built by `module.ts`. */
import type { RingPreview } from '../../adapter/ring-style';
import type { Look } from '../../core/portrait';
import type { Reveal } from '../../core/reveal';
import type { WorkingCopy } from '../../core/working-copy';

export interface DetailContext {
  run(name: string, args?: object): Promise<unknown>;
  available(name: string): boolean;
  title(name: string): string;
  workingCopy: WorkingCopy;
  reveal: Pick<Reveal, 'subscribe' | 'isRevealed'>;
  localize(key: string): string;
  format(key: string, data: Record<string, string>): string;
  /** Errors as notifications. */
  error(message: string): void;
  /** Yes/no dialog (delete an Info Block, v1.1 §C.1). */
  confirm(title: string, content: string): Promise<boolean>;
  /**
   * Mounts Foundry's ProseMirror editor (toggled) into `host` with `html`; `save` gets the
   * edited HTML. Returns the unmount.
   */
  editor(host: HTMLElement, html: string, save: (html: string) => void): () => void;
  /** The element's real image, token, ring and pose (v1.1 §G.3), hooded or not. */
  look(id: string): Look | undefined;
  /** Foundry's FilePicker for an image; `undefined` when closed without a pick. */
  pickImage(current: string): Promise<string | undefined>;
  /**
   * The world's ring style for the editor preview of a token `size` grid units wide (v1.1
   * §G.3), the frame its subject file is cut to; `undefined` without one.
   */
  ringPreview(size: number): Promise<RingPreview | undefined>;
}
