import { describe, expect, it } from 'vitest';
import {
  createMatch,
  placeCards,
  type Board,
  type MatchState,
  type PlacedCard,
} from '../game/match';
import { scoreMatch, scoreZone } from '../game/scoring';
import type { FlavorId } from '../game/types';
import { makeHand } from './helpers';

function side(powers: number[]): readonly PlacedCard[] {
  return powers.map((power, i) => ({
    handIndex: i,
    flavor: 'v-cola' as FlavorId,
    loaner: false,
    power,
  }));
}

function board(zones: {
  cool?: [number[], number[]];
  party?: [number[], number[]];
  energy?: [number[], number[]];
}): Board {
  const entry = (pair?: [number[], number[]]) => ({
    A: side(pair?.[0] ?? []),
    B: side(pair?.[1] ?? []),
  });
  return { cool: entry(zones.cool), party: entry(zones.party), energy: entry(zones.energy) };
}

function completeState(boards: Board[]): MatchState {
  return {
    round: 3,
    hands: { A: [], B: [] },
    boards,
    locks: { A: false, B: false },
    phase: 'complete',
  };
}

describe('COOL — Stay Frosty', () => {
  it('gives +1 to the single lowest-power card', () => {
    const r = scoreZone(completeState([board({ cool: [[1], [3]] })]), 'cool');
    expect(r.base).toEqual({ A: 1, B: 3 });
    expect(r.bonus).toEqual({ A: 1, B: 0 });
    expect(r.totals).toEqual({ A: 2, B: 3 });
    expect(r.winner).toBe('B');
  });

  it('gives no bonus on tied lowest, even across owners', () => {
    const r = scoreZone(completeState([board({ cool: [[1], [1, 5]] })]), 'cool');
    expect(r.bonus).toEqual({ A: 0, B: 0 });
    expect(r.totals).toEqual({ A: 1, B: 6 });
  });

  it('gives no bonus when both sides tie the whole zone', () => {
    const r = scoreZone(completeState([board({ cool: [[2], [2]] })]), 'cool');
    expect(r.bonus).toEqual({ A: 0, B: 0 });
    expect(r.winner).toBeNull();
  });

  it('bonuses a lone card (it is the single lowest)', () => {
    const r = scoreZone(completeState([board({ cool: [[4], []] })]), 'cool');
    expect(r.bonus).toEqual({ A: 1, B: 0 });
    expect(r.winner).toBe('A');
  });

  it('scores an empty zone 0–0 with no winner', () => {
    const r = scoreZone(completeState([board({})]), 'cool');
    expect(r.totals).toEqual({ A: 0, B: 0 });
    expect(r.winner).toBeNull();
  });
});

describe('PARTY — The More The Merrier', () => {
  it('adds +1 to the side with more cards', () => {
    const r = scoreZone(completeState([board({ party: [[3, 3], [4]] })]), 'party');
    expect(r.base).toEqual({ A: 6, B: 4 });
    expect(r.bonus).toEqual({ A: 1, B: 0 });
    expect(r.totals).toEqual({ A: 7, B: 4 });
    expect(r.winner).toBe('A');
  });

  it('adds nothing on equal counts', () => {
    const r = scoreZone(completeState([board({ party: [[2], [2]] })]), 'party');
    expect(r.bonus).toEqual({ A: 0, B: 0 });
    expect(r.winner).toBeNull();
  });
});

describe('ENERGY — Second Wind', () => {
  it('gives each card of the smaller side +1', () => {
    const r = scoreZone(completeState([board({ energy: [[4], [2, 2]] })]), 'energy');
    expect(r.base).toEqual({ A: 4, B: 4 });
    expect(r.bonus).toEqual({ A: 1, B: 0 });
    expect(r.totals).toEqual({ A: 5, B: 4 });
    expect(r.winner).toBe('A');
  });

  it('scales with the smaller side (one +1 per own card)', () => {
    const r = scoreZone(completeState([board({ energy: [[2, 2], [5]] })]), 'energy');
    expect(r.bonus).toEqual({ A: 0, B: 1 });
    expect(r.totals).toEqual({ A: 4, B: 6 });
    expect(r.winner).toBe('B');
  });

  it('adds nothing on equal counts', () => {
    const r = scoreZone(completeState([board({ energy: [[3], [3]] })]), 'energy');
    expect(r.bonus).toEqual({ A: 0, B: 0 });
  });
});

describe('match scoring', () => {
  it('accumulates all three rounds into each zone', () => {
    const rounds = [
      board({ party: [[2], [1]] }),
      board({ party: [[3], [1]] }),
      board({ party: [[], [1]] }),
    ];
    const results = scoreMatch(completeState(rounds));
    const party = results.find((r) => r.zoneId === 'party');
    expect(party?.base).toEqual({ A: 5, B: 3 });
    expect(party?.bonus).toEqual({ A: 0, B: 1 });
    expect(party?.totals).toEqual({ A: 5, B: 4 });
    expect(party?.winner).toBe('A');
    expect(results).toHaveLength(3);
  });

  it('refuses to score before round 3', () => {
    const s = createMatch(makeHand(), makeHand());
    expect(() => scoreMatch(s)).toThrow(RangeError);
  });

  it('refuses unrevealed cards and unknown zones', () => {
    let s = createMatch(makeHand(), makeHand());
    s = placeCards(s, 'A', [{ handIndex: 0, zone: 'cool' }]);
    expect(() => scoreZone(s, 'cool')).toThrow(RangeError);
    expect(() => scoreZone(completeState([board({})]), 'mars')).toThrow(RangeError);
  });
});
