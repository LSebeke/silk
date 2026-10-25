/**
 * Chip bar model (spec §10.5): labels for active filter values and the values a dimension
 * offers. Pure; labels are i18n keys (`key`) or plain text (`text`).
 */
import type { Snapshot } from '../../core/canon';
import { readGroup } from '../../core/canvas/groups';
import type { FilterDimension } from '../../core/canvas/filters';
import {
  ELEMENT_CLASSES,
  STATUSES,
  classLabelKey,
  readElement,
  statusLabelKey,
  type Status,
} from '../../core/elements';

export type ChipLabel = { key: string } | { text: string };

export interface FilterOption {
  value: string;
  label: ChipLabel;
}

const nameOf = (records: Snapshot, id: string): ChipLabel => {
  const record = records.get(id);
  const name = readElement(record)?.name ?? readGroup(record)?.label;
  return { text: name || id };
};

export function valueLabel(
  records: Snapshot,
  dimension: FilterDimension,
  value: string,
): ChipLabel {
  switch (dimension) {
    case 'class':
      return { key: classLabelKey(value as never) };
    case 'status':
      return { key: statusLabelKey(value as Status) };
    case 'revealed':
    case 'materialized':
      return { key: `SILK.Filter.Value.${value}` };
    case 'tag':
      return { text: value };
    case 'group':
    case 'hops':
    case 'contents':
      return nameOf(records, value);
  }
}

/**
 * Values to pick for a dimension. N-hop and "show contents" take the selected Nodes
 * (Locations only for contents).
 */
export function filterOptions(
  records: Snapshot,
  dimension: FilterDimension,
  selection: readonly string[],
): FilterOption[] {
  const opts = (values: Iterable<string>) =>
    [...values].map((value) => ({ value, label: valueLabel(records, dimension, value) }));
  switch (dimension) {
    case 'class':
      return opts(ELEMENT_CLASSES.map((c) => c.id));
    case 'status':
      return opts(new Set(Object.values(STATUSES).flat()));
    case 'revealed':
      return opts(['revealed', 'hidden']);
    case 'materialized':
      return opts(['materialized', 'ghost']);
    case 'tag': {
      const tags = new Set<string>();
      for (const r of records.values()) for (const t of readElement(r)?.tags ?? []) tags.add(t);
      return opts([...tags].sort());
    }
    case 'group':
      return opts([...records.values()].flatMap((r) => (readGroup(r) ? [r.id] : [])));
    case 'hops':
      return opts(selection.filter((id) => readElement(records.get(id))));
    case 'contents':
      return opts(selection.filter((id) => readElement(records.get(id))?.class === 'location'));
  }
}
