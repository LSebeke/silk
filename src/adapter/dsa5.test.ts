import { describe, expect, it } from 'vitest';
import { dsa5Sections } from './dsa5';

describe('DSA5 sheet section labels (spec §2, §11.4)', () => {
  const npc = { documentName: 'Actor', type: 'npc' };

  it('groups actor system fields like the DSA5 sheet', () => {
    expect(dsa5Sections.system(npc, ['characteristics', 'mu', 'advances'])).toBe(
      'SILK.Merge.Section.dsa5.characteristics',
    );
    expect(dsa5Sections.system(npc, ['status', 'wounds', 'value'])).toBe(
      'SILK.Merge.Section.dsa5.status',
    );
    expect(dsa5Sections.system(npc, ['details', 'biography', 'value'])).toBe(
      'SILK.Merge.Section.dsa5.details',
    );
    expect(dsa5Sections.system({ documentName: 'Actor', type: 'creature' }, ['behaviour'])).toBe(
      'SILK.Merge.Section.dsa5.details',
    );
    expect(dsa5Sections.system(npc, ['merchant', 'merchantType'])).toBe(
      'SILK.Merge.Section.dsa5.merchant',
    );
    expect(dsa5Sections.system(npc, ['somethingNew'])).toBe('SILK.Merge.Section.system');
  });

  it('groups embedded Items by type: skills, combat, magic, abilities, inventory', () => {
    expect(dsa5Sections.item('skill')).toBe('SILK.Merge.Section.dsa5.skills');
    expect(dsa5Sections.item('combatskill')).toBe('SILK.Merge.Section.dsa5.combatSkills');
    expect(dsa5Sections.item('liturgy')).toBe('SILK.Merge.Section.dsa5.magic');
    expect(dsa5Sections.item('specialability')).toBe('SILK.Merge.Section.dsa5.abilities');
    expect(dsa5Sections.item('meleeweapon')).toBe('SILK.Merge.Section.dsa5.inventory');
    expect(dsa5Sections.item(undefined)).toBe('SILK.Merge.Section.items');
  });
});
