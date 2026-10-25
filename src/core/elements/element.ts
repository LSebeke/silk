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
  /** Innermost Visual Group holding the Node (T26, `canvas/groups.ts`). Layout. */
  group?: string;
  /**
   * Image, Info Blocks and class fields. Once Materialized the Foundry doc owns them
   * (spec §7) and these mirror it (`src/core/materialize`); for a Ghost they are the truth.
   */
  img?: string;
  infoBlocks?: InfoBlock[];
  /** Class fields (§4): only those carrying a mechanic, e.g. Person `merchantType`. */
  fields?: ClassFields;
  /** GM-only Tags, never shown to players (§4). Silk-owned. */
  tags?: string[];
}

/** One Info Block = one text `JournalEntryPage`; `_id` is the page id once Materialized. */
export interface InfoBlock {
  _id: string;
  name: string;
  /** HTML. */
  text: string;
}

export interface ClassFields {
  /** Person: mirrors DSA5 `system.merchant.merchantType`. */
  merchantType?: string;
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
