import type { HandCard } from './hands';
import { intBelow, type Rng } from './rng';
import type { FlavorId } from './types';
import { ZONES } from './zones';

/**
 * Match core (design doc §5): 3 rounds, 1–2 cards placed per player per round
 * into any zone, simultaneous reveal with fresh Power rolls.
 *
 * Scoring lives in `scoring.ts`; series format in `series.ts`. This module only
 * moves cards onto the board and reveals them. All updates are immutable.
 */
export const ROUNDS = 3;
export const MIN_PLACE = 1;
export const MAX_PLACE = 2;
// Approved override (2026-09-27): spec §5 says a 12s flat timer; Abdullah
// raised it to 20s after playtesting — too fast to read the board on a phone.
// Relaxed override (2026-09-30): domino-style think time — 60s flat per turn.
export const TIMER_SECONDS = 60;

export type Player = 'A' | 'B';
export type ZoneId = string;

const ZONE_IDS = new Set(ZONES.map((z) => z.id));

export interface PlacedCard {
  readonly handIndex: number;
  readonly flavor: FlavorId;
  readonly loaner: boolean;
  /** Null until the round is revealed — Power rolls fresh at reveal. */
  readonly power: number | null;
}

export interface ZoneSide {
  readonly A: readonly PlacedCard[];
  readonly B: readonly PlacedCard[];
}

export type Board = { readonly [zoneId: string]: ZoneSide };

export type MatchPhase = 'placing' | 'complete';

export interface MatchState {
  readonly round: number;
  readonly hands: Readonly<Record<Player, readonly HandCard[]>>;
  readonly boards: readonly Board[];
  readonly locks: Readonly<Record<Player, boolean>>;
  readonly phase: MatchPhase;
}

export interface Placement {
  readonly handIndex: number;
  readonly zone: ZoneId;
}

function emptyBoard(): Board {
  const board: { [zoneId: string]: ZoneSide } = {};
  for (const zone of ZONES) board[zone.id] = { A: [], B: [] };
  return board;
}

function emptyBoards(): Board[] {
  return Array.from({ length: ROUNDS }, () => emptyBoard());
}

export function createMatch(handA: readonly HandCard[], handB: readonly HandCard[]): MatchState {
  if (handA.length !== 6 || handB.length !== 6) {
    throw new RangeError('Each player must bring exactly 6 cards');
  }
  return {
    round: 1,
    hands: { A: handA, B: handB },
    boards: emptyBoards(),
    locks: { A: false, B: false },
    phase: 'placing',
  };
}

export function currentBoard(state: MatchState): Board {
  const board = state.boards[state.round - 1];
  if (!board) throw new RangeError('Match is complete');
  return board;
}

function usedIndices(state: MatchState, player: Player): Set<number> {
  const used = new Set<number>();
  for (const board of state.boards) {
    for (const zoneId of Object.keys(board)) {
      const side = board[zoneId] as ZoneSide;
      for (const card of side[player]) used.add(card.handIndex);
    }
  }
  return used;
}

export function unusedIndices(state: MatchState, player: Player): number[] {
  const used = usedIndices(state, player);
  return state.hands[player].map((_, i) => i).filter((i) => !used.has(i));
}

/**
 * Cards spent in EARLIER rounds. The current round is excluded on purpose:
 * placeCards replaces this round's picks, so re-submitting them together
 * with a second card must not read as "already used".
 */
function usedInEarlierRounds(state: MatchState, player: Player): Set<number> {
  const used = new Set<number>();
  state.boards.forEach((board, i) => {
    if (i === state.round - 1) return;
    for (const zoneId of Object.keys(board)) {
      for (const card of (board[zoneId] as ZoneSide)[player]) used.add(card.handIndex);
    }
  });
  return used;
}

function setBoard(state: MatchState, board: Board): MatchState {
  const boards = state.boards.map((b, i) => (i === state.round - 1 ? board : b));
  return { ...state, boards };
}

