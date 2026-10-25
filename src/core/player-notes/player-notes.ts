/**
 * Player Notes (spec §9): a party notebook on Revealed elements.
 *
 * - A note is a text page in the "Player Notes" category of the element's journal (or its
 *   Companion Journal). Only the active GM writes: players' commands are relayed over the
 *   socket (`relay`), so with no GM online notes can't be created.
 * - A note records its authoring Campaign (`flags.silk.campaign` on the page) and is
 *   auto-Revealed in that Campaign's Revelation Map. Ownership follows the map (T16
 *   `ownership.ts`): party-editable while Revealed, NONE otherwise.
 * - The element record mirrors notes as `playerNotes` (like Info Blocks), so they are
 *   versioned and merged into the Canon.
 * - Convert (GM, one-way): the page leaves the category and becomes an Info Block; it stays
 *   Revealed where it was, the Campaign tag is dropped.
 *
 * Pure core over the `FoundryDocs` port.
 */
import type { Command } from '../commands/registry';
import { elementRecord, readElement, type PlayerNote, type StoryElement } from '../elements';
import {
  CONNECTIONS_SORT,
  SORT_STEP,
  blockJournal,
  infoBlockPages,
  notePage,
  playerNotePages,
  playerNotesCategory,
} from '../materialize/layout';
import type { Materializer } from '../materialize/materializer';
import type { DocSnapshot, FoundryDocs } from '../materialize/port';
import type { Reveal } from '../reveal';
import type { WorkingCopy } from '../working-copy';

export interface PlayerNotesDeps {
  workingCopy(): WorkingCopy;
  docs: FoundryDocs;
  materializer: Pick<Materializer, 'docsOf' | 'sync'>;
  reveal: Pick<Reveal, 'set' | 'isRevealed' | 'convertNote'>;
  /** The checked-out Campaign (`null` under main or unbound). */
  campaign(): Promise<string | null>;
  newId(): string;
  localize(key: string): string;
}

export interface PlayerNotes {
  /** Returns the new note's (page) id. */
  create(args: { elementId: string; text: string }): Promise<string>;
  edit(args: { id: string; text: string }): Promise<void>;
  delete(id: string): Promise<void>;
  /** Convert to GM Info Block (one-way). */
  convert(id: string): Promise<void>;
  /**
   * Join Campaigns (§11.5, T22): notes authored in `from` are re-tagged to `to`, in this
   * World's docs and in Ghost records.
   */
  retag(from: string, to: string): Promise<void>;
}

