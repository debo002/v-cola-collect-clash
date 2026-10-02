import type { MatchState, PlacedCard, Player } from './match';
import { resolveMatch, type ResolveCard, type ZoneInput } from './resolve';
import { ZONES } from './zones';

/**
 * Zone scoring adapter (thin — no duplicated logic).
 *
 * Numbers come from the pure resolver (`resolve.ts`: card effects registry +
 * kept zone effects, Cream-first, Pina stacking). This module only maps
 * ResolveResult.steps[] into the ZoneResult/ZoneExplanation shape the
 * current Board/ResolutionOverlay expects until the round-3 animation task
 * consumes steps[] directly.
 */
export interface ZoneResult {
  readonly zoneId: string;
  readonly base: Readonly<Record<Player, number>>;
  readonly bonus: Readonly<Record<Player, number>>;
  readonly totals: Readonly<Record<Player, number>>;
  readonly winner: Player | null;
}

export interface ZoneCardRef {
  readonly owner: Player;
  /** 0-based index into state.boards. */
  readonly round: number;
  readonly handIndex: number;
}

export type ZoneTarget =
  { readonly kind: 'card'; readonly ref: ZoneCardRef } | { readonly kind: 'zone' };

export type ExplainReason =
  | 'stay-frosty'
  | 'more-merrier'
  | 'second-wind'
  | 'cola-diet-minus1'
  | 'cola-diet-lemon-plus2'
  | 'citrus-trio-double-lowest'
  | 'ingredient-share-malt'
  | 'ingredient-share-pineapple'
  | 'pina-alone-plus1'
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

function cardIdOf(owner: Player, round: number, handIndex: number): string {
  return `${owner}-${round}-${handIndex}`;
}

function collectInputs(state: MatchState): {
  inputs: ZoneInput[];
  refs: Map<string, ZoneCardRef & { basePower: number }>;
} {
  const refs = new Map<string, ZoneCardRef & { basePower: number }>();
  const inputs: ZoneInput[] = ZONES.map((zone) => {
    const perSide = (owner: Player): ResolveCard[] => {
      const out: ResolveCard[] = [];
      state.boards.forEach((board, round) => {
        const side = board[zone.id];
        if (!side) throw new RangeError(`Unknown zone: ${zone.id}`);
        for (const card of side[owner] as readonly PlacedCard[]) {
          if (card.power == null) throw new RangeError('Cannot score before round 3 reveal');
          const cardId = cardIdOf(owner, round, card.handIndex);
          refs.set(cardId, { owner, round, handIndex: card.handIndex, basePower: card.power });
          out.push({
            cardId,
            flavor: card.flavor,
            basePower: card.power,
            owner,
            round,
            handIndex: card.handIndex,
          });
        }
      });
      return out;
    };
    return { zoneId: zone.id, effect: zone.effect, cards: { A: perSide('A'), B: perSide('B') } };
  });
  return { inputs, refs };
}

function resolveAll(state: MatchState) {
  if (state.phase !== 'complete') throw new RangeError('Zones are scored after round 3 only');
  const { inputs, refs } = collectInputs(state);
  return { results: resolveMatch(inputs), refs };
}

export function scoreZone(state: MatchState, zoneId: string): ZoneResult {
  if (!ZONES.some((z) => z.id === zoneId)) throw new RangeError(`Unknown zone: ${zoneId}`);
  const { results } = resolveAll(state);
  const hit = results.find((r) => r.zoneId === zoneId);
  if (!hit) throw new RangeError(`Unknown zone: ${zoneId}`);
  return { zoneId: hit.zoneId, base: hit.base, bonus: hit.bonus, totals: hit.totals, winner: hit.winner };
}

/** Score every zone. Requires a completed match (nothing scored mid-match). */
export function scoreMatch(state: MatchState): ZoneResult[] {
  const { results } = resolveAll(state);
  return results.map((r) => ({ zoneId: r.zoneId, base: r.base, bonus: r.bonus, totals: r.totals, winner: r.winner }));
}

