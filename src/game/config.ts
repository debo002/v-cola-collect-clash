import { FLAVOR_IDS } from './cards';
import type { FlavorId } from './types';

export type GameConfig = {
  readonly mode: 'quick' | 'custom';
  readonly deck:
    | { readonly kind: 'normal' }
    | { readonly kind: 'custom'; readonly flavors: readonly FlavorId[] };
  readonly dealing: 'reveal-all' | 'draw-per-round';
  readonly drawPerRound: number;
  readonly maxPlacedPerRound: number;
  readonly power: 'random' | 'fixed';
  readonly fixedPower: Readonly<Partial<Record<FlavorId, number>>>;
  readonly effectsEnabled: boolean;
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  mode: 'quick',
  deck: { kind: 'normal' },
  dealing: 'reveal-all',
  drawPerRound: 2,
  maxPlacedPerRound: 2,
  power: 'random',
  fixedPower: {},
  effectsEnabled: true,
};

export const DEFAULT_CUSTOM_CONFIG: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  mode: 'custom',
  maxPlacedPerRound: 3,
};

export const DEFAULT_FIXED_POWER: Readonly<Record<FlavorId, number>> = {
  blueberry: 1,
  pomegranate: 1,
  'pink-lemonade': 2,
  'pina-colada': 2,
  'v-lemon': 3,
  'lemon-mint': 3,
  'v7-apple-malt': 3,
  'v7-pineapple-malt': 3,
  'v-cola': 4,
  'v-diet-cola': 4,
  'cream-soda': 5,
};

export function validateGameConfig(config: GameConfig): string | null {
  const flavors = config.deck.kind === 'normal' ? FLAVOR_IDS : config.deck.flavors;
  if (
    config.deck.kind === 'custom' &&
    (flavors.length < 1 || flavors.length > 11 || new Set(flavors).size !== flavors.length)
  )
    return 'deck-size';
  if (config.deck.kind === 'custom' && flavors.some((id) => !FLAVOR_IDS.includes(id)))
    return 'deck-invalid';
  if (
    !Number.isInteger(config.maxPlacedPerRound) ||
    config.maxPlacedPerRound < 1 ||
    config.maxPlacedPerRound > 11
  )
    return 'placed-invalid';
  if (
    config.dealing === 'draw-per-round' &&
    (!Number.isInteger(config.drawPerRound) || config.drawPerRound < 1 || config.drawPerRound > 3)
  )
    return 'draw-invalid';
  if (
    config.power === 'fixed' &&
    flavors.some(
      (id) =>
        !Number.isInteger(config.fixedPower[id]) ||
        (config.fixedPower[id] ?? 0) < 1 ||
        (config.fixedPower[id] ?? 0) > 5
    )
  )
    return 'power-invalid';
  const perRound = config.dealing === 'draw-per-round' ? config.drawPerRound : flavors.length;
  if (flavors.length < 3 || perRound < 1) return 'cannot-finish';
  return null;
}
