import { getFlavorById } from './cards';
import type { FlavorId, FlavorTag } from './types';

/**
 * Card-effect registry (single place for all card effects — no logic in UI).
 *
 * General rules (task spec):
 * - Combos/conditions count only ONE side's cards in ONE zone.
 * - Everything is computed from BASE power; effects never stack on
 *   already-modified numbers.
 * - Additive effects modify that side's zone TOTAL, not individual cards.
 * - "Alone" = that side has no other cards in that zone.
 * - The Cola pair requires exactly those two cards. The Cola and Citrus
 *   trios and Berry trio require their listed members and allow extra cards.
 */

/** Effect ids emitted in ResolveStep.effectId (also used as ExplainReason). */
export const EFFECT_IDS = [
  'cola-diet-minus1',
  'cola-diet-lemon-plus2',
  'citrus-trio-double-lowest',
  'ingredient-share-malt',
  'ingredient-share-pineapple',
  'pina-alone-plus1',
  'cream-cancels',
  'berry-trio-autowin',
] as const;

export type EffectId = (typeof EFFECT_IDS)[number];

export const CREAM_SODA_ID = 'cream-soda';
export const PINA_COLADA_ID = 'pina-colada';

export const RULE1_EXACT: readonly FlavorId[] = ['v-cola', 'v-diet-cola'];
export const RULE2_EXACT: readonly FlavorId[] = ['v-cola', 'v-diet-cola', 'v-lemon'];
export const RULE3_EXACT: readonly FlavorId[] = ['lemon-mint', 'pink-lemonade', 'v-lemon'];
export const RULE7_SET: readonly FlavorId[] = ['blueberry', 'pink-lemonade', 'pomegranate'];

/**
 * Combo-identification groups (visual only — colors/markers live in UI).
 * Single source of truth for card membership so group colors can never
 * drift from the rules. A card can belong to several groups.
 */
export const COMBO_GROUPS = ['cola', 'citrus', 'ingredient', 'berry', 'solo'] as const;

export type ComboGroup = (typeof COMBO_GROUPS)[number];

const GROUP_MEMBERS: Record<ComboGroup, readonly FlavorId[]> = {
  cola: ['v-cola', 'v-diet-cola', 'v-lemon'],
  citrus: ['v-lemon', 'lemon-mint', 'pink-lemonade'],
  ingredient: ['v7-apple-malt', 'v7-pineapple-malt', 'pina-colada'],
  berry: ['blueberry', 'pomegranate', 'pink-lemonade'],
  solo: ['pina-colada', 'cream-soda'],
};

export const COMBO_GROUP_MEMBERS: Record<ComboGroup, readonly FlavorId[]> = GROUP_MEMBERS;

/** Visual-only membership derived from GROUP_MEMBERS (never hardcoded in UI). */
export function getCardGroups(flavorId: FlavorId): ComboGroup[] {
  return COMBO_GROUPS.filter((g) => (GROUP_MEMBERS[g] as readonly string[]).includes(flavorId));
}

/** Tags that grant ingredient sharing (apple exists but grants nothing). */
export const SHARE_TAGS: readonly FlavorTag[] = ['malt', 'pineapple'];

function sortedIds(ids: readonly FlavorId[]): FlavorId[] {
  return [...ids].sort();
}

/** Exact multiset match: same length, same ids including duplicates. */
export function isExactCombo(sideFlavors: readonly FlavorId[], expected: readonly FlavorId[]): boolean {
  if (sideFlavors.length !== expected.length) return false;
  const a = sortedIds(sideFlavors);
  const b = sortedIds(expected);
  return a.every((id, i) => id === b[i]);
}

export function isExactColaDiet(sideFlavors: readonly FlavorId[]): boolean {
  return isExactCombo(sideFlavors, RULE1_EXACT);
}

export function isExactColaDietLemon(sideFlavors: readonly FlavorId[]): boolean {
  return RULE2_EXACT.every((id) => sideFlavors.includes(id));
}

export function isExactCitrusTrio(sideFlavors: readonly FlavorId[]): boolean {
  return RULE3_EXACT.every((id) => sideFlavors.includes(id));
}

/** Subset match (other cards allowed): every required id appears at least once. */
export function hasBerryTrio(sideFlavors: readonly FlavorId[]): boolean {
  return RULE7_SET.every((id) => sideFlavors.includes(id));
}

export function hasCreamSoda(flavorsA: readonly FlavorId[], flavorsB: readonly FlavorId[]): boolean {
  return flavorsA.includes(CREAM_SODA_ID) || flavorsB.includes(CREAM_SODA_ID);
}

export function isPinaAlone(sideFlavors: readonly FlavorId[]): boolean {
  return sideFlavors.length === 1 && sideFlavors[0] === PINA_COLADA_ID;
}

/** Which share tags have 2+ holders on this side (each grants +1). */
export function sharedTags(sideFlavors: readonly FlavorId[]): FlavorTag[] {
  const out: FlavorTag[] = [];
  for (const tag of SHARE_TAGS) {
    let count = 0;
    for (const id of sideFlavors) {
      if (getFlavorById(id)?.tags.includes(tag)) count++;
    }
    if (count >= 2) out.push(tag);
  }
  return out;
}

/** Card ids of side cards carrying a given tag (for steps[] attribution). */
export function cardIdsWithTag(
  cards: readonly { cardId: string; flavor: FlavorId }[],
  tag: FlavorTag
): string[] {
  return cards.filter((c) => getFlavorById(c.flavor)?.tags.includes(tag)).map((c) => c.cardId);
}
