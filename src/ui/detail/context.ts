/** What the Element Detail window talks to (spec §8 Controls). Built by `module.ts`. */
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
}
