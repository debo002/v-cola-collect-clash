import { getFlavorById } from './cards';
import {
  cardIdsWithTag,
  CREAM_SODA_ID,
  hasBerryTrio,
  hasCreamSoda,
  isExactCitrusTrio,
  isExactColaDiet,
  isExactColaDietLemon,
  isPinaAlone,
  sharedTags,
} from './effects';
import type { Player } from './match';
import type { FlavorId } from './types';
import type { ZoneEffect } from './zones';

/**
 * Pure zone resolver (no UI, no side effects).
 *
 * Cards are data in, steps are data out. All math uses BASE power; additive
 * effects adjust the side's zone TOTAL. Zone conditions (stay-frosty lowest,
 * more-merrier / second-wind counts) also read base power + counts only, so
 * rule 3's doubling never changes who counts as "lowest".
 *
 * Cross-zone rule (Pina Colada +1 to every occupied zone, stacking; Cream
 * Soda blocking) needs match context, so resolveZone takes an optional pure
 * `ctx` (default: no incoming Pina). resolveMatch builds that context in a
 * first pass (Cream zones first) and never hardcodes the zone count.
 */

export interface ResolveCard {
  readonly cardId: string;
  readonly flavor: FlavorId;
  readonly basePower: number;
  readonly owner: Player;
  readonly round?: number;
  readonly handIndex?: number;
}

export interface ZoneInput {
  readonly zoneId: string;
  readonly effect?: ZoneEffect;
  readonly cards: Readonly<Record<Player, readonly ResolveCard[]>>;
}

export interface ResolveStep {
  readonly zoneId: string;
  /** Null for zone-wide markers (Cream cancel) that touch both sides. */
  readonly side: Player | null;
  readonly cardIds: readonly string[];
  readonly effectId: string;
  readonly text: string;
  readonly delta: number;
  /** Running total for `side` after applying delta (0 when side is null). */
  readonly totalAfter: number;
}

export interface ResolveResult {
  readonly zoneId: string;
  readonly base: Readonly<Record<Player, number>>;
  readonly bonus: Readonly<Record<Player, number>>;
  readonly totals: Readonly<Record<Player, number>>;
  readonly winner: Player | null;
  readonly steps: readonly ResolveStep[];
}

export interface ResolveContext {
  /** Active lone-Pina sources per side (Cream-zone Pinas already excluded). */
  readonly pinaSources: Readonly<Record<Player, readonly { cardId: string; zoneId: string }[]>>;
}

export const EMPTY_CTX: ResolveContext = { pinaSources: { A: [], B: [] } };

function nameOf(id: FlavorId): string {
  return getFlavorById(id)?.name ?? id;
}

function flavorsOf(cards: readonly ResolveCard[]): FlavorId[] {
  return cards.map((c) => c.flavor);
}

function sumBase(cards: readonly ResolveCard[]): number {
  return cards.reduce((n, c) => n + c.basePower, 0);
}

function winnerOf(totals: Record<Player, number>): Player | null {
  if (totals.A === totals.B) return null;
  return totals.A > totals.B ? 'A' : 'B';
}

