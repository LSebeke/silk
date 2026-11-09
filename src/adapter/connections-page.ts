/**
 * Foundry side of the Connections page (spec §5 "In journals"): the page is generated and
 * read-only, so a hand edit (not Garn's own write) is overwritten on the active GM.
 */
import type { ConnectionsPages } from '../core/materialize';
import { isGarnWrite } from './working-copy-journal';

type Page = {
  id?: string | null;
  parent?: { flags?: { garn?: { id?: string; companionOf?: string; connections?: string } } };
};

export function registerConnectionsPageHooks(
  pages: Pick<ConnectionsPages, 'refresh'>,
  deps: { on(hook: string, fn: (...args: unknown[]) => void): void; isActiveGM(): boolean },
): void {
  deps.on('updateJournalEntryPage', (doc, _changed, options) => {
    if (!deps.isActiveGM() || isGarnWrite(options)) return;
    const page = doc as Page;
    const garn = page.parent?.flags?.garn;
    const id = garn?.id ?? garn?.companionOf;
    if (!id || !page.id || page.id !== garn?.connections) return;
    pages.refresh([id]).catch((error: unknown) => console.error(error));
  });
}
