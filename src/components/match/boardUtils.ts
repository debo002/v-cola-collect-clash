import { getFlavorById } from '../../game/cards';
import type { HandCard } from '../../game/hands';
import { currentBoard, type MatchState, type Player } from '../../game/match';
import { ZONES } from '../../game/zones';

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

export interface StripCard {
  /** `m|f-<boardIndex>-<handIndex>` — stable key for bonus pulse mapping. */
  key: string;
  handIndex: number;
  flavorId: string;
  /** Null = hidden (never rendered with a value). */
  power: number | null;
  recallable: boolean;
}

export interface ZoneViewData {
  foeCards: StripCard[];
  myCards: StripCard[];
  /** Raw sums. Mine from hand powers; foe from revealed powers only. */
  myBase: number;
  foeBase: number;
}

/**
 * Per-zone strips + raw bases. Hidden-info rule lives here: with
 * foeVisible=false the foe's current-round picks are skipped entirely —
 * never rendered, never scored.
 */
export function buildZoneViews(
  match: MatchState,
  player: Player,
  foe: Player,
  opts: { foeVisible: boolean; recallable: boolean }
): Map<string, ZoneViewData> {
  const views = new Map<string, ZoneViewData>();
  for (const z of ZONES) {
    const foeCards: StripCard[] = [];
    const myCards: StripCard[] = [];
    let myBase = 0;
    let foeBase = 0;
    match.boards.forEach((board, bi) => {
      const side = board[z.id];
      if (!side) return;
      const isCurrent = bi === match.round - 1;
      for (const c of side[player]) {
        const hc: HandCard | undefined = match.hands[player][c.handIndex];
        if (!hc || !getFlavorById(hc.flavor)) continue;
        myCards.push({
          key: `m-${bi}-${c.handIndex}`,
          handIndex: c.handIndex,
          flavorId: hc.flavor,
          power: hc.power,
          recallable: opts.recallable && isCurrent,
        });
        myBase += hc.power;
      }
      for (const c of side[foe]) {
        if (!opts.foeVisible && isCurrent) continue;
        if (!getFlavorById(c.flavor)) continue;
        foeCards.push({
          key: `f-${bi}-${c.handIndex}`,
          handIndex: c.handIndex,
          flavorId: c.flavor,
          power: c.power,
          recallable: false,
        });
        if (c.power != null) foeBase += c.power;
      }
    });
    views.set(z.id, { foeCards, myCards, myBase, foeBase });
  }
  return views;
}
