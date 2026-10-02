import type { HandCard } from './hands';
import { intBelow, shuffled, type Rng } from './rng';
import type { FlavorId } from './types';

export interface DrawState {
  readonly deck: readonly FlavorId[];
  readonly hand: readonly HandCard[];
}

/** Randomly draw one unique roster entry while retaining all cards already in hand. */
export function drawFromDeck(state: DrawState, rng: Rng = Math.random): DrawState {
  if (!state.deck.length) return state;
  const index = intBelow(rng, state.deck.length);
  const flavor = state.deck[index] as FlavorId;
  const hand = state.hand.some((card) => card.flavor === flavor)
    ? state.hand
    : [...state.hand, { flavor, loaner: true, power: 1 + intBelow(rng, 5) }];
  return { deck: state.deck.filter((_, i) => i !== index), hand };
}

export function shuffledDeck(flavors: readonly FlavorId[], rng: Rng = Math.random): FlavorId[] {
  return shuffled(flavors, rng);
}
