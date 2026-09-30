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

/**
 * Resolution explainer (pure, React/DOM-free). Returns the same numbers as
 * scoreZone plus ORDERED adjustments the UI animates one by one:
 * Cool → card-level +1 on the lone lowest; Party → zone-level +1 on the
 * bigger side; Energy → card-level +1 on every card of the smaller side.
 * Ties/empty zones carry a no-bonus reason and zero adjustments.
 *
 * cardRef uses {owner, round, handIndex} because cards are collected across
 * all 3 rounds' boards — the UI maps it back to the rendered card element.
 */
export interface ZoneCardRef {
  readonly owner: Player;
  /** 0-based index into state.boards. */
  readonly round: number;
  readonly handIndex: number;
}

export type ZoneTarget = { readonly kind: 'card'; readonly ref: ZoneCardRef } | { readonly kind: 'zone' };

export type ExplainReason =
  | 'stay-frosty'
  | 'more-merrier'
  | 'second-wind'
  | 'none-tied-lowest'
  | 'none-equal'
  | 'none-empty';

export interface ZoneAdjustment {
  /** Null for no-bonus markers (from === to === 0, contributes nothing). */
  readonly owner: Player | null;
  readonly target: ZoneTarget;
  readonly from: number;
  readonly to: number;
  readonly reason: ExplainReason;
  /** Card counts per side — banner copy interpolates these. */
  readonly counts: Readonly<Record<Player, number>>;
}

export interface ZoneExplanation extends ZoneResult {
  readonly adjustments: readonly ZoneAdjustment[];
  /** Set for ties/empty zones (adjustments is empty then). */
  readonly noBonus: ExplainReason | null;
}

interface Identified {
  owner: Player;
  power: number;
  round: number;
  handIndex: number;
}

function collectIdentified(state: MatchState, zoneId: string): Identified[] {
  const cards: Identified[] = [];
  state.boards.forEach((board, round) => {
    const side = board[zoneId];
    if (!side) throw new RangeError(`Unknown zone: ${zoneId}`);
    for (const owner of ['A', 'B'] as const) {
      for (const card of side[owner] as readonly PlacedCard[]) {
        if (card.power == null) throw new RangeError('Cannot score before round 3 reveal');
        cards.push({ owner, power: card.power, round, handIndex: card.handIndex });
      }
    }
  });
  return cards;
}

export function explainZone(state: MatchState, zoneId: string): ZoneExplanation {
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) throw new RangeError(`Unknown zone: ${zoneId}`);
  const result = scoreZone(state, zoneId);
  const cards = collectIdentified(state, zoneId);
  const counts: Record<Player, number> = {
    A: cards.filter((c) => c.owner === 'A').length,
    B: cards.filter((c) => c.owner === 'B').length,
  };

  const adjustments: ZoneAdjustment[] = [];
  let noBonus: ExplainReason | null = null;

  if (cards.length === 0) {
    noBonus = 'none-empty';
  } else if (zone.effect === 'stay-frosty') {
    const lowest = Math.min(...cards.map((c) => c.power));
    const coldest = cards.filter((c) => c.power === lowest);
    if (coldest.length === 1) {
      const c = coldest[0] as Identified;
      adjustments.push({
        owner: c.owner,
        target: { kind: 'card', ref: { owner: c.owner, round: c.round, handIndex: c.handIndex } },
        from: c.power,
        to: c.power + 1,
        reason: 'stay-frosty',
        counts,
      });
    } else {
      noBonus = 'none-tied-lowest';
    }
  } else if (zone.effect === 'more-the-merrier') {
    if (counts.A > counts.B) {
      adjustments.push({
        owner: 'A',
        target: { kind: 'zone' },
        from: result.base.A,
        to: result.base.A + 1,
        reason: 'more-merrier',
        counts,
      });
    } else if (counts.B > counts.A) {
      adjustments.push({
        owner: 'B',
        target: { kind: 'zone' },
        from: result.base.B,
        to: result.base.B + 1,
        reason: 'more-merrier',
        counts,
      });
    } else {
      noBonus = 'none-equal';
    }
  } else {
    if (counts.A < counts.B) {
      for (const c of cards.filter((c) => c.owner === 'A')) {
        adjustments.push({
          owner: 'A',
          target: { kind: 'card', ref: { owner: 'A', round: c.round, handIndex: c.handIndex } },
          from: c.power,
          to: c.power + 1,
          reason: 'second-wind',
          counts,
        });
      }
    } else if (counts.B < counts.A) {
      for (const c of cards.filter((c) => c.owner === 'B')) {
        adjustments.push({
          owner: 'B',
          target: { kind: 'card', ref: { owner: 'B', round: c.round, handIndex: c.handIndex } },
          from: c.power,
          to: c.power + 1,
          reason: 'second-wind',
          counts,
        });
      }
    } else {
      noBonus = 'none-equal';
    }
  }

  return { ...result, adjustments, noBonus };
}

/** Explain every zone in board order (Cool → Party → Energy). */
export function explainMatch(state: MatchState): ZoneExplanation[] {
  if (state.phase !== 'complete') throw new RangeError('Zones are scored after round 3 only');
  return ZONES.map((zone) => explainZone(state, zone.id));
}
