/**
 * The Appearance page's HTML (v1.1 §G.4): a Silk-managed portrait region on top, showing the
 * element's real image, then the block's text. Silk restores the region when it is missing or
 * stale and keeps it when the block's text is edited. Readback strips it (layout `readBack`).
 */
import { portraitUpdate, withPortrait } from '../portrait/figure';
import { realPortrait } from '../portrait/portrait';
import { infoBlockPages } from './layout';
import type { DocSnapshot, FoundryDocs } from './port';

/** A Materialized element's docs. */
export interface ElementDocs {
  main: DocSnapshot;
  companion?: DocSnapshot;
}

/** The Appearance page: an actor's flagged Info Block page in its Companion Journal. */
export function appearancePage({ main, companion }: ElementDocs) {
  if (main.documentName !== 'Actor' || !companion) return undefined;
  return infoBlockPages(companion).find((p) => p.flags?.silk?.appearance);
}

/**
 * The page content that puts the real image back on top, or undefined when it shows it
 * already.
 */
export function portraitRestore(found: ElementDocs) {
  const page = appearancePage(found);
  const content = page && portraitUpdate(page.text?.content ?? '', realPortrait(found.main).img);
  return page && content !== undefined ? { page: page._id, content } : undefined;
}

/** Writes `portraitRestore` when needed. */
export async function restorePortrait(docs: Pick<FoundryDocs, 'updatePage'>, found: ElementDocs) {
  const restore = portraitRestore(found);
  if (restore && found.companion)
    await docs.updatePage(found.companion.uuid, restore.page, { 'text.content': restore.content });
}

/** Block `blockId`'s page HTML for `text`: the Appearance page keeps its portrait on top. */
export function blockPageText(found: ElementDocs, blockId: string, text: string): string {
  return appearancePage(found)?._id === blockId
    ? withPortrait(text, realPortrait(found.main).img)
    : text;
}