export function resolveZone(zone: ZoneInput, ctx: ResolveContext = EMPTY_CTX, effectsEnabled = true): ResolveResult {
  const sides: readonly Player[] = ['A', 'B'];
  const base: Record<Player, number> = {
    A: sumBase(zone.cards.A),
    B: sumBase(zone.cards.B),
  };
  const running: Record<Player, number> = { ...base };
  const steps: ResolveStep[] = [];

  const flavorsA = flavorsOf(zone.cards.A);
  const flavorsB = flavorsOf(zone.cards.B);
  const bySide: Record<Player, FlavorId[]> = { A: flavorsA, B: flavorsB };

  // 1. Cream Soda: base power only, everything else ignored in this zone.
  if (effectsEnabled && hasCreamSoda(flavorsA, flavorsB)) {
    const creamIds = [...zone.cards.A, ...zone.cards.B]
      .filter((c) => c.flavor === CREAM_SODA_ID)
      .map((c) => c.cardId);
    steps.push({
      zoneId: zone.zoneId,
      side: null,
      cardIds: creamIds,
      effectId: 'cream-cancels',
      text: 'Cream Soda cancelled all effects',
      delta: 0,
      totalAfter: 0,
    });
    const totals = { ...base };
    return {
      zoneId: zone.zoneId,
      base,
      bonus: { A: 0, B: 0 },
      totals,
      winner: winnerOf(totals),
      steps,
    };
  }

  // Snapshot base conditions BEFORE any deltas (rule 3 must not move stay-frosty).
  const allCards = [...zone.cards.A, ...zone.cards.B];
  const lowestBase = allCards.length > 0 ? Math.min(...allCards.map((c) => c.basePower)) : 0;
  const lowestHolders = allCards.filter((c) => c.basePower === lowestBase);
  const counts: Record<Player, number> = { A: zone.cards.A.length, B: zone.cards.B.length };

  // 3. Citrus trio double-lowest (additional cards are allowed; tie → same result either way).
  for (const side of effectsEnabled ? sides : []) {
    const cards = zone.cards[side];
    if (isExactCitrusTrio(bySide[side])) {
      const lowest = Math.min(...cards.map((c) => c.basePower));
      running[side] += lowest;
      steps.push({
        zoneId: zone.zoneId,
        side,
        cardIds: cards.map((c) => c.cardId),
        effectId: 'citrus-trio-double-lowest',
        text: `${nameOf('v-lemon')} + ${nameOf('lemon-mint')} + ${nameOf('pink-lemonade')}: double ${lowest}`,
        delta: lowest,
        totalAfter: running[side],
      });
    }
  }

  // 4. Flat card effects.
  for (const side of effectsEnabled ? sides : []) {
    const cards = zone.cards[side];
    const ids = cards.map((c) => c.cardId);
    if (isExactColaDiet(bySide[side])) {
      running[side] += -1;
      steps.push({
        zoneId: zone.zoneId,
        side,
        cardIds: ids,
        effectId: 'cola-diet-minus1',
        text: `${nameOf('v-cola')} + ${nameOf('v-diet-cola')} alone: -1`,
        delta: -1,
        totalAfter: running[side],
      });
    } else if (isExactColaDietLemon(bySide[side])) {
      running[side] += 2;
      steps.push({
        zoneId: zone.zoneId,
        side,
        cardIds: ids,
        effectId: 'cola-diet-lemon-plus2',
        text: `${nameOf('v-cola')} + ${nameOf('v-diet-cola')} + ${nameOf('v-lemon')}: +2`,
        delta: 2,
        totalAfter: running[side],
      });
    }
    for (const tag of sharedTags(bySide[side])) {
      running[side] += 1;
      const label = tag === 'malt' ? 'Malt' : 'Pineapple';
      steps.push({
        zoneId: zone.zoneId,
        side,
        cardIds: cardIdsWithTag(cards, tag),
        effectId: `ingredient-share-${tag}`,
        text: `${label} shared: +1`,
        delta: 1,
        totalAfter: running[side],
      });
    }
    // Pina Colada stacking: EVERY active lone Pina of this side (own + others)
    // gives +1 here, but only if this side occupies this zone.
    if (cards.length > 0) {
      for (const src of ctx.pinaSources[side]) {
        running[side] += 1;
        const qualifier = src.zoneId === zone.zoneId ? '' : ` (${src.zoneId})`;
        steps.push({
          zoneId: zone.zoneId,
          side,
          cardIds: [src.cardId],
          effectId: 'pina-alone-plus1',
          text: `${nameOf('pina-colada')} alone${qualifier}: +1`,
          delta: 1,
          totalAfter: running[side],
        });
      }
    }
  }

  // 5. Zone effect (moved unchanged from old scoring; base snapshot only).
  if (!effectsEnabled) {
    // Plain-power mode ignores card and zone effects alike.
  } else if (zone.effect === 'stay-frosty') {
    if (allCards.length > 0 && lowestHolders.length === 1) {
      const lucky = lowestHolders[0] as ResolveCard;
      running[lucky.owner] += 1;
      steps.push({
        zoneId: zone.zoneId,
        side: lucky.owner,
        cardIds: [lucky.cardId],
        effectId: 'stay-frosty',
        text: 'Stay Frosty: lone lowest +1',
        delta: 1,
        totalAfter: running[lucky.owner],
      });
    }
  } else if (zone.effect === 'more-the-merrier') {
    if (counts.A > counts.B) {
      running.A += 1;
      steps.push({
        zoneId: zone.zoneId,
        side: 'A',
        cardIds: zone.cards.A.map((c) => c.cardId),
        effectId: 'more-merrier',
        text: 'The More The Merrier: +1',
        delta: 1,
        totalAfter: running.A,
      });
    } else if (counts.B > counts.A) {
      running.B += 1;
      steps.push({
        zoneId: zone.zoneId,
        side: 'B',
        cardIds: zone.cards.B.map((c) => c.cardId),
        effectId: 'more-merrier',
        text: 'The More The Merrier: +1',
        delta: 1,
        totalAfter: running.B,
      });
    }
  } else if (zone.effect === 'second-wind') {
    if (counts.A < counts.B && counts.A > 0) {
      running.A += counts.A;
      steps.push({
        zoneId: zone.zoneId,
        side: 'A',
        cardIds: zone.cards.A.map((c) => c.cardId),
        effectId: 'second-wind',
        text: `Second Wind: +${counts.A}`,
        delta: counts.A,
        totalAfter: running.A,
      });
    } else if (counts.B < counts.A && counts.B > 0) {
      running.B += counts.B;
      steps.push({
        zoneId: zone.zoneId,
        side: 'B',
        cardIds: zone.cards.B.map((c) => c.cardId),
        effectId: 'second-wind',
        text: `Second Wind: +${counts.B}`,
        delta: counts.B,
        totalAfter: running.B,
      });
    }
  }

  // 6. Berry-trio auto-win (presence; others allowed). Exactly one side wins.
  const aHas = effectsEnabled && hasBerryTrio(flavorsA);
  const bHas = hasBerryTrio(flavorsB);
  let winner = winnerOf(running);
  if (aHas !== bHas) {
    const side: Player = aHas ? 'A' : 'B';
    winner = side;
    const trio = zone.cards[side].filter((c) =>
      (['blueberry', 'pink-lemonade', 'pomegranate'] as FlavorId[]).includes(c.flavor)
    );
    const seen = new Set<FlavorId>();
    const trioIds: string[] = [];
    for (const c of trio) {
      if (!seen.has(c.flavor)) {
        seen.add(c.flavor);
        trioIds.push(c.cardId);
      }
    }
    steps.push({
      zoneId: zone.zoneId,
      side,
      cardIds: trioIds,
      effectId: 'berry-trio-autowin',
      text: `${nameOf('blueberry')} + ${nameOf('pomegranate')} + ${nameOf('pink-lemonade')}: wins zone`,
      delta: 0,
      totalAfter: running[side],
    });
  }

  const totals = { ...running };
  const bonus: Record<Player, number> = { A: totals.A - base.A, B: totals.B - base.B };
  return { zoneId: zone.zoneId, base, bonus, totals, winner, steps };
}

/**
 * Resolve every zone. Cream zones are identified first so Pina Colada's +1
 * is correctly silenced there (and Pinas sitting in Cream zones give nothing
 * anywhere). Never assumes exactly 3 zones.
 */
export function resolveMatch(zones: readonly ZoneInput[], effectsEnabled = true): ResolveResult[] {
  const cream = new Set<string>();
  for (const z of zones) {
    const fa = z.cards.A.map((c) => c.flavor);
    const fb = z.cards.B.map((c) => c.flavor);
    if (effectsEnabled && hasCreamSoda(fa, fb)) cream.add(z.zoneId);
  }
  const pinaSources: Record<Player, { cardId: string; zoneId: string }[]> = { A: [], B: [] };
  for (const z of zones) {
    if (cream.has(z.zoneId)) continue;
    for (const side of ['A', 'B'] as const) {
      if (isPinaAlone(z.cards[side].map((c) => c.flavor))) {
        const lone = z.cards[side][0] as ResolveCard;
        pinaSources[side].push({ cardId: lone.cardId, zoneId: z.zoneId });
      }
    }
  }
  const ctx: ResolveContext = { pinaSources };
  return zones.map((z) => resolveZone(z, ctx, effectsEnabled));
}
