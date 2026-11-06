/**
 * Element sources (spec 1.1 §B.1, §D): what a new Story Element starts from. Classes listed in
 * `SOURCE_KINDS` take the Source Step in the Creation Pipeline; the rest are always blank.
 */
import type { ElementClassId } from './classes';

export type ElementSource =
  { kind: 'compendium'; uuid: string } | { kind: 'generator'; id: string } | { kind: 'blank' };

export type SourceKind = ElementSource['kind'];

/** Compass order (↑ ← →); `↓` cancels. */
export const SOURCE_KIND_ORDER: readonly SourceKind[] = ['compendium', 'generator', 'blank'];

/** Spec 1.1 §B.1 table: the choices each class's Source Step offers. */
const SOURCE_KINDS: Partial<Record<ElementClassId, readonly SourceKind[]>> = {
  person: ['compendium', 'generator', 'blank'],
  creature: ['compendium', 'blank'],
};

/** The Source Step choices for a class; undefined = the class has no Source Step. */
export function sourceKinds(cls: ElementClassId): readonly SourceKind[] | undefined {
  return SOURCE_KINDS[cls];
}

/** Blank works for every class (the default); the others only where the class offers them. */
export function classTakesSource(cls: ElementClassId, kind: SourceKind): boolean {
  return kind === 'blank' || !!sourceKinds(cls)?.includes(kind);
}
