import { describe, expect, it } from 'vitest';
import { FLAVOR_IDS } from '../game/cards';
import type { HandCard } from '../game/hands';
import {
  autoPlaceForTimeout,
  bothLocked,
  createMatch,
  currentBoard,
  lockPlayer,
  placeCards,
  revealRound,
  TIMER_SECONDS,
  unplaceCard,
  unusedIndices,
  type MatchState,
} from '../game/match';
import { MAX_POWER, MIN_POWER, rollPower, type Rng } from '../game/rng';

const zero: Rng = () => 0;

function makeHand(powers: readonly number[] = [3, 3, 3, 3, 3, 3]): HandCard[] {
  return FLAVOR_IDS.slice(0, 6).map((flavor, i) => ({
    flavor,
    loaner: false,
    power: powers[i] ?? 3,
  }));
}

function freshMatch(): MatchState {
  return createMatch(makeHand(), makeHand());
}

function playRound(state: MatchState, rng: Rng = zero): MatchState {
  const a = autoPlaceForTimeout(state, 'A', rng);
  return autoPlaceForTimeout(a, 'B', rng);
}

describe('match setup', () => {
  it('requires exactly 6 cards per hand', () => {
    expect(() => createMatch(makeHand().slice(0, 5), makeHand())).toThrow(RangeError);
  });

  it('uses the approved 20-second turn timer (spec §5 said 12s)', () => {
    expect(TIMER_SECONDS).toBe(20);
  });

  it('tracks all 6 cards as unused at the start', () => {
    expect(unusedIndices(freshMatch(), 'A')).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('placement', () => {
  it('accepts 1–2 cards into any zone', () => {
    const s = placeCards(freshMatch(), 'A', [
      { handIndex: 0, zone: 'cool' },
      { handIndex: 1, zone: 'party' },
    ]);
    expect(currentBoard(s)['cool']?.['A']).toHaveLength(1);
    expect(currentBoard(s)['party']?.['A']).toHaveLength(1);
    expect(unusedIndices(s, 'A')).toEqual([2, 3, 4, 5]);
  });

  it('rejects 0 or 3+ cards, unknown zones, and reused cards', () => {
    expect(() => placeCards(freshMatch(), 'A', [])).toThrow(RangeError);
    expect(() =>
      placeCards(freshMatch(), 'A', [
        { handIndex: 0, zone: 'cool' },
        { handIndex: 1, zone: 'cool' },
        { handIndex: 2, zone: 'cool' },
      ])
    ).toThrow(RangeError);
    expect(() => placeCards(freshMatch(), 'A', [{ handIndex: 0, zone: 'mars' }])).toThrow(
      RangeError
    );
    const s = placeCards(freshMatch(), 'A', [{ handIndex: 0, zone: 'cool' }]);
    expect(() =>
      placeCards(s, 'A', [
        { handIndex: 0, zone: 'party' },
        { handIndex: 2, zone: 'party' },
      ])
    ).toThrow(RangeError);
  });

  it('lets a player re-pick before locking, and pull a card back', () => {
    let s = placeCards(freshMatch(), 'A', [{ handIndex: 0, zone: 'cool' }]);
    s = unplaceCard(s, 'A', 0);
    expect(currentBoard(s)['cool']?.['A']).toHaveLength(0);
    expect(unusedIndices(s, 'A')).toContain(0);
    expect(() => unplaceCard(s, 'A', 0)).toThrow(RangeError);
  });

  it('blocks placement after locking in', () => {
    let s = placeCards(freshMatch(), 'A', [{ handIndex: 0, zone: 'cool' }]);
    s = lockPlayer(s, 'A');
    expect(() => placeCards(s, 'A', [{ handIndex: 1, zone: 'cool' }])).toThrow(RangeError);
    expect(() => unplaceCard(s, 'A', 0)).toThrow(RangeError);
  });
});

describe('locks and reveal', () => {
  it('requires at least 1 placed card to lock', () => {
    expect(() => lockPlayer(freshMatch(), 'A')).toThrow(RangeError);
  });

  it('reveals only when both players lock, keeping dealt powers', () => {
    let s = createMatch(makeHand([2, 3, 3, 3, 3, 3]), makeHand([5, 3, 3, 3, 3, 3]));
    s = placeCards(s, 'A', [{ handIndex: 0, zone: 'cool' }]);
    s = placeCards(s, 'B', [{ handIndex: 0, zone: 'cool' }]);
    s = lockPlayer(s, 'A');
    expect(bothLocked(s)).toBe(false);
    expect(() => revealRound(s)).toThrow(RangeError);
    s = lockPlayer(s, 'B');
    expect(bothLocked(s)).toBe(true);
    s = revealRound(s);
    const revealed = s.boards[0]?.['cool'];
    expect(revealed?.['A'][0]?.power).toBe(2);
    expect(revealed?.['B'][0]?.power).toBe(5);
    expect(s.round).toBe(2);
    expect(bothLocked(s)).toBe(false);
  });

  it('rollPower always lands between 1 and 5', () => {
    for (const v of [0, 0.2, 0.5, 0.8, 0.9999]) {
      const p = rollPower(() => v);
      expect(p).toBeGreaterThanOrEqual(MIN_POWER);
      expect(p).toBeLessThanOrEqual(MAX_POWER);
    }
  });
});

describe('timeout', () => {
  it('auto-places one random unused card into a random zone and locks', () => {
    const s = autoPlaceForTimeout(freshMatch(), 'A', zero);
    expect(s.locks.A).toBe(true);
    expect(currentBoard(s)['cool']?.['A']).toHaveLength(1);
    expect(currentBoard(s)['cool']?.['A'][0]?.handIndex).toBe(0);
    expect(unusedIndices(s, 'A')).toHaveLength(5);
  });

  it('leaves an already-locked player untouched', () => {
    let s = placeCards(freshMatch(), 'A', [{ handIndex: 3, zone: 'energy' }]);
    s = lockPlayer(s, 'A');
    const same = autoPlaceForTimeout(s, 'A', zero);
    expect(currentBoard(same)['energy']?.['A']).toHaveLength(1);
  });
});

describe('full match flow', () => {
  it('plays 3 rounds then completes', () => {
    let s = freshMatch();
    for (let round = 1; round <= 3; round++) {
      s = playRound(s);
      s = revealRound(s);
    }
    expect(s.phase).toBe('complete');
    expect(s.round).toBe(3);
    expect(() => placeCards(s, 'A', [{ handIndex: 0, zone: 'cool' }])).toThrow(RangeError);
  });
});
