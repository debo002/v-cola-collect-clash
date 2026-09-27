import { describe, expect, it } from 'vitest';
import {
  addCopy,
  countOf,
  duplicateCount,
  emptyCollection,
  ownedFlavorIds,
  ownsFlavor,
  removeCopy,
  sanitizeCollection,
  totalCopies,
} from '../game/collection';

describe('collection ownership', () => {
  it('starts empty', () => {
    const c = emptyCollection();
    expect(ownsFlavor(c, 'v-cola')).toBe(false);
    expect(countOf(c, 'v-cola')).toBe(0);
    expect(ownedFlavorIds(c)).toEqual([]);
    expect(totalCopies(c)).toBe(0);
  });

  it('adds one copy per unlock (1 scan = 1 flavor)', () => {
    let c = emptyCollection();
    c = addCopy(c, 'v-cola');
    expect(countOf(c, 'v-cola')).toBe(1);
    expect(ownsFlavor(c, 'v-cola')).toBe(true);
    c = addCopy(c, 'v-cola');
    expect(countOf(c, 'v-cola')).toBe(2);
    expect(totalCopies(c)).toBe(2);
  });

  it('rejects unknown flavor ids on add', () => {
    expect(() => addCopy(emptyCollection(), 'not-a-flavor')).toThrow(RangeError);
  });

  it('counts duplicates as copies beyond the first', () => {
    let c = emptyCollection();
    expect(duplicateCount(c, 'blueberry')).toBe(0);
    c = addCopy(c, 'blueberry');
    expect(duplicateCount(c, 'blueberry')).toBe(0);
    c = addCopy(c, 'blueberry');
    c = addCopy(c, 'blueberry');
    expect(duplicateCount(c, 'blueberry')).toBe(2);
  });

  it('removes copies down to zero, then stays a no-op', () => {
    let c = addCopy(addCopy(emptyCollection(), 'v-lemon'), 'v-lemon');
    c = removeCopy(c, 'v-lemon');
    expect(countOf(c, 'v-lemon')).toBe(1);
    expect(ownsFlavor(c, 'v-lemon')).toBe(true);
    c = removeCopy(c, 'v-lemon');
    expect(countOf(c, 'v-lemon')).toBe(0);
    expect(ownsFlavor(c, 'v-lemon')).toBe(false);
    expect(ownedFlavorIds(c)).not.toContain('v-lemon');
    const same = removeCopy(c, 'v-lemon');
    expect(countOf(same, 'v-lemon')).toBe(0);
  });

  it('does not mutate the input object', () => {
    const before = addCopy(emptyCollection(), 'pomegranate');
    const after = addCopy(before, 'pomegranate');
    expect(countOf(before, 'pomegranate')).toBe(1);
    expect(countOf(after, 'pomegranate')).toBe(2);
  });

  it('lists owned ids in canonical flavor order', () => {
    let c = emptyCollection();
    c = addCopy(c, 'v7-pineapple-malt');
    c = addCopy(c, 'v-cola');
    c = addCopy(c, 'blueberry');
    expect(ownedFlavorIds(c)).toEqual(['v-cola', 'blueberry', 'v7-pineapple-malt']);
  });

  it('sanitizes loaded data: drops unknown ids and junk counts', () => {
    expect(
      sanitizeCollection({
        'v-cola': 2,
        'not-a-flavor': 5,
        blueberry: 0,
        pomegranate: -1,
        'lemon-mint': 2.7,
        'pina-colada': 'x',
      })
    ).toEqual({ 'v-cola': 2, 'lemon-mint': 2 });
    expect(sanitizeCollection(null)).toEqual({});
    expect(sanitizeCollection('junk')).toEqual({});
  });

  it('never stores Power on the collection', () => {
    const c = addCopy(emptyCollection(), 'cream-soda');
    expect(JSON.stringify(c)).not.toMatch(/power/i);
  });
});
