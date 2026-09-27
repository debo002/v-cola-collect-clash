import { describe, expect, it } from 'vitest';
import { FLAVORS, FLAVOR_IDS, getFlavorById, isFlavorId } from '../game/cards';

describe('flavor data source', () => {
  it('has exactly the 11 flavors from the design doc', () => {
    expect(FLAVORS).toHaveLength(11);
    expect(FLAVOR_IDS).toHaveLength(11);
  });

  it('has unique ids and names', () => {
    expect(new Set(FLAVOR_IDS).size).toBe(11);
    expect(new Set(FLAVORS.map((f) => f.name)).size).toBe(11);
  });

  it('resolves every id back to its flavor', () => {
    for (const flavor of FLAVORS) {
      expect(getFlavorById(flavor.id)).toEqual(flavor);
      expect(isFlavorId(flavor.id)).toBe(true);
    }
  });

  it('rejects unknown ids', () => {
    expect(getFlavorById('not-a-flavor')).toBeUndefined();
    expect(isFlavorId('not-a-flavor')).toBe(false);
  });

  it('stores no Power on cards (rolled fresh per match)', () => {
    for (const flavor of FLAVORS) {
      expect(flavor).not.toHaveProperty('power');
    }
  });
});