export function placeCards(
  state: MatchState,
  player: Player,
  placements: readonly Placement[]
): MatchState {
  if (state.phase !== 'placing') throw new RangeError('Match is not accepting placements');
  if (state.locks[player]) throw new RangeError('Player has already locked in');
  if (placements.length < MIN_PLACE || placements.length > MAX_PLACE) {
    throw new RangeError(`Place ${MIN_PLACE}–${MAX_PLACE} cards per round`);
  }
  const used = usedInEarlierRounds(state, player);
  const seen = new Set<number>();
  for (const p of placements) {
    if (!ZONE_IDS.has(p.zone)) throw new RangeError(`Unknown zone: ${p.zone}`);
    if (
      !Number.isInteger(p.handIndex) ||
      p.handIndex < 0 ||
      p.handIndex >= state.hands[player].length
    ) {
      throw new RangeError(`Card not in hand: ${p.handIndex}`);
    }
    if (used.has(p.handIndex) || seen.has(p.handIndex)) {
      throw new RangeError(`Card already used: ${p.handIndex}`);
    }
    seen.add(p.handIndex);
  }
  // Replace this player's current-round placements (re-pick before locking).
  const board = currentBoard(state);
  const next: { [zoneId: string]: ZoneSide } = {};
  for (const zoneId of Object.keys(board)) {
    const side = board[zoneId] as ZoneSide;
    const other: Player = player === 'A' ? 'B' : 'A';
    next[zoneId] = player === 'A' ? { A: [], B: side[other] } : { A: side[other], B: [] };
  }
  for (const p of placements) {
    const card = state.hands[player][p.handIndex] as HandCard;
    const side = next[p.zone] as ZoneSide;
    next[p.zone] = {
      ...side,
      [player]: [
        ...side[player],
        { handIndex: p.handIndex, flavor: card.flavor, loaner: card.loaner, power: null },
      ],
    };
  }
  return setBoard(state, next);
}

/** Pull one placed card back to the hand (pre-lock only). */
export function unplaceCard(state: MatchState, player: Player, handIndex: number): MatchState {
  if (state.phase !== 'placing') throw new RangeError('Match is not accepting placements');
  if (state.locks[player]) throw new RangeError('Player has already locked in');
  const board = currentBoard(state);
  let found = false;
  const next: { [zoneId: string]: ZoneSide } = {};
  for (const zoneId of Object.keys(board)) {
    const side = board[zoneId] as ZoneSide;
    const kept = side[player].filter((c) => {
      if (c.handIndex === handIndex) {
        found = true;
        return false;
      }
      return true;
    });
    next[zoneId] = { ...side, [player]: kept };
  }
  if (!found) throw new RangeError(`Card is not placed: ${handIndex}`);
  return setBoard(state, next);
}

export function lockPlayer(state: MatchState, player: Player): MatchState {
  if (state.phase !== 'placing') throw new RangeError('Match is not accepting placements');
  const board = currentBoard(state);
  let placed = 0;
  for (const zoneId of Object.keys(board)) {
    placed += (board[zoneId] as ZoneSide)[player].length;
  }
  if (placed < MIN_PLACE) throw new RangeError('Place at least 1 card before locking in');
  return { ...state, locks: { ...state.locks, [player]: true } };
}

export function bothLocked(state: MatchState): boolean {
  return state.locks.A && state.locks.B;
}

/**
 * Simultaneous reveal once both players lock in: powers dealt with the hand
 * stand (rolled fresh at deal, never stored), then advance the round
 * (or complete the match after round 3).
 */
export function revealRound(state: MatchState): MatchState {
  if (state.phase !== 'placing') throw new RangeError('Match is not accepting placements');
  if (!bothLocked(state)) throw new RangeError('Both players must lock in before reveal');
  const board = currentBoard(state);
  const revealed: { [zoneId: string]: ZoneSide } = {};
  for (const zoneId of Object.keys(board)) {
    const side = board[zoneId] as ZoneSide;
    const stand = (owner: Player) =>
      side[owner].map((c) => ({
        ...c,
        power: (state.hands[owner][c.handIndex] as HandCard).power,
      }));
    revealed[zoneId] = { A: stand('A'), B: stand('B') };
  }
  const boards = state.boards.map((b, i) => (i === state.round - 1 ? revealed : b));
  if (state.round >= ROUNDS) {
    return { ...state, boards, locks: { A: false, B: false }, phase: 'complete' };
  }
  return {
    ...state,
    boards,
    locks: { A: false, B: false },
    round: state.round + 1,
  };
}

/**
 * Timeout (60s flat): auto-place one random unused card into a random zone,
 * then lock in. With nothing left unused, just locks in.
 */
export function autoPlaceForTimeout(
  state: MatchState,
  player: Player,
  rng: Rng = Math.random
): MatchState {
  if (state.phase !== 'placing' || state.locks[player]) return state;
  const unused = unusedIndices(state, player);
  if (unused.length === 0) return lockPlayerIfPlaced(state, player);
  const handIndex = unused[intBelow(rng, unused.length)] as number;
  const zoneIds = Object.keys(currentBoard(state));
  const zone = zoneIds[intBelow(rng, zoneIds.length)] as string;
  const placed = placeCards(state, player, [{ handIndex, zone }]);
  return { ...placed, locks: { ...placed.locks, [player]: true } };
}

function lockPlayerIfPlaced(state: MatchState, player: Player): MatchState {
  try {
    return lockPlayer(state, player);
  } catch {
    return state;
  }
}
