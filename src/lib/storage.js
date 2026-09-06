/**
 * Persistent key/value store for the app.
 *
 * The app originally ran as a Claude artifact against `window.storage`. This
 * provides the same async API on top of IndexedDB, which — unlike localStorage
 * — comfortably holds the base64 card photos the inventory keeps under
 * `img:<id>:front` / `img:<id>:back` keys.
 *
 * API (matches the original, `global` is accepted and ignored — this store is
 * per-browser):
 *   get(key)    -> Promise<{ value: string } | null>
 *   set(key, v) -> Promise<boolean>
 *   delete(key) -> Promise<boolean>
 */

const DB_NAME = 'vinapp';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run(mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.onabort = () => reject(tx.error);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      }),
  );
}

export const storage = {
  async get(key) {
    const value = await run('readonly', (store) => store.get(key));
    return value === undefined ? null : { value };
  },

  async set(key, value) {
    await run('readwrite', (store) => store.put(String(value), key));
    return true;
  },

  async delete(key) {
    await run('readwrite', (store) => store.delete(key));
    return true;
  },
};

/** Makes the store available as `window.storage`, as the app expects. */
export function installStorage() {
  if (typeof window !== 'undefined' && !window.storage) window.storage = storage;
}
