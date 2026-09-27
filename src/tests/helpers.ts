import { FLAVOR_IDS } from '../game/cards';
import type { HandCard } from '../game/hands';

/** 6-card demo hand: first 6 flavors, no loaners. */
export function makeHand(): HandCard[] {
  return FLAVOR_IDS.slice(0, 6).map((flavor) => ({ flavor, loaner: false }));
}
