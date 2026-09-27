/**
 * Single IndexedDB database, single store, many named records.
 * Design doc §7: everything persists on-device, no account required.
 */
const DB_NAME = 'v-cola-collect-clash';
// v2 renames the v1 'collection' store to a shared 'kv' store.
const DB_VERSION = 2;
const STORE = 'kv';
const LEGACY_STORE = 'collection';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      // Carry the v1 collection record across, then drop the old store.
      const tx = request.transaction;
      if (tx && db.objectStoreNames.contains(LEGACY_STORE)) {
        const legacy = tx.objectStore(LEGACY_STORE);
        const next = tx.objectStore(STORE);
        const getReq = legacy.get('default');
        getReq.onsuccess = () => {
          if (getReq.result !== undefined) next.put(getReq.result, 'collection');
          db.deleteObjectStore(LEGACY_STORE);
        };
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

export async function kvGet(key: string): Promise<unknown> {
  return runInTransaction('readonly', (store) => store.get(key));
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await runInTransaction('readwrite', (store) => store.put(value, key));
}

export async function kvDelete(key: string): Promise<void> {
  await runInTransaction('readwrite', (store) => store.delete(key));
}
