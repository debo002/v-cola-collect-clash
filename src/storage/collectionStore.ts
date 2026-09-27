import { emptyCollection, sanitizeCollection, type Collection } from '../game/collection';

/**
 * IndexedDB persistence for the collection (design doc §7: on-device,
 * no account required). Single database, single store, single record.
 * Everything is sanitized on the way in and out, so corrupt rows can
 * never poison game logic.
 */
const DB_NAME = 'v-cola-collect-clash';
const DB_VERSION = 1;
const STORE = 'collection';
const KEY = 'default';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function runInTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        };
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          db.close();
          reject(request.error ?? new Error('IndexedDB request failed'));
        };
      })
  );
}

export async function loadCollection(): Promise<Collection> {
  const raw = await runInTransaction('readonly', (store) => store.get(KEY));
  if (raw == null || typeof raw !== 'object') return emptyCollection();
  return sanitizeCollection((raw as { counts?: unknown }).counts);
}

export async function saveCollection(collection: Collection): Promise<void> {
  await runInTransaction('readwrite', (store) =>
    store.put({ counts: sanitizeCollection(collection) }, KEY)
  );
}

export async function clearCollection(): Promise<void> {
  await runInTransaction('readwrite', (store) => store.delete(KEY));
}
