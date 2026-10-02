import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_CONFIG,
  DEFAULT_FIXED_POWER,
  DEFAULT_GAME_CONFIG,
  validateGameConfig,
} from '../game/config';
import { drawFromDeck } from '../game/dealing';
import { applyGameConfig } from '../game/hands';
import { resolveZone } from '../game/resolve';
import { createMatch, placeCards } from '../game/match';
import type { HandCard } from '../game/hands';

const rng = () => 0;
const hand: HandCard[] = [
  'blueberry',
  'pomegranate',
  'pink-lemonade',
  'v-cola',
  'v-diet-cola',
  'cream-soda',
].map((flavor) => ({ flavor, loaner: true, power: 3 }));

describe('custom game configuration', () => {
  it('keeps Quick Play defaults aligned with the existing rules', () => {
    expect(DEFAULT_GAME_CONFIG).toMatchObject({
      mode: 'quick',
      dealing: 'reveal-all',
      maxPlacedPerRound: 2,
      power: 'random',
      effectsEnabled: true,
    });
    expect(createMatch(hand, hand, DEFAULT_GAME_CONFIG).maxPlacedPerRound).toBe(2);
  });

  it('applies fixed power as match-only hand values', () => {
    const out = applyGameConfig(
      hand,
      {
        ...DEFAULT_CUSTOM_CONFIG,
        deck: { kind: 'custom', flavors: hand.map((c) => c.flavor) },
        power: 'fixed',
        fixedPower: DEFAULT_FIXED_POWER,
      },
      rng
    );
    expect(out.map((c) => c.power)).toEqual([1, 1, 2, 4, 4, 5]);
  });

  it('keeps randomized match power in the 1–5 range', () => {
    const out = applyGameConfig(hand, { ...DEFAULT_GAME_CONFIG, power: 'random' }, rng);
    expect(out.every((card) => card.power >= 1 && card.power <= 5)).toBe(true);
  });

  it('effects off compares plain power, ignoring card and zone effects', () => {
    const zone = {
      zoneId: 'party',
      effect: 'more-the-merrier' as const,
      cards: {
        A: [{ cardId: 'a', flavor: 'blueberry' as const, basePower: 2, owner: 'A' as const }],
        B: [{ cardId: 'b', flavor: 'v-cola' as const, basePower: 1, owner: 'B' as const }],
      },
    };
    expect(resolveZone(zone, undefined, false).totals).toEqual({ A: 2, B: 1 });
  });

  it('enforces the configured placement maximum', () => {
    const state = createMatch(hand, hand, { ...DEFAULT_CUSTOM_CONFIG, maxPlacedPerRound: 2 });
    expect(() =>
      placeCards(
        state,
        'A',
        [0, 1, 2].map((handIndex) => ({ handIndex, zone: 'cool' }))
      )
    ).toThrow(RangeError);
  });

  it('retains the existing hand and draws only a card from its deck', () => {
    const before = { hand: [hand[0]!], deck: ['v-cola', 'cream-soda'] as const };
    const after = drawFromDeck(before, rng);
    expect(after.hand[0]).toBe(before.hand[0]);
    expect(after.hand.map((c) => c.flavor)).toContain('v-cola');
    expect(after.deck).toEqual(['cream-soda']);
    expect(new Set(after.hand.map((c) => c.flavor)).size).toBe(after.hand.length);
  });

  it('rejects decks too small to play three rounds and invalid power ranges', () => {
    expect(
      validateGameConfig({
        ...DEFAULT_CUSTOM_CONFIG,
        deck: { kind: 'custom', flavors: ['blueberry', 'v-cola'] },
      })
    ).toBe('cannot-finish');
    expect(
      validateGameConfig({
        ...DEFAULT_CUSTOM_CONFIG,
        deck: { kind: 'custom', flavors: ['blueberry', 'v-cola', 'cream-soda'] },
        power: 'fixed',
        fixedPower: { blueberry: 6, 'v-cola': 2, 'cream-soda': 1 },
      })
    ).toBe('power-invalid');
  });
});
