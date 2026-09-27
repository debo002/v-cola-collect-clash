import { FLAVOR_IDS, isFlavorId } from './cards';
import { countOf, type Collection } from './collection';
import { intBelow, rollPower, shuffled, type Rng } from './rng';
import type { FlavorId } from './types';

/**
 * 6-card hand assembly (design doc §5, match-entry modes).
 * Quick Play: random 6 from owned copies, loaners fill the gap.
 * Custom/Ranked: manual picks (count-aware) + auto-fill, then loaners.
 */
export const HAND_SIZE = 6;

export interface HandCard {
  readonly flavor: FlavorId;
  /** True for temporary match-only cards (player owns fewer than 6). */
  readonly loaner: boolean;
  /**
   * Power, rolled fresh at deal. Shown on your own hand/placed cards during
   * your turn; hidden from the opponent until simultaneous reveal. Never
   * stored in the collection (approved override 2026-09-27: visible deck).
   */
  readonly power: number;
}

/** Owned copies expanded into a multiset pool, in canonical flavor order. */
function ownedPool(collection: Collection): FlavorId[] {
  const pool: FlavorId[] = [];
  for (const id of FLAVOR_IDS) {
    for (let i = 0; i < countOf(collection, id); i++) pool.push(id);
  }
  return pool;
}

function randomFlavor(rng: Rng): FlavorId {
  const id = FLAVOR_IDS[intBelow(rng, FLAVOR_IDS.length)];
  return id as FlavorId;
}

function fillWithLoaners(hand: HandCard[], rng: Rng): HandCard[] {
  while (hand.length < HAND_SIZE)
    hand.push({ flavor: randomFlavor(rng), loaner: true, power: rollPower(rng) });
  return hand;
}

export function buildQuickPlayHand(collection: Collection, rng: Rng = Math.random): HandCard[] {
  const picked = shuffled(ownedPool(collection), rng)
    .slice(0, HAND_SIZE)
    .map((flavor): HandCard => ({ flavor, loaner: false, power: rollPower(rng) }));
  return shuffled(fillWithLoaners(picked, rng), rng);
}

export function buildCustomHand(
  collection: Collection,
  picks: readonly string[],
  rng: Rng = Math.random
): HandCard[] {
  if (picks.length > HAND_SIZE) throw new RangeError(`At most ${HAND_SIZE} picks`);
  const needed: { [flavorId: string]: number } = {};
  for (const pick of picks) {
    if (!isFlavorId(pick)) throw new RangeError(`Unknown flavor id: ${pick}`);
    needed[pick] = (needed[pick] ?? 0) + 1;
    if ((needed[pick] ?? 0) > countOf(collection, pick)) {
      throw new RangeError(`Not enough owned copies of ${pick}`);
    }
  }
  const hand: HandCard[] = picks.map((flavor): HandCard => ({
    flavor: flavor as FlavorId,
    loaner: false,
    power: rollPower(rng),
  }));
  const pool = ownedPool(collection);
  for (const pick of picks) pool.splice(pool.indexOf(pick as FlavorId), 1);
  const filled = hand.concat(
    shuffled(pool, rng)
      .slice(0, HAND_SIZE - hand.length)
      .map((flavor): HandCard => ({ flavor, loaner: false, power: rollPower(rng) }))
  );
  return shuffled(fillWithLoaners(filled, rng), rng);
}
