import type {
  BoardView,
  CurrentBoardView,
  PlayerView,
  RevealedBoardView,
  VisiblePlacedCard,
} from './controller';
import type { Player } from './match';
import { explainMatch, scoreMatch } from './scoring';
import { matchWinner } from './series';
import { ZONES } from './zones';
import type { RoomState } from './matchEngine';

/**
 * Pure redacted view builder (no DOM, no timers, no randomness).
 * The server owns the RoomState; each player only ever receives their own
 * PlayerView. The opponent's current-round placements are NOT included —
 * no cards, no counts, no zone presence — so leaking hidden info is a type
 * error, not a runtime check. The opponent's cards appear only on revealed
 * boards (past rounds, or the round being shown during reveal). Results,
 * winner and explanations are computed here when the match is complete —
 * callers never pass them in.
 */
export function buildPlayerView(room: RoomState, seat: Player): PlayerView {
  const match = room.match;
  const foe: Player = seat === 'A' ? 'B' : 'A';
  const boards: BoardView[] = [];
  const visibleCount = match.phase === 'complete' ? match.boards.length : match.round;
  for (let bi = 0; bi < visibleCount; bi += 1) {
    const board = match.boards[bi];
    if (board === undefined) continue;
    const revealed = room.stage === 'complete' || bi < match.round - 1;
    if (revealed) {
      const zones: Record<string, RevealedBoardView['zones'][string]> = {};
      for (const zone of ZONES) {
        const side = board[zone.id];
        const mine: VisiblePlacedCard[] = [];
        const foeCards: VisiblePlacedCard[] = [];
        if (side !== undefined) {
          for (const card of side[seat]) {
            const held = match.hands[seat][card.handIndex];
            if (held === undefined) continue;
            mine.push({
              handIndex: card.handIndex,
              flavor: held.flavor,
              power: held.power,
              loaner: held.loaner,
            });
          }
          for (const card of side[foe]) {
            if (card.power === null) continue;
            foeCards.push({
              handIndex: card.handIndex,
              flavor: card.flavor,
              power: card.power,
              loaner: card.loaner,
            });
          }
        }
        zones[zone.id] = { mine, foe: foeCards };
      }
      boards.push({ kind: 'revealed', zones });
    } else {
      const zones: Record<string, CurrentBoardView['zones'][string]> = {};
      for (const zone of ZONES) {
        const side = board[zone.id];
        const mine: VisiblePlacedCard[] = [];
        if (side !== undefined) {
          for (const card of side[seat]) {
            const held = match.hands[seat][card.handIndex];
            if (held === undefined) continue;
            mine.push({
              handIndex: card.handIndex,
              flavor: held.flavor,
              power: held.power,
              loaner: held.loaner,
            });
          }
        }
        // Intentionally nothing about the opponent: no cards, no counts.
        zones[zone.id] = { mine };
      }
      boards.push({ kind: 'current', zones });
    }
  }
  const complete = match.phase === 'complete';
  const results = complete ? scoreMatch(match, room.config) : null;
  return {
    seat,
    phase: room.stage === 'idle' ? 'idle' : room.stage,
    round: match.round,
    config: room.config,
    hand: match.hands[seat],
    boards,
    locks: match.locks,
    ready: { me: room.ready[seat], opponent: room.ready[foe] },
    opponentHandCount: match.hands[foe].length,
    deadlineMs: room.deadlineMs,
    drawPileCount: room.config.dealing === 'draw-per-round' ? room.decks[seat].length : undefined,
    drawsRemaining: room.drawsLeft[seat],
    results,
    winner: results === null ? null : matchWinner(results),
    explanations: complete ? explainMatch(match, room.config) : null,
  };
}
