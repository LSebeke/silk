/**
 * What a Revelation Map means for one element's Foundry docs (spec §8 table). Pure: the
 * docs as they are + the map → the writes that make ownership match. No-op writes are left
 * out, so applying a map twice writes nothing.
 *
 * | | Journal element | Actor/Item element |
 * |---|---|---|
 * | element | entry + Cover OBSERVER (Quest `visible`) | doc LIMITED |
 * | Info Block | page OBSERVER (Quest `linkedPages.visible`) | page OBSERVER |
 * | Connection | Connections page OBSERVER on the first | same |
 *
 * Actor/Item: the Companion Journal is OBSERVER once a block, Connection or Player Note
 * is Revealed. Person/Creature: the hood until Appearance is Revealed (the Portrait module
 * owns real vs shown), token `displayName` OWNER before the element Reveal, HOVER after.
 */
import { isRevealed, type RevelationMap } from '../campaigns';
import { appearanceBlock, hasAppearanceClass, type StoryElement } from '../elements';
import { blockJournal, infoBlockPages } from '../materialize/layout';
import type { DocSnapshot, SystemMapping } from '../materialize/port';
import { hoodOf, showWrites, type PortraitDoc, type Shown } from '../portrait';

export const OWNERSHIP = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } as const;
/** `CONST.TOKEN_DISPLAY_MODES`. */
export const DISPLAY = { HOVER: 30, OWNER: 40 } as const;
/**
 * Player Note pages of a Revealed element: OWNER, so any player edits or deletes any note
 * (§9). Hidden (NONE) while the element or the note is not Revealed.
 */
export const PLAYER_NOTE_LEVEL = OWNERSHIP.OWNER;

export type RevealWrite =
  | { op: 'update'; uuid: string; data: Record<string, unknown> }
  | { op: 'page'; uuid: string; pageId: string; data: Record<string, unknown> }
  /** Every placed token of the actor (all Scenes). */
  | { op: 'tokens'; uuid: string; data: Record<string, unknown> };

export interface OwnershipInput {
  element: StoryElement;
  main: DocSnapshot;
  companion?: DocSnapshot;
  map: RevelationMap;
  /** Revealed Connections touching the element (ids in the map whose ends include it). */
  revealedConnections: number;
  /** World setting `hoodedImage`. */
  hood: string;
  system: SystemMapping;
}

const level = (o: { ownership?: { default?: number } } | undefined) =>
  o?.ownership?.default ?? OWNERSHIP.NONE;

export function ownershipWrites(input: OwnershipInput): RevealWrite[] {
  const { element: el, main, companion, map } = input;
  const writes: RevealWrite[] = [];
  const revealed = isRevealed(map, 'element', el.id);
  const holder = blockJournal(main, companion);
  const blocks = holder ? infoBlockPages(holder) : [];
  const blockOn = (id: string) => revealed && isRevealed(map, 'infoBlock', id);
  const notesCategory = holder?.flags.silk.playerNotes;
  const notes = notesCategory
    ? (holder.pages ?? []).filter((p) => p.category === notesCategory)
    : [];
  const noteOn = (id: string) => revealed && isRevealed(map, 'playerNote', id);
  const anyConnection = revealed && input.revealedConnections > 0;

  const docLevel = (doc: DocSnapshot, want: number) => {
    if (level(doc) !== want)
      writes.push({ op: 'update', uuid: doc.uuid, data: { ownership: { default: want } } });
  };
  const pageLevel = (doc: DocSnapshot, pageId: string | undefined, want: number) => {
    const p = pageId ? doc.pages?.find((x) => x._id === pageId) : undefined;
    if (p && level(p) !== want)
      writes.push({
        op: 'page',
        uuid: doc.uuid,
        pageId: p._id,
        data: { ownership: { default: want } },
      });
  };
  const on = (b: boolean, lvl: number = OWNERSHIP.OBSERVER) => (b ? lvl : OWNERSHIP.NONE);

  if (main.documentName === 'JournalEntry') {
    docLevel(main, on(revealed));
    pageLevel(main, main.flags.silk.cover, on(revealed));
    const { quest, questKey } = main.flags.silk;
    const questPage = quest ? main.pages?.find((p) => p._id === quest) : undefined;
    if (questPage && questKey) {
      pageLevel(main, quest, on(revealed));
      const data = input.system.questVisibility(
        questKey,
        questPage.system,
        revealed,
        blocks.map((b) => ({
          id: b._id,
          uuid: `${main.uuid}.JournalEntryPage.${b._id}`,
          visible: blockOn(b._id),
          sort: b.sort,
        })),
      );
      if (Object.keys(data).length)
        writes.push({ op: 'page', uuid: main.uuid, pageId: quest as string, data });
    }
  } else {
    docLevel(main, on(revealed, OWNERSHIP.LIMITED));
    if (companion) {
      const any =
        blocks.some((b) => blockOn(b._id)) || anyConnection || notes.some((n) => noteOn(n._id));
      docLevel(companion, on(any));
    }
    // The class hides the image from players (spec §8): behind the hood, or the class icon.
    if (hasAppearanceClass(el.class)) writes.push(...appearanceWrites(input, revealed));
  }
  if (holder) {
    for (const b of blocks) pageLevel(holder, b._id, on(blockOn(b._id)));
    pageLevel(holder, holder.flags.silk.connections, on(anyConnection));
    for (const n of notes) pageLevel(holder, n._id, on(noteOn(n._id), PLAYER_NOTE_LEVEL));
  }
  return writes;
}

/**
 * The hood alone, ownership untouched (Adopt of an actor players can't see yet, v1.1 §C.2):
 * img and token textures as for an element whose Appearance is not Revealed.
 */
export function hoodWrites(
  input: Pick<OwnershipInput, 'element' | 'main' | 'map' | 'hood'>,
): RevealWrite[] {
  if (!hasAppearanceClass(input.element.class)) return [];
  return appearanceWrites(input, isRevealed(input.map, 'element', input.element.id), false);
}

function appearanceWrites(
  input: Pick<OwnershipInput, 'element' | 'main' | 'map' | 'hood'>,
  revealed: boolean,
  appearance = isRevealed(input.map, 'appearance', input.element.id),
): RevealWrite[] {
  const { element: el, main } = input;
  const doc = main as PortraitDoc & { prototypeToken?: { displayName?: number } };
  const showReal = !!appearanceBlock(el) && appearance && revealed;
  const shown: Shown = showReal ? 'real' : { hood: hoodOf(el, input.hood) };
  const portrait = showWrites(doc, shown, el.img);
  const display = revealed ? DISPLAY.HOVER : DISPLAY.OWNER;

  const data = { ...portrait.doc };
  if (doc.prototypeToken?.displayName !== display) data['prototypeToken.displayName'] = display;
  const writes: RevealWrite[] = [];
  if (Object.keys(data).length) writes.push({ op: 'update', uuid: main.uuid, data });
  // Placed tokens follow on every apply (the adapter skips unchanged ones).
  writes.push({
    op: 'tokens',
    uuid: main.uuid,
    data: { ...portrait.tokens, displayName: display },
  });
  return writes;
}
