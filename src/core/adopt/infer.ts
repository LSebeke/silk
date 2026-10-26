/** Adopt class inference (spec §6 Adopt "Class inference"). Pure. */
import type { ElementClassId } from '../elements';

/** What inference reads from a Foundry doc. */
export interface InferInput {
  documentName: string;
  /** Actor/Item subtype. */
  type?: string | undefined;
  pages?: readonly { type: string }[] | undefined;
}

/**
 * `class`: adopted as that class. `choices`: the GM picks, the first one pre-selected (and
 * taken by bulk Adopt). `refused`: not adoptable (Actor `group`/`vehicle`, other docs).
 */
export type Inference =
  { class: ElementClassId } | { choices: ElementClassId[] } | { refused: true };

const ACTOR: Record<string, ElementClassId> = {
  character: 'playerCharacter',
  npc: 'person',
  creature: 'creature',
};

/** Journal classes, Note first (pre-selected). */
export const JOURNAL_CHOICES: ElementClassId[] = ['note', 'location', 'faction', 'event', 'quest'];
/** Scene: a new Event owning it, or a Location with it as Overview Scene. */
export const SCENE_CHOICES: ElementClassId[] = ['event', 'location'];

export const QUEST_PAGE = 'dsaquestlog';

export function inferClass(doc: InferInput): Inference {
  switch (doc.documentName) {
    case 'Actor': {
      const cls = doc.type ? ACTOR[doc.type] : undefined;
      return cls ? { class: cls } : { refused: true };
    }
    case 'Item':
      return { class: 'item' };
    case 'JournalEntry':
      return doc.pages?.some((p) => p.type === QUEST_PAGE)
        ? { class: 'quest' }
        : { choices: [...JOURNAL_CHOICES] };
    case 'Scene':
      return { choices: [...SCENE_CHOICES] };
    default:
      return { refused: true };
  }
}

/** The class bulk Adopt uses: the inferred one, else the pre-selected choice. */
export function bulkClass(inference: Inference): ElementClassId | undefined {
  if ('class' in inference) return inference.class;
  if ('choices' in inference) return inference.choices[0];
  return undefined;
}

/** Classes a doc may be adopted as (an explicit `class` arg must be one). */
export function allowedClasses(doc: InferInput): ElementClassId[] {
  const inference = inferClass(doc);
  if ('refused' in inference) return [];
  if ('choices' in inference) return inference.choices;
  // Actors may become any actor class (class change stays within one kind, §4).
  if (doc.documentName === 'Actor') return [inference.class, 'person', 'creature'];
  if (inference.class === 'quest') return JOURNAL_CHOICES;
  return [inference.class];
}
