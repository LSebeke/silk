/**
 * Status per Element Class (spec §4 Status column). The first value is the default; the
 * record stores only a non-default Status (`ElementData.status`). Classes without a
 * Status have none. Toggling cycles through the values in order.
 */
import type { ElementClassId } from './classes';

export type Status =
  'alive' | 'dead' | 'planned' | 'happened' | 'skipped' | 'open' | 'done' | 'failed';

export const STATUSES: Partial<Record<ElementClassId, readonly Status[]>> = {
  person: ['alive', 'dead'],
  creature: ['alive', 'dead'],
  event: ['planned', 'happened', 'skipped'],
  quest: ['open', 'done', 'failed'],
};

export const statusesOf = (cls: ElementClassId): readonly Status[] => STATUSES[cls] ?? [];

export const hasStatus = (cls: ElementClassId) => statusesOf(cls).length > 0;

/** The element's Status; an unknown stored value (e.g. after a class change) reads as default. */
export function statusOf(element: { class: ElementClassId; status?: string }): Status | undefined {
  const values = statusesOf(element.class);
  return values.find((s) => s === element.status) ?? values[0];
}

/** The value the record stores for `status`: undefined for the default. */
export function storedStatus(cls: ElementClassId, status: Status | undefined): Status | undefined {
  return status === statusesOf(cls)[0] ? undefined : status;
}

export function nextStatus(element: { class: ElementClassId; status?: string }): Status {
  const values = statusesOf(element.class);
  const current = statusOf(element);
  const next = values[(values.indexOf(current as Status) + 1) % values.length];
  if (!next) throw new Error(`Silk: ${element.class} elements have no Status`);
  return next;
}

/** i18n key of a Status's display name. */
export const statusLabelKey = (status: Status) => `SILK.Status.${status}`;
