import type { MatchState, PlacedCard, Player } from './match';
import { ZONES, type ZoneEffect } from './zones';

/**
 * Zone scoring, verbatim from design doc §4. Calculated once, after round 3,
 * across every revealed card in the zone:
 *
 * - COOL "Stay Frosty": the single lowest-Power card in the zone (both
 *   players) gets +1. Tied lowest (2+ cards) → no bonus.
 * - PARTY "The More The Merrier": more cards here → +1 to that zone total.
 * - ENERGY "Second Wind": fewer cards here → each own card here gets +1.
 *
 * Effects never weaken the opponent — bonuses apply to your own side only.
 */
export interface ZoneResult {
  readonly zoneId: string;
  readonly base: Readonly<Record<Player, number>>;
  readonly bonus: Readonly<Record<Player, number>>;
  readonly totals: Readonly<Record<Player, number>>;
  readonly winner: Player | null;
}

interface Revealed {
  owner: Player;
  power: number;
}

function collectZoneCards(state: MatchState, zoneId: string): Revealed[] {
  const cards: Revealed[] = [];
  for (const board of state.boards) {
    const side = board[zoneId];
    if (!side) throw new RangeError(`Unknown zone: ${zoneId}`);
    for (const owner of ['A', 'B'] as const) {
      for (const card of side[owner] as readonly PlacedCard[]) {
        if (card.power == null) throw new RangeError('Cannot score before round 3 reveal');
        cards.push({ owner, power: card.power });
      }
    }
  }
  return cards;
}

function applyEffect(effect: ZoneEffect, cards: Revealed[]): Record<Player, number> {
  const bonus: Record<Player, number> = { A: 0, B: 0 };
  const mine = (player: Player) => cards.filter((c) => c.owner === player);
  if (effect === 'stay-frosty') {
    if (cards.length === 0) return bonus;
    const lowest = Math.min(...cards.map((c) => c.power));
    const coldest = cards.filter((c) => c.power === lowest);
    if (coldest.length === 1) bonus[(coldest[0] as Revealed).owner] += 1;
  } else if (effect === 'more-the-merrier') {
    if (mine('A').length > mine('B').length) bonus.A += 1;
    else if (mine('B').length > mine('A').length) bonus.B += 1;
  } else {
    if (mine('A').length < mine('B').length) bonus.A += mine('A').length;
    else if (mine('B').length < mine('A').length) bonus.B += mine('B').length;
  }
  return bonus;
}

export function scoreZone(state: MatchState, zoneId: string): ZoneResult {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) throw new RangeError(`Unknown zone: ${zoneId}`);
  const cards = collectZoneCards(state, zoneId);
  const base: Record<Player, number> = { A: 0, B: 0 };
  for (const card of cards) base[card.owner] += card.power;
  const bonus = applyEffect(zone.effect, cards);
  const totals: Record<Player, number> = { A: base.A + bonus.A, B: base.B + bonus.B };
  const winner: Player | null = totals.A === totals.B ? null : totals.A > totals.B ? 'A' : 'B';
  return { zoneId, base, bonus, totals, winner };
}

/** Score every zone. Requires a completed match (nothing scored mid-match). */
export function scoreMatch(state: MatchState): ZoneResult[] {
  if (state.phase !== 'complete') throw new RangeError('Zones are scored after round 3 only');
  return ZONES.map((zone) => scoreZone(state, zone.id));
}
