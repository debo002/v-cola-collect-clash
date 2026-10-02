import type { Flavor, FlavorId } from './types';

/**
 * The 11 real V7 flavors (design doc §3) — single typed data source.
 * Nothing else in the codebase should hardcode flavor names.
 *
 * A card = Flavor only. No Power stored, no effect, no rarity by default.
 * Cream Soda is a single Standard card (no separate Summer-Edition entry).
 */
export const FLAVORS: readonly Flavor[] = [
  { id: 'v-cola', name: 'V Cola', line: 'super-soda', tags: [] },
  { id: 'v-diet-cola', name: 'V Diet Cola', line: 'super-soda', tags: [] },
  { id: 'v-lemon', name: 'V Lemon', line: 'super-soda', tags: [] },
  { id: 'pink-lemonade', name: 'Pink Lemonade', line: 'vitamin-sparkling', tags: [] },
  { id: 'cream-soda', name: 'Cream Soda', line: 'vitamin-sparkling', tags: [] },
  { id: 'pomegranate', name: 'Pomegranate', line: 'vitamin-sparkling', tags: [] },
  { id: 'blueberry', name: 'Blueberry', line: 'vitamin-sparkling', tags: [] },
  { id: 'lemon-mint', name: 'Lemon Mint', line: 'vitamin-sparkling', tags: [] },
  { id: 'pina-colada', name: 'Pina Colada', line: 'vitamin-sparkling', tags: ['pineapple'] },
  { id: 'v7-apple-malt', name: 'V7 Apple Malt', line: 'flavored-malt', tags: ['apple', 'malt'] },
  {
    id: 'v7-pineapple-malt',
    name: 'V7 Pineapple Malt',
    line: 'flavored-malt',
    tags: ['pineapple', 'malt'],
  },
] as const;

export const FLAVOR_IDS: readonly FlavorId[] = FLAVORS.map((f) => f.id);

const FLAVOR_BY_ID: ReadonlyMap<FlavorId, Flavor> = new Map(FLAVORS.map((f) => [f.id, f]));

export function getFlavorById(id: string): Flavor | undefined {
  return FLAVOR_BY_ID.get(id);
}

export function isFlavorId(id: string): id is FlavorId {
  return FLAVOR_BY_ID.has(id);
}