export function explainZone(state: MatchState, zoneId: string): ZoneExplanation {
  if (!ZONES.some((z) => z.id === zoneId)) throw new RangeError(`Unknown zone: ${zoneId}`);
  const { results, refs } = resolveAll(state);
  const hit = results.find((r) => r.zoneId === zoneId);
  if (!hit) throw new RangeError(`Unknown zone: ${zoneId}`);
  const zoneDef = ZONES.find((z) => z.id === zoneId);
  const counts: Record<Player, number> = {
    A: countOf(state, zoneId, 'A'),
    B: countOf(state, zoneId, 'B'),
  };

  const adjustments: ZoneAdjustment[] = [];
  for (const step of hit.steps) {
    if (step.effectId === 'cream-cancels' || step.effectId === 'berry-trio-autowin') continue;
    if (!step.side) continue;
    if (step.effectId === 'stay-frosty') {
      const id = step.cardIds[0] as string;
      const ref = refs.get(id);
      if (!ref) continue;
      adjustments.push({
        owner: step.side,
        target: { kind: 'card', ref: { owner: ref.owner, round: ref.round, handIndex: ref.handIndex } },
        from: ref.basePower,
        to: ref.basePower + step.delta,
        reason: 'stay-frosty',
        counts,
      });
    } else if (step.effectId === 'second-wind') {
      // Expand to one +1 per smaller-side card (old UI shape; sums to delta).
      for (const id of step.cardIds) {
        const ref = refs.get(id);
        if (!ref || ref.owner !== step.side) continue;
        adjustments.push({
          owner: step.side,
          target: { kind: 'card', ref: { owner: ref.owner, round: ref.round, handIndex: ref.handIndex } },
          from: ref.basePower,
          to: ref.basePower + 1,
          reason: 'second-wind',
          counts,
        });
      }
    } else if (step.effectId === 'citrus-trio-double-lowest') {
      // Card-level tick on the doubled (lowest) card.
      let best: string | null = null;
      let bestPower = Infinity;
      for (const id of step.cardIds) {
        const ref = refs.get(id);
        if (ref && ref.basePower < bestPower) {
          bestPower = ref.basePower;
          best = id;
        }
      }
      const ref = best ? refs.get(best) : undefined;
      if (!ref) continue;
      adjustments.push({
        owner: step.side,
        target: { kind: 'card', ref: { owner: ref.owner, round: ref.round, handIndex: ref.handIndex } },
        from: ref.basePower,
        to: ref.basePower + step.delta,
        reason: 'citrus-trio-double-lowest',
        counts,
      });
    } else {
      // Zone-level total ticks (flat card effects + more-merrier).
      adjustments.push({
        owner: step.side,
        target: { kind: 'zone' },
        from: step.totalAfter - step.delta,
        to: step.totalAfter,
        reason: step.effectId as ExplainReason,
        counts,
      });
    }
  }

  let noBonus: ExplainReason | null = null;
  if (adjustments.length === 0) {
    const totalCards = counts.A + counts.B;
    if (totalCards === 0) {
      noBonus = 'none-empty';
    } else if (hit.steps.some((s) => s.effectId === 'cream-cancels')) {
      // Cream base-only zone: totals are correct; no banner marker until animation task.
      noBonus = null;
    } else if (zoneDef?.effect === 'stay-frosty') {
      noBonus = 'none-tied-lowest';
    } else if (zoneDef?.effect) {
      noBonus = 'none-equal';
    } else {
      noBonus = null;
    }
  }

  return {
    zoneId: hit.zoneId,
    base: hit.base,
    bonus: hit.bonus,
    totals: hit.totals,
    winner: hit.winner,
    adjustments,
    noBonus,
  };
}

/** Explain every zone in board order (Cool → Party → Energy). */
export function explainMatch(state: MatchState): ZoneExplanation[] {
  if (state.phase !== 'complete') throw new RangeError('Zones are scored after round 3 only');
  return ZONES.map((z) => explainZone(state, z.id));
}

function countOf(state: MatchState, zoneId: string, owner: Player): number {
  let n = 0;
  for (const board of state.boards) {
    const side = board[zoneId];
    if (!side) throw new RangeError(`Unknown zone: ${zoneId}`);
    n += (side[owner] as readonly PlacedCard[]).length;
  }
  return n;
}
