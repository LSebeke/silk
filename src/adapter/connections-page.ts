/**
 * Foundry side of the Connections page (spec §5 "In journals"): the page is generated and
 * read-only, so a hand edit (not Silk's own write) is overwritten on the active GM.
 */
import type { ConnectionsPages } from '../core/materialize';
import { isSilkWrite } from './working-copy-journal';

type Page = {
  id?: string | null;
  parent?: { flags?: { silk?: { id?: string; companionOf?: string; connections?: string } } };
};

export function registerConnectionsPageHooks(
  pages: Pick<ConnectionsPages, 'refresh'>,
  deps: { on(hook: string, fn: (...args: unknown[]) => void): void; isActiveGM(): boolean },
): void {
  deps.on('updateJournalEntryPage', (doc, _changed, options) => {
    if (!deps.isActiveGM() || isSilkWrite(options)) return;
    const page = doc as Page;
    const silk = page.parent?.flags?.silk;
    const id = silk?.id ?? silk?.companionOf;
    if (!id || !page.id || page.id !== silk?.connections) return;
    pages.refresh([id]).catch((error: unknown) => console.error(error));
  });
}
