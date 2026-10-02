import {
  RULE3_EXACT,
  RULE7_SET,
  hasBerryTrio,
  hasCreamSoda,
  isExactCitrusTrio,
  isExactColaDiet,
  isExactColaDietLemon,
  isPinaAlone,
  sharedTags,
} from '../../game/effects';
import { getFlavorById } from '../../game/cards';
import type { ComboGroup } from '../../game/effects';
import type { FlavorId } from '../../game/types';

export interface ComboCompletion {
  group: ComboGroup;
  chip: string;
  warning?: boolean;
  involved: FlavorId[];
}

export interface ComboPartial {
  group: ComboGroup;
  text: string;
  involved: FlavorId[];
}

export interface SideHighlight {
  completed: ComboCompletion[];
  partials: ComboPartial[];
}

/**
 * Visual-only combo state for one side's cards in one zone.
 * Reuses the exact predicates from effects.ts (no duplicated logic):
 * the Cola pair needs the exact cards; Cola/Citrus/Berry trios allow extras.
 * Progress badges only for citrus, berry, ingredient — never cola, so the
 * exact pair (-1) is not mislabeled as partial progress toward the trio.
 */
export function getSideHighlight(sideFlavors: readonly FlavorId[]): SideHighlight {
  const completed: ComboCompletion[] = [];
  const partials: ComboPartial[] = [];
  if (sideFlavors.length === 0) return { completed, partials };

  // Cola (rules 1 & 2, exact only, no partials).
  if (isExactColaDiet(sideFlavors)) {
    completed.push({ group: 'cola', chip: '-1', warning: true, involved: [...sideFlavors] });
  } else if (isExactColaDietLemon(sideFlavors)) {
    completed.push({ group: 'cola', chip: '+2', involved: [...sideFlavors] });
  }

  // Citrus (rule 3, trio members may sit alongside other cards).
  if (isExactCitrusTrio(sideFlavors)) {
    completed.push({ group: 'citrus', chip: 'x2', involved: [...sideFlavors] });
  } else {
    const present = [...new Set(sideFlavors.filter((id) => (RULE3_EXACT as readonly string[]).includes(id)))];
    if (present.length > 0 && present.length < RULE3_EXACT.length) {
      partials.push({
        group: 'citrus',
        text: `${present.length}/${RULE3_EXACT.length}`,
        involved: present,
      });
    }
  }

  // Berry (rule 7, extras allowed). Partial 1/3–2/3 whenever 1–2 members present.
  if (hasBerryTrio(sideFlavors)) {
    completed.push({
      group: 'berry',
      chip: 'WIN',
      involved: sideFlavors.filter((f) => (RULE7_SET as readonly string[]).includes(f)),
    });
  } else {
    const present = [...new Set(sideFlavors.filter((f) => (RULE7_SET as readonly string[]).includes(f)))];
    if (present.length > 0 && present.length < RULE7_SET.length) {
      partials.push({ group: 'berry', text: `${present.length}/${RULE7_SET.length}`, involved: present });
    }
  }

  // Solo: Pina alone (Cream handled as zone-wide cancel, not a chip).
  const pinaAlone = isPinaAlone(sideFlavors);
  if (pinaAlone) {
    completed.push({ group: 'solo', chip: '+1', involved: [...sideFlavors] });
  }

  // Ingredient (rule 4, extras allowed): +1 per shared tag.
  const shared = sharedTags(sideFlavors);
  if (shared.length > 0) {
    const involved = sideFlavors.filter((id) =>
      getFlavorById(id)?.tags.some((t) => shared.includes(t))
    );
    completed.push({
      group: 'ingredient',
      chip: shared.length >= 2 ? '+2' : '+1',
      involved,
    });
  } else if (!pinaAlone) {
    // Partial 1/2 when at least one share-tag holder sits alone.
    const holders = sideFlavors.filter((id) =>
      getFlavorById(id)?.tags.some((t) => t === 'malt' || t === 'pineapple')
    );
    if (holders.length > 0) {
      partials.push({ group: 'ingredient', text: '1/2', involved: holders });
    }
  }

  return { completed, partials };
}

/** Cream Soda anywhere in the zone cancels effects (grey out group colors). */
export function isCreamCancelled(
  flavorsA: readonly FlavorId[],
  flavorsB: readonly FlavorId[]
): boolean {
  return hasCreamSoda(flavorsA, flavorsB);
}
