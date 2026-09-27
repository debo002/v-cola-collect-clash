import { FLAVOR_IDS } from '../game/cards';
import type { HandCard } from '../game/hands';

/** 6-card demo hand: first 6 flavors, power 3, no loaners. */
export function makeHand(): HandCard[] {
  return FLAVOR_IDS.slice(0, 6).map((flavor) => ({ flavor, loaner: false, power: 3 }));
}
