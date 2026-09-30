import { describe, expect, it } from 'vitest';
import { createMatch, placeCards, type Board, type MatchState, type PlacedCard } from '../game/match';
import { explainMatch, explainZone, scoreZone } from '../game/scoring';
import type { FlavorId } from '../game/types';
import { makeHand } from './helpers';

function side(powers: number[], offset = 0): readonly PlacedCard[] {
  return powers.map((power, i) => ({
    handIndex: offset + i,
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
    B: side(pair?.[1] ?? [], (pair?.[0] ?? []).length),
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

/** Sum of (to - from) per owner across adjustments. */
function sums(state: MatchState, zoneId: string) {
  const ex = explainZone(state, zoneId);
  const sum = { A: 0, B: 0 };
  for (const a of ex.adjustments) {
    if (a.owner) sum[a.owner] += a.to - a.from;
  }
  return { ex, sum };
}

describe('explainZone sums to ZoneResult.bonus', () => {
  it('COOL single lowest: one card +1', () => {
    const s = completeState([board({ cool: [[1], [3]] })]);
    const { ex, sum } = sums(s, 'cool');
    expect(sum).toEqual(scoreZone(s, 'cool').bonus);
    expect(ex.adjustments).toHaveLength(1);
    expect(ex.adjustments[0]).toMatchObject({ reason: 'stay-frosty', from: 1, to: 2 });
    expect(ex.noBonus).toBeNull();
  });

  it('COOL tied lowest across owners: no bonus', () => {
    const s = completeState([board({ cool: [[1], [1, 5]] })]);
    const { ex, sum } = sums(s, 'cool');
    expect(sum).toEqual({ A: 0, B: 0 });
    expect(ex.adjustments).toHaveLength(0);
    expect(ex.noBonus).toBe('none-tied-lowest');
  });

  it('COOL tied lowest same side: no bonus', () => {
    const s = completeState([board({ cool: [[2, 2], [5]] })]);
    const { ex, sum } = sums(s, 'cool');
    expect(sum).toEqual(scoreZone(s, 'cool').bonus);
    expect(ex.noBonus).toBe('none-tied-lowest');
  });

  it('COOL lone card is its own lowest: +1', () => {
    const s = completeState([board({ cool: [[4], []] })]);
    const { ex, sum } = sums(s, 'cool');
    expect(sum).toEqual({ A: 1, B: 0 });
    expect(ex.adjustments[0]?.target.kind).toBe('card');
  });

  it('COOL empty zone: no bonus', () => {
    const s = completeState([board({})]);
    const { ex, sum } = sums(s, 'cool');
    expect(sum).toEqual({ A: 0, B: 0 });
    expect(ex.noBonus).toBe('none-empty');
  });

  it('PARTY bigger side: zone-level +1 with counts', () => {
    const s = completeState([board({ party: [[3, 3], [4]] })]);
    const { ex, sum } = sums(s, 'party');
    expect(sum).toEqual({ A: 1, B: 0 });
    expect(ex.adjustments).toHaveLength(1);
    expect(ex.adjustments[0]).toMatchObject({
      owner: 'A',
      target: { kind: 'zone' },
      from: 6,
      to: 7,
      reason: 'more-merrier',
      counts: { A: 2, B: 1 },
    });
  });

  it('PARTY equal counts: no bonus', () => {
    const s = completeState([board({ party: [[2], [2]] })]);
    const { ex, sum } = sums(s, 'party');
    expect(sum).toEqual({ A: 0, B: 0 });
    expect(ex.noBonus).toBe('none-equal');
  });

  it('ENERGY smaller side: +1 per own card', () => {
    const s = completeState([board({ energy: [[4], [2, 2]] })]);
    const { ex, sum } = sums(s, 'energy');
    expect(sum).toEqual({ A: 1, B: 0 });
    expect(ex.adjustments).toHaveLength(1);
    expect(ex.adjustments[0]).toMatchObject({ reason: 'second-wind', from: 4, to: 5 });
  });

  it('ENERGY scales: one adjustment per smaller-side card', () => {
    const s = completeState([board({ energy: [[2, 2, 1], [5]] })]);
    const { ex, sum } = sums(s, 'energy');
    expect(sum).toEqual({ A: 0, B: 1 });
    expect(ex.adjustments).toHaveLength(1);
  });

  it('ENERGY equal counts: no bonus', () => {
    const s = completeState([board({ energy: [[3], [3]] })]);
    const { ex, sum } = sums(s, 'energy');
    expect(sum).toEqual({ A: 0, B: 0 });
    expect(ex.noBonus).toBe('none-equal');
  });

  it('cardRefs point at real cards across rounds', () => {
    const rounds = [
      board({ cool: [[1], []] }),
      board({ cool: [[], [4]] }),
      board({ cool: [[5], [2]] }),
    ];
    const s = completeState(rounds);
    const ex = explainZone(s, 'cool');
    // Lowest overall is round-1 A card (power 1, lone) → +1.
    expect(ex.adjustments).toHaveLength(1);
    const ref = ex.adjustments[0]?.target;
    expect(ref?.kind).toBe('card');
    if (ref?.kind === 'card') {
      expect(ref.ref).toEqual({ owner: 'A', round: 0, handIndex: 0 });
      const hit = s.boards[ref.ref.round].cool[ref.ref.owner].find(
        (c) => c.handIndex === ref.ref.handIndex
      );
      expect(hit?.power).toBe(1);
    }
  });

  it('explainMatch covers all zones and matches scoreMatch totals', () => {
    const s = completeState([
      board({ cool: [[1], [3]], party: [[3, 3], [4]], energy: [[4], [2, 2]] }),
    ]);
    const ex = explainMatch(s);
    expect(ex.map((e) => e.zoneId)).toEqual(['cool', 'party', 'energy']);
    for (const e of ex) {
      expect(e.totals).toEqual(scoreZone(s, e.zoneId).totals);
      const sum = { A: 0, B: 0 };
      for (const a of e.adjustments) if (a.owner) sum[a.owner] += a.to - a.from;
      expect(sum).toEqual(e.bonus);
    }
  });

  it('refuses unknown zones and unrevealed cards like scoreZone', () => {
    let s = createMatch(makeHand(), makeHand());
    s = placeCards(s, 'A', [{ handIndex: 0, zone: 'cool' }]);
    expect(() => explainZone(s, 'cool')).toThrow(RangeError);
    expect(() => explainZone(completeState([board({})]), 'mars')).toThrow(RangeError);
    expect(() => explainMatch(s)).toThrow(RangeError);
  });
});
