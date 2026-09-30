import { currentBoard, type MatchState, type Player } from '../../game/match';

/** handIndex -> zone for a player's CURRENT-round placements. */
export function placedMap(match: MatchState, player: Player): Map<number, string> {
  const map = new Map<number, string>();
  const board = currentBoard(match);
  for (const zoneId of Object.keys(board)) {
    for (const card of board[zoneId][player]) map.set(card.handIndex, zoneId);
  }
  return map;
}

/** All hand-indices used by a player across every round (incl. current). */
export function allUsedIndices(match: MatchState, player: Player): Set<number> {
  const used = new Set<number>();
  for (const board of match.boards) {
    for (const zoneId of Object.keys(board)) {
      for (const card of board[zoneId][player]) used.add(card.handIndex);
    }
  }
  return used;
}
