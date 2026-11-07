/**
 * Element sources (spec 1.1 §B.1, §D): what a new Story Element starts from. Classes listed in
 * `SOURCE_KINDS` take the Source Step in the Creation Pipeline; the rest are always blank.
 */
import type { ElementClassId } from './classes';

export type ElementSource =
  { kind: 'compendium'; uuid: string } | GeneratorSource | { kind: 'blank' };

/**
 * A generator pick (spec 1.1 §B.3): the generator already created a world Actor, which
 * becomes the element's doc (bound, not copied) as soon as the element is created.
 */
export interface GeneratorSource {
  kind: 'generator';
  /** Which generator; `'nsc-zucht'` (dsa5-mastersworkshop). */
  id: string;
  /** The Actor the generator created. */
  actorUuid: string;
}

/** The Actor a generator pick binds, if the element came from one. */
export function generatedActor(source: ElementSource | undefined): string | undefined {
  return source?.kind === 'generator' ? source.actorUuid : undefined;
}

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

/**
 * Person and Creature: classes whose source is an Actor (Compendium Actor packs, NSC Zucht).
 * The one place that names them; their Appearance (§8) and picker type derive from it.
 */
export function isActorSourceClass(cls: string): boolean {
  return !!SOURCE_KINDS[cls as ElementClassId]?.includes('compendium');
}

/** Blank works for every class (the default); the others only where the class offers them. */
export function classTakesSource(cls: ElementClassId, kind: SourceKind): boolean {
  return kind === 'blank' || !!sourceKinds(cls)?.includes(kind);
}
