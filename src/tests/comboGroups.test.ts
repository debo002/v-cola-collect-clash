import { describe, expect, it } from 'vitest';
import { FLAVORS } from '../game/cards';
import {
  COMBO_GROUP_MEMBERS,
  RULE1_EXACT,
  RULE2_EXACT,
  RULE3_EXACT,
  RULE7_SET,
  SHARE_TAGS,
  getCardGroups,
} from '../game/effects';

describe('getCardGroups (visual membership only)', () => {
  it('V Lemon spans cola + citrus (gradient)', () => {
    expect(getCardGroups('v-lemon')).toEqual(['cola', 'citrus']);
  });

  it('Pink Lemonade spans citrus + berry (gradient)', () => {
    expect(getCardGroups('pink-lemonade')).toEqual(['citrus', 'berry']);
  });

  it('Pina Colada spans ingredient + solo (gradient)', () => {
    expect(getCardGroups('pina-colada')).toEqual(['ingredient', 'solo']);
  });

  it('V Cola is cola-only (solid)', () => {
    expect(getCardGroups('v-cola')).toEqual(['cola']);
  });
});

describe('group colors cannot drift from the rules', () => {
  it('cola group contains every RULE1/RULE2 card', () => {
    for (const id of [...RULE1_EXACT, ...RULE2_EXACT]) {
      expect(COMBO_GROUP_MEMBERS.cola).toContain(id);
    }
  });

  it('citrus group contains every RULE3 card', () => {
    for (const id of RULE3_EXACT) {
      expect(COMBO_GROUP_MEMBERS.citrus).toContain(id);
    }
  });

  it('berry group contains every RULE7 card', () => {
    for (const id of RULE7_SET) {
      expect(COMBO_GROUP_MEMBERS.berry).toContain(id);
    }
  });

  it('ingredient group contains every share-tag holder', () => {
    const holders = FLAVORS.filter((f) => f.tags.some((t) => SHARE_TAGS.includes(t))).map(
      (f) => f.id
    );
    expect(holders.length).toBeGreaterThan(0);
    for (const id of holders) {
      expect(COMBO_GROUP_MEMBERS.ingredient).toContain(id);
    }
  });

  it('solo group contains the no-group effect cards', () => {
    expect(COMBO_GROUP_MEMBERS.solo).toContain('pina-colada');
    expect(COMBO_GROUP_MEMBERS.solo).toContain('cream-soda');
  });
});
