/** Element Classes (spec §4). Order = the digit key that creates the class (§10.3). */

export type ElementClassId =
  | 'person'
  | 'creature'
  | 'playerCharacter'
  | 'location'
  | 'faction'
  | 'item'
  | 'event'
  | 'quest'
  | 'note';

/** The kind of Foundry doc backing a class. Class change stays within one kind (§4). */
export type DocKind = 'actor' | 'item' | 'journal';

export interface ElementClass {
  id: ElementClassId;
  /** Digit key 1–9 (§10.3). */
  digit: number;
  docKind: DocKind;
  /** Card / block colour (§10.2). */
  color: string;
  /** Foundry core icon path, shown until the element has an image. */
  icon: string;
  /** False for Player Characters: Adopt only, never created by Silk. */
  creatable: boolean;
}

const icon = (name: string) => `icons/svg/${name}.svg`;

export const ELEMENT_CLASSES: readonly ElementClass[] = [
  { id: 'person', docKind: 'actor', color: '#b5533c', icon: icon('mystery-man') },
  { id: 'creature', docKind: 'actor', color: '#7a4a8c', icon: icon('terror') },
  { id: 'playerCharacter', docKind: 'actor', color: '#2f7d4f', icon: icon('statue') },
  { id: 'location', docKind: 'journal', color: '#3b6ea8', icon: icon('castle') },
  { id: 'faction', docKind: 'journal', color: '#a8853b', icon: icon('combat') },
  { id: 'item', docKind: 'item', color: '#8a6d4b', icon: icon('item-bag') },
  { id: 'event', docKind: 'journal', color: '#c07a20', icon: icon('clockwork') },
  { id: 'quest', docKind: 'journal', color: '#4f7f8a', icon: icon('book') },
  { id: 'note', docKind: 'journal', color: '#6b6b6b', icon: icon('hanging-sign') },
].map((c, i) => ({
  ...(c as Omit<ElementClass, 'digit' | 'creatable'>),
  digit: i + 1,
  creatable: c.id !== 'playerCharacter',
}));

const BY_ID = new Map(ELEMENT_CLASSES.map((c) => [c.id as string, c]));

export function elementClass(id: string): ElementClass | undefined {
  return BY_ID.get(id);
}

/** i18n key of a class's display name. */
export const classLabelKey = (id: ElementClassId) => `SILK.Class.${id}`;
