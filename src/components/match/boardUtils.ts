import { getFlavorById } from '../../game/cards';
import type { PlayerView } from '../../game/controller';

/** handIndex -> zone for the viewer's CURRENT-round placements. */
export function placedMapFromView(view: PlayerView): Map<number, string> {
  const map = new Map<number, string>();
  for (const board of view.boards) {
    if (board.kind !== 'current') continue;
    for (const zoneId of Object.keys(board.zones)) {
      const zone = board.zones[zoneId];
      if (zone === undefined) continue;
      for (const card of zone.mine) {
        map.set(card.handIndex, zoneId);
      }
    }
  }
  return map;
}

/** All hand-indices used by the viewer across every round (incl. current). */
export function allUsedIndicesFromView(view: PlayerView): Set<number> {
  const used = new Set<number>();
  for (const board of view.boards) {
    for (const zoneId of Object.keys(board.zones)) {
      const zone = board.zones[zoneId];
      if (zone === undefined) continue;
      for (const card of zone.mine) {
        used.add(card.handIndex);
      }
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
  /** Raw sums. Mine from visible powers; foe from revealed powers only. */
  myBase: number;
  foeBase: number;
}

/**
 * Per-zone strips + raw bases from a redacted PlayerView.
 * Hidden-info rule: the opponent's current-round placements are absent from
 * the view entirely, so current boards render only the viewer's own cards.
 * The opponent's cards appear on revealed boards only (never scored here).
 */
export function buildZoneViewsFromView(
  view: PlayerView,
  opts: { foeVisible: boolean; recallable: boolean }
): Map<string, ZoneViewData> {
  const views = new Map<string, ZoneViewData>();
  const zoneIds = new Set<string>();
  for (const board of view.boards) {
    for (const zoneId of Object.keys(board.zones)) {
      zoneIds.add(zoneId);
    }
  }
  for (const zoneId of zoneIds) {
    const foeCards: StripCard[] = [];
    const myCards: StripCard[] = [];
    let myBase = 0;
    let foeBase = 0;
    view.boards.forEach((board, bi) => {
      const zone = board.zones[zoneId];
      if (zone === undefined) return;
      for (const card of zone.mine) {
        if (!getFlavorById(card.flavor)) continue;
        const isCurrent = board.kind === 'current';
        myCards.push({
          key: `m-${bi}-${card.handIndex}`,
          handIndex: card.handIndex,
          flavorId: card.flavor,
          power: card.power,
          recallable: opts.recallable && isCurrent,
        });
        myBase += card.power;
      }
      if (board.kind === 'revealed') {
        for (const card of board.zones[zoneId]?.foe ?? []) {
          if (!getFlavorById(card.flavor)) continue;
          foeCards.push({
            key: `f-${bi}-${card.handIndex}`,
            handIndex: card.handIndex,
            flavorId: card.flavor,
            power: card.power,
            recallable: false,
          });
          foeBase += card.power;
        }
      }
      // Current boards carry nothing about the opponent (no cards, no
      // counts, no placeholders) — only lock status is shown, from `locks`.
    });
    views.set(zoneId, { foeCards, myCards, myBase, foeBase });
  }
  return views;
}
