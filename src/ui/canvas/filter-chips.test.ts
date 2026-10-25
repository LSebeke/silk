import { describe, expect, it } from 'vitest';
import type { CanonRecord } from '../../core/canon';
import { filterOptions, valueLabel } from './filter-chips';

const el = (id: string, cls: string, tags?: string[]): CanonRecord => ({
  kind: 'element',
  id,
  data: { class: cls, name: `N-${id}`, position: { x: 0, y: 0 }, ...(tags ? { tags } : {}) },
});
const records = new Map(
  [el('a', 'person', ['noble']), el('l', 'location', ['noble', 'cursed'])].map((r) => [r.id, r]),
);

describe('filter chips', () => {
  it('labels values by dimension', () => {
    expect(valueLabel(records, 'class', 'person')).toEqual({ key: 'SILK.Class.person' });
    expect(valueLabel(records, 'status', 'dead')).toEqual({ key: 'SILK.Status.dead' });
    expect(valueLabel(records, 'revealed', 'hidden')).toEqual({ key: 'SILK.Filter.Value.hidden' });
    expect(valueLabel(records, 'hops', 'a')).toEqual({ text: 'N-a' });
    expect(valueLabel(records, 'tag', 'noble')).toEqual({ text: 'noble' });
  });

  it('offers Tags in use, and the selection for N-hop / Locations for contents', () => {
    expect(filterOptions(records, 'tag', []).map((o) => o.value)).toEqual(['cursed', 'noble']);
    expect(filterOptions(records, 'hops', ['a', 'l']).map((o) => o.value)).toEqual(['a', 'l']);
    expect(filterOptions(records, 'contents', ['a', 'l']).map((o) => o.value)).toEqual(['l']);
  });
});
