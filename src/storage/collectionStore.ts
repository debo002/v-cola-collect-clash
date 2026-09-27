import { emptyCollection, sanitizeCollection, type Collection } from '../game/collection';
import { kvDelete, kvGet, kvSet } from './kv';

/**
 * IndexedDB persistence for the collection (design doc §7: on-device,
 * no account required). Everything is sanitized on the way in and out,
 * so corrupt rows can never poison game logic.
 */
const KEY = 'collection';

export async function loadCollection(): Promise<Collection> {
  const raw = await kvGet(KEY);
  if (raw == null || typeof raw !== 'object') return emptyCollection();
  return sanitizeCollection((raw as { counts?: unknown }).counts);
}

export async function saveCollection(collection: Collection): Promise<void> {
  await kvSet(KEY, { counts: sanitizeCollection(collection) });
}

export async function clearCollection(): Promise<void> {
  await kvDelete(KEY);
}
