import { FLAVOR_IDS, isFlavorId } from './cards';
import type { FlavorId } from './types';

/**
 * Collection ownership model (design doc §§1, 9).
 *
 * A flavor maps to its owned copy count. Every copy of a flavor is identical —
 * there is nothing to compare or negotiate — so only counts are stored.
 * No Power is stored here (rolled fresh 1–5 every match, never persisted).
 *
 * All updates are immutable: functions return a new object, safe for React state.
 */
export type Collection = { readonly [flavorId: string]: number };

export function emptyCollection(): Collection {
  return {};
}

export function countOf(collection: Collection, id: string): number {
  return collection[id] ?? 0;
}

export function ownsFlavor(collection: Collection, id: string): boolean {
  return countOf(collection, id) > 0;
}

/** Tradable spares: copies beyond the first, for duplicate-for-missing swaps. */
export function duplicateCount(collection: Collection, id: string): number {
  return Math.max(0, countOf(collection, id) - 1);
}

/** 1 scan = 1 flavor unlocked. Throws on unknown ids — validate upstream. */
export function addCopy(collection: Collection, id: string): Collection {
  if (!isFlavorId(id)) throw new RangeError(`Unknown flavor id: ${id}`);
  return { ...collection, [id]: countOf(collection, id) + 1 };
}

/** Giving a copy away. Removing a flavor you own zero of is a no-op. */
export function removeCopy(collection: Collection, id: string): Collection {
  const current = countOf(collection, id);
  if (current <= 0) return collection;
  const next: { [flavorId: string]: number } = { ...collection };
  if (current === 1) delete next[id];
  else next[id] = current - 1;
  return next;
}

/** Owned ids in canonical FLAVORS order (deterministic for UI lists). */
export function ownedFlavorIds(collection: Collection): FlavorId[] {
  return FLAVOR_IDS.filter((id) => ownsFlavor(collection, id));
}

export function totalCopies(collection: Collection): number {
  return Object.values(collection).reduce((sum, n) => sum + n, 0);
}

/** Drop unknown ids and non-positive counts (e.g. data loaded from storage). */
export function sanitizeCollection(data: unknown): Collection {
  if (typeof data !== 'object' || data === null) return {};
  const clean: { [flavorId: string]: number } = {};
  for (const [id, value] of Object.entries(data)) {
    if (!isFlavorId(id)) continue;
    const n = typeof value === 'number' ? Math.floor(value) : NaN;
    if (Number.isFinite(n) && n > 0) clean[id] = n;
  }
  return clean;
}
