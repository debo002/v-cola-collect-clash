import { isFlavorId } from '../game/cards';
import type { FlavorId } from '../game/types';
import { HAND_SIZE } from '../game/hands';
import { kvDelete, kvGet, kvSet } from './kv';

/**
 * The custom battle deck: up to 6 flavor picks for Custom matches
 * (design doc §5 — manual pick with auto-fill for empty slots).
 * Empty slots are filled at match start, never stored.
 */
const KEY = 'deck';

function sanitizeDeck(data: unknown): FlavorId[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((id): id is FlavorId => typeof id === 'string' && isFlavorId(id))
    .slice(0, HAND_SIZE);
}

export async function loadDeck(): Promise<FlavorId[]> {
  return sanitizeDeck(await kvGet(KEY));
}

export async function saveDeck(picks: readonly string[]): Promise<void> {
  await kvSet(KEY, sanitizeDeck(picks));
}

export async function clearDeck(): Promise<void> {
  await kvDelete(KEY);
}
