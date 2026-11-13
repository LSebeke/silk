import { describe, expect, it } from 'vitest';
import { dsa5Mapping, dsa5Sections } from './dsa5';

describe('DSA5 size factor (v1.1 §G.3, #168)', () => {
  const factor = (value?: string) =>
    dsa5Mapping.sizeFactor(value ? { status: { size: { value } } } : {});

  it('tiny and small shrink the token; average and up keep scale 1 (DSA5 grows width)', () => {
    expect([factor('tiny'), factor('small'), factor('average'), factor('big')]).toEqual([
      0.5, 0.8, 1, 1,
    ]);
    expect(factor()).toBe(1);
    expect(factor('huge?')).toBe(1);
  });
});

describe('DSA5 sheet section labels (spec §2, §11.4)', () => {
  const npc = { documentName: 'Actor', type: 'npc' };

  it('groups actor system fields like the DSA5 sheet', () => {
    expect(dsa5Sections.system(npc, ['characteristics', 'mu', 'advances'])).toBe(
      'GARN.Merge.Section.dsa5.characteristics',
    );
    expect(dsa5Sections.system(npc, ['status', 'wounds', 'value'])).toBe(
      'GARN.Merge.Section.dsa5.status',
    );
    expect(dsa5Sections.system(npc, ['details', 'biography', 'value'])).toBe(
      'GARN.Merge.Section.dsa5.details',
    );
    expect(dsa5Sections.system({ documentName: 'Actor', type: 'creature' }, ['behaviour'])).toBe(
      'GARN.Merge.Section.dsa5.details',
    );
    expect(dsa5Sections.system(npc, ['merchant', 'merchantType'])).toBe(
      'GARN.Merge.Section.dsa5.merchant',
    );
    expect(dsa5Sections.system(npc, ['somethingNew'])).toBe('GARN.Merge.Section.system');
  });

  it('groups embedded Items by type: skills, combat, magic, abilities, inventory', () => {
    expect(dsa5Sections.item('skill')).toBe('GARN.Merge.Section.dsa5.skills');
    expect(dsa5Sections.item('combatskill')).toBe('GARN.Merge.Section.dsa5.combatSkills');
    expect(dsa5Sections.item('liturgy')).toBe('GARN.Merge.Section.dsa5.magic');
    expect(dsa5Sections.item('specialability')).toBe('GARN.Merge.Section.dsa5.abilities');
    expect(dsa5Sections.item('meleeweapon')).toBe('GARN.Merge.Section.dsa5.inventory');
    expect(dsa5Sections.item(undefined)).toBe('GARN.Merge.Section.items');
  });
});
