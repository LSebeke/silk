/**
 * Rewrite the World to a merge result (spec §11.3 End Adventure; also T21 fast-forward and
 * Abandon). The result replaces the working copy; Materialized docs get the result's
 * Foundry-owned fields (name, image, class fields, Status, Info Blocks, sheet system data).
 * Docs of elements the result dropped are deleted; result elements whose docs are not in this
 * World become Ghosts (reconcile).
 * Pure core over the `FoundryDocs` port.
 */
import { canonicalJson, type CanonRecord, type Snapshot } from '../canon';
import { hasStatus, readElement, statusOf, type StoryElement } from '../elements';
import type { WorkingCopy } from '../working-copy';
import {
  CONNECTIONS_SORT,
  SORT_STEP,
  blockJournal,
  blockPage,
  infoBlockPages,
  notePage,
  playerNotePages,
  playerNotesCategory,
} from './layout';
import { readSheet, sheetId, type Lifecycle } from './lifecycle';
import type { Materializer } from './materializer';
import type { FoundryDocs } from './port';

export interface DocRewriterDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  materializer: Materializer;
  lifecycle: Lifecycle;
  /** For a "Player Notes" category a journal lacks (a Note's first note). */
  newId?(): string;
  localize?(key: string): string;
}

export interface DocRewriter {
  apply(result: Snapshot): Promise<void>;
}

const same = (a: CanonRecord | undefined, b: CanonRecord | undefined) =>
  (a ? canonicalJson(a) : '') === (b ? canonicalJson(b) : '');

export function createDocRewriter(deps: DocRewriterDeps): DocRewriter {
  const { docs, materializer } = deps;

  async function writeBlocks(el: StoryElement) {
    const found = materializer.docsOf(el.id);
    const holder = found && blockJournal(found.main, found.companion);
    if (!holder || !el.infoBlocks) return;
    const pages = infoBlockPages(holder);
    const wanted = new Set(el.infoBlocks.map((b) => b._id));
    const gone = pages.filter((p) => !wanted.has(p._id)).map((p) => p._id);
    if (gone.length) await docs.deletePages(holder.uuid, gone);
    let last = pages.filter((p) => wanted.has(p._id)).at(-1)?.sort ?? 0;
    for (const block of el.infoBlocks) {
      const current = pages.find((p) => p._id === block._id);
      if (!current) {
        last = Math.min(last + SORT_STEP, Math.floor((last + CONNECTIONS_SORT) / 2));
        await docs.createPages(holder.uuid, [blockPage(block, last)]);
      } else if (current.name !== block.name || (current.text?.content ?? '') !== block.text)
        await docs.updatePage(holder.uuid, block._id, {
          name: block.name,
          'text.content': block.text,
        });
    }
  }

  /** Player Notes (§9): the result's notes, in the "Player Notes" category. */
  async function writeNotes(el: StoryElement) {
    const found = materializer.docsOf(el.id);
    const holder = found && blockJournal(found.main, found.companion);
    if (!holder) return;
    const notes = el.playerNotes ?? [];
    const pages = playerNotePages(holder);
    const wanted = new Set(notes.map((n) => n._id));
    const gone = pages.filter((p) => !wanted.has(p._id)).map((p) => p._id);
    if (gone.length) await docs.deletePages(holder.uuid, gone);
    if (!notes.length) return;
    let category = holder.flags.silk.playerNotes;
    if (!category || !holder.categories?.some((c) => c._id === category)) {
      if (!deps.newId || !deps.localize) return;
      const created = playerNotesCategory(deps.newId(), { localize: deps.localize });
      await docs.createCategories(holder.uuid, [created]);
      await docs.update(holder.uuid, { 'flags.silk.playerNotes': created._id });
      category = created._id;
    }
    let last = pages.at(-1)?.sort ?? 0;
    for (const note of notes) {
      const current = pages.find((p) => p._id === note._id);
      if (!current) {
        last += SORT_STEP;
        await docs.createPages(holder.uuid, [notePage(note, category, last)]);
      } else if (
        current.name !== note.name ||
        (current.text?.content ?? '') !== note.text ||
        current.flags?.silk?.campaign !== note.campaign
      )
        await docs.updatePage(holder.uuid, note._id, {
          name: note.name,
          'text.content': note.text,
          ...(note.campaign
            ? { 'flags.silk.campaign': note.campaign }
            : { 'flags.silk.-=campaign': null }),
        });
    }
  }

  async function rewrite(el: StoryElement, sheetChanged: boolean, result: Snapshot) {
    const found = materializer.docsOf(el.id);
    if (!found) return;
    const sheet = readSheet(result.get(sheetId(el.id)));
    // Full doc data first (T20 refines: embedded Items, sections); class fields on top.
    if (sheetChanged && sheet?.doc.system && sheet.doc.type === found.main.type)
      await docs.update(found.main.uuid, { system: sheet.doc.system });
    await materializer.writeName(el.id);
    await materializer.setImage(el.id, el.img ?? '');
    if (el.fields) await materializer.setFields(el.id, el.fields);
    await writeBlocks(el);
    await writeNotes(el);
    const status = statusOf(el);
    if (status && hasStatus(el.class)) await materializer.setStatus(el.id, status);
    await materializer.sync(el.id);
  }

  return {
    async apply(result) {
      const wc = deps.workingCopy();
      const before = new Map(wc.records());

      for (const record of before.values()) {
        const el = readElement(record);
        const found = el && materializer.docsOf(el.id);
        if (!el || !found) continue;
        const next = readElement(result.get(el.id));
        if (!next) {
          if (found.companion) await docs.delete(found.companion.uuid);
          await docs.delete(found.main.uuid);
        } else if (next.class !== el.class && next.uuid === el.uuid)
          await materializer.changeClass(el.id, next.class);
      }

      await wc.replaceAll(result);

      for (const record of result.values()) {
        const el = readElement(record);
        if (!el?.uuid) continue;
        const sheetChanged = !same(before.get(sheetId(el.id)), result.get(sheetId(el.id)));
        if (!sheetChanged && same(before.get(el.id), record)) continue;
        await rewrite(el, sheetChanged, result);
      }

      // Docs missing in this World (Materialized elsewhere) → Ghosts; contributors follow.
      await deps.lifecycle.reconcile();
    },
  };
}
