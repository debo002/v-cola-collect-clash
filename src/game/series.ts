import type { Player } from './match';
import type { ZoneResult } from './scoring';

/**
 * Match result (design doc §5): highest total wins a zone; winning 2 of 3
 * zones wins the match. Ranked runs matches as a best-of-3 series — first
 * to 2 match wins takes the series. Drawn zones/matches decide for nobody;
 * a drawn match simply doesn't move the series score.
 */
export const ZONES_TO_WIN_MATCH = 2;
export const SERIES_WINS = 2;

export function matchWinner(results: readonly ZoneResult[]): Player | null {
  let a = 0;
  let b = 0;
  for (const r of results) {
    if (r.winner === 'A') a++;
    else if (r.winner === 'B') b++;
  }
  if (a >= ZONES_TO_WIN_MATCH && a > b) return 'A';
  if (b >= ZONES_TO_WIN_MATCH && b > a) return 'B';
  return null;
}

export interface SeriesState {
  readonly wins: Readonly<Record<Player, number>>;
  /** Completed matches, including draws. */
  readonly matches: number;
  readonly winner: Player | null;
}

export function emptySeries(): SeriesState {
  return { wins: { A: 0, B: 0 }, matches: 0, winner: null };
}

export function recordMatchResult(series: SeriesState, winner: Player | null): SeriesState {
  if (series.winner) return series;
  const wins = {
    A: series.wins.A + (winner === 'A' ? 1 : 0),
    B: series.wins.B + (winner === 'B' ? 1 : 0),
  };
  const decided: Player | null = wins.A >= SERIES_WINS ? 'A' : wins.B >= SERIES_WINS ? 'B' : null;
  return { wins, matches: series.matches + 1, winner: decided };
}
