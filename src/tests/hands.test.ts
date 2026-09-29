import { describe, expect, it } from 'vitest';
import { addCopy, emptyCollection } from '../game/collection';
import { buildCustomHand, buildQuickPlayHand, HAND_SIZE } from '../game/hands';
import { MAX_POWER, MIN_POWER, type Rng } from '../game/rng';

const zero: Rng = () => 0;

function fullCollection() {
  let c = emptyCollection();
  for (const id of [
    'v-cola',
    'v-diet-cola',
    'v-lemon',
    'pink-lemonade',
    'cream-soda',
    'pomegranate',
    'blueberry',
    'lemon-mint',
    'pina-colada',
    'v7-apple-malt',
    'v7-pineapple-malt',
  ] as const) {
    c = addCopy(c, id);
  }
  return c;
}

describe('quick play hand', () => {
  it('always deals exactly 6 cards', () => {
    expect(buildQuickPlayHand(fullCollection(), zero)).toHaveLength(HAND_SIZE);
    expect(buildQuickPlayHand(emptyCollection(), zero)).toHaveLength(HAND_SIZE);
  });

  it('uses only owned cards with no loaners when the collection covers 6', () => {
    const hand = buildQuickPlayHand(fullCollection(), zero);
    expect(hand.every((c) => !c.loaner)).toBe(true);
  });

  it('fills the gap with loaners when the player owns fewer than 6', () => {
    let c = emptyCollection();
    c = addCopy(c, 'v-cola');
    c = addCopy(c, 'blueberry');
    const hand = buildQuickPlayHand(c, zero);
    expect(hand.filter((card) => !card.loaner)).toHaveLength(2);
    expect(hand.filter((card) => card.loaner)).toHaveLength(4);
  });

  it('is all loaners on an empty collection', () => {
    const hand = buildQuickPlayHand(emptyCollection(), zero);
    expect(hand.every((card) => card.loaner)).toBe(true);
  });

  it('never deals duplicate cans — 6 distinct flavors, loaners fill uniquely', () => {
    let c = emptyCollection();
    for (let i = 0; i < 6; i++) c = addCopy(c, 'pomegranate');
    const hand = buildQuickPlayHand(c, zero);
    const flavors = hand.map((card) => card.flavor);
    expect(new Set(flavors).size).toBe(HAND_SIZE);
    expect(hand.filter((card) => !card.loaner)).toHaveLength(1);
    expect(hand.filter((card) => card.loaner)).toHaveLength(5);
  });

  it('deals 6 distinct owned flavors with no loaners on a full collection', () => {
    const hand = buildQuickPlayHand(fullCollection(), zero);
    expect(new Set(hand.map((card) => card.flavor)).size).toBe(HAND_SIZE);
    expect(hand.every((card) => !card.loaner)).toBe(true);
  });
});

describe('custom hand', () => {
  it('keeps manual picks and auto-fills the rest from owned cards', () => {
    const hand = buildCustomHand(fullCollection(), ['v-cola', 'blueberry'], zero);
    expect(hand).toHaveLength(HAND_SIZE);
    expect(hand.filter((c) => c.flavor === 'v-cola' && !c.loaner)).toHaveLength(1);
    expect(hand.filter((c) => c.flavor === 'blueberry' && !c.loaner)).toHaveLength(1);
    expect(hand.some((c) => c.loaner)).toBe(false);
  });

  it('falls back to loaners when owned cards run out', () => {
    let c = emptyCollection();
    c = addCopy(c, 'v-cola');
    const hand = buildCustomHand(c, ['v-cola'], zero);
    expect(hand).toHaveLength(HAND_SIZE);
    expect(hand.filter((card) => card.loaner)).toHaveLength(5);
  });

  it('rejects unowned picks, unknown ids, and overlong pick lists', () => {
    const c = addCopy(emptyCollection(), 'v-cola');
    expect(() => buildCustomHand(c, ['blueberry'], zero)).toThrow(RangeError);
    expect(() => buildCustomHand(c, ['mystery'], zero)).toThrow(RangeError);
    expect(() =>
      buildCustomHand(
        fullCollection(),
        ['v-cola', 'v-cola', 'v-cola', 'v-cola', 'v-cola', 'v-cola', 'v-cola'],
        zero
      )
    ).toThrow(RangeError);
  });

  it('rejects picking the same flavor more times than owned', () => {
    const c = addCopy(emptyCollection(), 'v-cola');
    expect(() => buildCustomHand(c, ['v-cola', 'v-cola'], zero)).toThrow(RangeError);
  });

  it('rolls power 1–5 fresh on every dealt card', () => {
    const low = buildQuickPlayHand(fullCollection(), zero);
    expect(low.every((c) => c.power === MIN_POWER)).toBe(true);
    const high = buildQuickPlayHand(fullCollection(), () => 0.9999);
    expect(high.every((c) => c.power === MAX_POWER)).toBe(true);
    const custom = buildCustomHand(fullCollection(), ['v-cola'], zero);
    expect(custom.find((c) => !c.loaner && c.flavor === 'v-cola')?.power).toBe(MIN_POWER);
  });
});
