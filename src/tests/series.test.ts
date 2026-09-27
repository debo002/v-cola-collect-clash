import { describe, expect, it } from 'vitest';
import type { Player } from '../game/match';
import type { ZoneResult } from '../game/scoring';
import {
  emptySeries,
  matchWinner,
  recordMatchResult,
  SERIES_WINS,
  ZONES_TO_WIN_MATCH,
} from '../game/series';

function zone(winner: Player | null, id: string): ZoneResult {
  return {
    zoneId: id,
    base: { A: 0, B: 0 },
    bonus: { A: 0, B: 0 },
    totals: { A: 0, B: 0 },
    winner,
  };
}

describe('match winner (2 of 3 zones)', () => {
  it('uses the locked 2-zones-to-win number', () => {
    expect(ZONES_TO_WIN_MATCH).toBe(2);
  });

  it('awards the match on 2–1 and 3–0 splits', () => {
    expect(matchWinner([zone('A', 'cool'), zone('A', 'party'), zone('B', 'energy')])).toBe('A');
    expect(matchWinner([zone('B', 'cool'), zone('B', 'party'), zone('B', 'energy')])).toBe('B');
  });

  it('draws the match on 1–1–1 and on 1–0 with two drawn zones', () => {
    expect(matchWinner([zone('A', 'cool'), zone('B', 'party'), zone(null, 'energy')])).toBeNull();
    expect(matchWinner([zone('A', 'cool'), zone(null, 'party'), zone(null, 'energy')])).toBeNull();
  });
});

describe('best-of-3 series (first to 2 match wins)', () => {
  it('uses the locked first-to-2 number', () => {
    expect(SERIES_WINS).toBe(2);
  });

  it('decides on back-to-back wins', () => {
    let s = emptySeries();
    s = recordMatchResult(s, 'A');
    expect(s.winner).toBeNull();
    s = recordMatchResult(s, 'A');
    expect(s.winner).toBe('A');
    expect(s.matches).toBe(2);
  });

  it('decides across three matches (A, B, A)', () => {
    let s = emptySeries();
    s = recordMatchResult(s, 'A');
    s = recordMatchResult(s, 'B');
    s = recordMatchResult(s, 'A');
    expect(s.winner).toBe('A');
    expect(s.wins).toEqual({ A: 2, B: 1 });
  });

  it('drawn matches move nobody forward', () => {
    let s = emptySeries();
    s = recordMatchResult(s, null);
    s = recordMatchResult(s, 'B');
    expect(s.winner).toBeNull();
    expect(s.matches).toBe(2);
  });

  it('freezes once decided', () => {
    let s = emptySeries();
    s = recordMatchResult(s, 'B');
    s = recordMatchResult(s, 'B');
    const frozen = recordMatchResult(s, 'A');
    expect(frozen).toBe(s);
    expect(frozen.winner).toBe('B');
  });
});