export function createPlayerNotes(deps: PlayerNotesDeps): PlayerNotes {
  const { docs } = deps;
  const records = () => deps.workingCopy().records();

  function element(id: string): StoryElement {
    const el = readElement(deps.workingCopy().get(id));
    if (!el) throw new Error(`Silk: no element "${id}"`);
    return el;
  }

  function find(id: string): { el: StoryElement; note: PlayerNote } {
    for (const record of records().values()) {
      const el = readElement(record);
      const note = el?.playerNotes?.find((n) => n._id === id);
      if (el && note) return { el, note };
    }
    throw new Error(`Silk: no Player Note "${id}"`);
  }

  /** The journal holding the element's notes; `undefined` for a Ghost. */
  function holderOf(el: StoryElement): DocSnapshot | undefined {
    if (!el.uuid) return undefined;
    const found = deps.materializer.docsOf(el.id);
    const holder = found && blockJournal(found.main, found.companion);
    if (!holder) throw new Error(`Silk: the journal of "${el.name}" is missing`);
    return holder;
  }

  /** Ghost: the record holds the notes. */
  async function writeNotes(el: StoryElement, notes: PlayerNote[]) {
    const { id, ...data } = { ...el, playerNotes: notes.length ? notes : undefined };
    if (!data.playerNotes) delete data.playerNotes;
    await deps.workingCopy().set([elementRecord(id, data)]);
  }

  /** The category's id, created if the journal lacks one (e.g. a Note element). */
  async function category(holder: DocSnapshot): Promise<string> {
    const id = holder.flags.silk.playerNotes;
    if (id && holder.categories?.some((c) => c._id === id)) return id;
    const created = playerNotesCategory(deps.newId(), {
      localize: deps.localize,
      newId: deps.newId,
    } as never);
    await docs.createCategories(holder.uuid, [created]);
    await docs.update(holder.uuid, { 'flags.silk.playerNotes': created._id });
    return created._id;
  }

  return {
    async create({ elementId, text }) {
      const el = element(elementId);
      if (!el.uuid || !deps.reveal.isRevealed('element', elementId))
        throw new Error('Silk: Player Notes go on Revealed elements');
      const campaign = await deps.campaign();
      if (!campaign) throw new Error('Silk: start an Adventure to write Player Notes');
      const holder = holderOf(el) as DocSnapshot;
      const cat = await category(holder);
      const last = playerNotePages(docs.get(holder.uuid) ?? holder).at(-1)?.sort ?? 0;
      const note: PlayerNote = {
        _id: deps.newId(),
        name: deps.localize('SILK.PlayerNote.Name'),
        text,
        campaign,
      };
      await docs.createPages(holder.uuid, [notePage(note, cat, last + SORT_STEP)]);
      await deps.materializer.sync(elementId);
      await deps.reveal.set('playerNote', note._id, true);
      return note._id;
    },

    async edit({ id, text }) {
      const { el, note } = find(id);
      const holder = holderOf(el);
      if (!holder) {
        await writeNotes(
          el,
          (el.playerNotes ?? []).map((n) => (n._id === id ? { ...note, text } : n)),
        );
        return;
      }
      await docs.updatePage(holder.uuid, id, { 'text.content': text });
      await deps.materializer.sync(el.id);
    },

    async delete(id) {
      const { el } = find(id);
      const holder = holderOf(el);
      if (!holder) {
        await writeNotes(
          el,
          (el.playerNotes ?? []).filter((n) => n._id !== id),
        );
        return;
      }
      // Deleted items drop out of the map (§11.5).
      if (deps.reveal.isRevealed('playerNote', id) && (await deps.campaign()))
        await deps.reveal.set('playerNote', id, false);
      await docs.deletePages(holder.uuid, [id]);
      await deps.materializer.sync(el.id);
    },

    async convert(id) {
      const { el, note } = find(id);
      const holder = holderOf(el);
      const block = { _id: note._id, name: note.name, text: note.text };
      if (!holder) {
        await writeNotes(
          { ...el, infoBlocks: [...(el.infoBlocks ?? []), block] },
          (el.playerNotes ?? []).filter((n) => n._id !== id),
        );
        return;
      }
      const last = infoBlockPages(holder).at(-1)?.sort ?? 0;
      await docs.updatePage(holder.uuid, id, {
        category: null,
        sort: Math.min(last + SORT_STEP, Math.floor((last + CONNECTIONS_SORT) / 2)),
        'flags.silk.-=campaign': null,
      });
      await deps.materializer.sync(el.id);
      await deps.reveal.convertNote(id, note.campaign ? [note.campaign] : []);
    },

    async retag(from, to) {
      for (const record of [...records().values()]) {
        const el = readElement(record);
        const tagged = (el?.playerNotes ?? []).filter((n) => n.campaign === from);
        if (!el || !tagged.length) continue;
        const holder = holderOf(el);
        if (!holder) {
          await writeNotes(
            el,
            (el.playerNotes ?? []).map((n) => (n.campaign === from ? { ...n, campaign: to } : n)),
          );
          continue;
        }
        for (const n of tagged)
          await docs.updatePage(holder.uuid, n._id, { 'flags.silk.campaign': to });
        await deps.materializer.sync(el.id);
      }
    },
  };
}

export interface PlayerNoteCommandDeps {
  isGM(): boolean;
  /** An active GM is connected (players' writes go through it). */
  gmOnline(): boolean;
  /** Player → active GM: runs the command there and returns its result. */
  relay(name: string, args: object): Promise<unknown>;
}

/** Commands (spec §15 "Player Notes"). create/edit/delete for everyone, convert GM only. */
export function playerNoteCommands(notes: PlayerNotes, deps: PlayerNoteCommandDeps): Command[] {
  const anyone = () => deps.isGM() || deps.gmOnline();
  const party = <A extends object, R>(name: string, run: (args: A) => Promise<R>): Command<A> => ({
    name,
    title: `SILK.Commands.${name}`,
    available: anyone,
    run: (args) => (deps.isGM() ? run(args) : deps.relay(name, args)),
  });
  return [
    party('playerNote.create', async (args: { elementId: string; text: string }) => ({
      id: await notes.create(args),
    })),
    party('playerNote.edit', (args: { id: string; text: string }) => notes.edit(args)),
    party('playerNote.delete', (args: { id: string }) => notes.delete(args.id)),
    {
      name: 'playerNote.convert',
      title: 'SILK.Commands.playerNote.convert',
      available: () => deps.isGM(),
      run: (args: { id: string }) => notes.convert(args.id),
    },
  ];
}
