/**
 * Story Element records (spec §3, §4, §11.1). An element lives in the working copy as
 * `{ kind: 'element', id, data }`. Fields grow per feature (img, tags, status, …);
 * readers must tolerate missing optional fields.
 */
import type { CanonRecord, JsonObject } from '../canon';
import type { ElementClassId } from './classes';

export interface Point {
  x: number;
  y: number;
}

export interface ElementData {
  class: ElementClassId;
  name: string;
  /** Node position, merged as one layout field (merge.ts `LAYOUT_FIELDS`). */
  position: Point;
  /** UUID of the Foundry doc once Materialized (T8). Absent = Ghost. */
  uuid?: string;
}

export interface StoryElement extends ElementData {
  id: string;
}

export function elementRecord(id: string, data: ElementData): CanonRecord {
  return { kind: 'element', id, data: data as unknown as JsonObject };
}

/** The element in a record, or undefined if the record is not an element. */
export function readElement(record: CanonRecord | undefined): StoryElement | undefined {
  if (record?.kind !== 'element') return undefined;
  const data = record.data as unknown as ElementData;
  return { ...data, position: data.position ?? { x: 0, y: 0 }, id: record.id };
}

/** Ghost = a Node whose Story Element is not Materialized in this World (glossary). */
export const isGhost = (element: ElementData) => !element.uuid;
