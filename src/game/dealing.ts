import { emptyCollection, type Collection } from './collection';
import type { GameConfig } from './config';
import { buildQuickPlayHand, type HandCard } from './hands';
import { intBelow, rollPower, shuffled, type Rng } from './rng';
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

const EMPTY_COLLECTION: Collection = emptyCollection();

export interface DealtHands {
  readonly handA: HandCard[];
  readonly handB: HandCard[];
  readonly poolA: FlavorId[];
  readonly poolB: FlavorId[];
}

/**
 * Server dealing: loaner cards for both seats, ignoring any local
 * collection. Same shape as hot-seat setup, with injected randomness
 * (seeded in tests, Math.random in production).
 */
export function dealMatchHands(config: GameConfig, rng: Rng): DealtHands {
  const roster = config.deck.kind === 'custom' ? config.deck.flavors : null;
  const makeHand = (): HandCard[] => {
    const hand = roster
      ? roster.map((flavor) => ({
          flavor,
          loaner: true,
          power: config.power === 'fixed' ? (config.fixedPower[flavor] ?? 3) : rollPower(rng),
        }))
      : buildQuickPlayHand(EMPTY_COLLECTION, rng);
    return config.power === 'fixed' && roster === null
      ? hand.map((card) => ({ ...card, power: config.fixedPower[card.flavor] ?? 3 }))
      : hand;
  };
  const handA = makeHand();
  const handB = makeHand();
  if (config.dealing === 'draw-per-round') {
    const poolA = roster ? [...roster] : handA.map((card) => card.flavor);
    const poolB = roster ? [...roster] : handB.map((card) => card.flavor);
    return { handA: [], handB: [], poolA: shuffled(poolA, rng), poolB: shuffled(poolB, rng) };
  }
  return { handA, handB, poolA: [], poolB: [] };
}
