/**
 * Persistent key/value store, exposed as `window.storage` — the API the app
 * was originally written against.
 *
 *   get(key)    -> Promise<{ value: string } | null>
 *   set(key, v) -> Promise<boolean>
 *   delete(key) -> Promise<boolean>
 *
 * Two backends, picked at runtime:
 *
 *  - `db`        — published as a Claude artifact. Data lives server-side on
 *                  the viewer's account, so an inventory survives clearing
 *                  site data and follows the person between devices.
 *  - IndexedDB   — running from this repo, or wherever `db` is unavailable.
 *                  Per-browser, and lost with site data.
 *
 * Values are strings and some are large (card photos are base64 data URLs),
 * so the db backend splits anything over the document size cap across a
 * `parts` subcollection.
 */

const DB_NAME = 'vinapp';
const DB_VERSION = 1;
const STORE = 'kv';

/* ------------------------------------------------------------------ *
 * Backend: IndexedDB
 * ------------------------------------------------------------------ */

let idbPromise = null;

function openIdb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return idbPromise;
}

function idbRun(mode, work) {
  return openIdb().then(
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

const idbBackend = {
  name: 'indexeddb',
  async get(key) {
    const value = await idbRun('readonly', (store) => store.get(key));
    return value === undefined ? null : { value };
  },
  async set(key, value) {
    await idbRun('readwrite', (store) => store.put(String(value), key));
    return true;
  },
  async delete(key) {
    await idbRun('readwrite', (store) => store.delete(key));
    return true;
  },
};

/* ------------------------------------------------------------------ *
 * Backend: the artifact `db` capability
 * ------------------------------------------------------------------ */

// Documents are capped at 256 KiB; leave headroom for the rest of the body.
const CHUNK_BYTES = 180 * 1024;

/**
 * Path segments allow letters, digits and `_ - . ~ : @ +` only, so keys like
 * `setChecklist:Evolving Skies` need encoding. A short hash keeps two keys
 * that sanitize alike from colliding.
 */
function toSegment(key) {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
  const safe = key.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 150);
  return `${safe}-${hash.toString(36)}`;
}

function chunk(value) {
  const parts = [];
  for (let i = 0; i < value.length; i += CHUNK_BYTES) parts.push(value.slice(i, i + CHUNK_BYTES));
  return parts.length ? parts : [''];
}

function dbBackend(db) {
  const ref = (key) => db.doc(`kv/${toSegment(key)}`);

  return {
    name: 'db',

    async get(key) {
      const snapshot = await ref(key).get();
      if (!snapshot.exists) return null;
      const body = snapshot.data || {};
      if (typeof body.value === 'string') return { value: body.value };

      const count = Number(body.parts) || 0;
      if (!count) return null;
      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => ref(key).collection('parts').doc(`p${i}`).get()),
      );
      if (parts.some((p) => !p.exists)) return null; // torn write — treat as absent
      return { value: parts.map((p) => p.data.s || '').join('') };
    },

    async set(key, value) {
      const text = String(value);
      const doc = ref(key);
      const previous = await doc.get();
      const staleParts = previous.exists ? Number(previous.data.parts) || 0 : 0;

      if (text.length <= CHUNK_BYTES) {
        await doc.set({ value: text, updatedAt: Date.now() });
      } else {
        const parts = chunk(text);
        // Write the parts before the pointer, so a failure part-way leaves the
        // previous value readable rather than a half-written one.
        await Promise.all(
          parts.map((s, i) => doc.collection('parts').doc(`p${i}`).set({ s })),
        );
        await doc.set({ parts: parts.length, updatedAt: Date.now() });
        for (let i = parts.length; i < staleParts; i += 1) {
          await doc.collection('parts').doc(`p${i}`).delete();
        }
        return true;
      }

      for (let i = 0; i < staleParts; i += 1) {
        await doc.collection('parts').doc(`p${i}`).delete();
      }
      return true;
    },

    async delete(key) {
      const doc = ref(key);
      const snapshot = await doc.get();
      const count = snapshot.exists ? Number(snapshot.data.parts) || 0 : 0;
      await doc.delete();
      for (let i = 0; i < count; i += 1) {
        await doc.collection('parts').doc(`p${i}`).delete();
      }
      return true;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Backend selection
 * ------------------------------------------------------------------ */

let backendPromise = null;

function resolveBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (typeof window !== 'undefined' && window.claude && window.claude.use) {
      try {
        const db = await window.claude.use('db');
        if (db) return dbBackend(db);
      } catch (e) {
        // fall through to IndexedDB
      }
    }
    return idbBackend;
  })();
  return backendPromise;
}

export const storage = {
  async get(key) {
    return (await resolveBackend()).get(key);
  },
  async set(key, value) {
    return (await resolveBackend()).set(key, value);
  },
  async delete(key) {
    return (await resolveBackend()).delete(key);
  },
};

/** Which backend is in use, for the UI to report where data is kept. */
export async function storageBackend() {
  return (await resolveBackend()).name;
}

/** Makes the store available as `window.storage`, as the app expects. */
export function installStorage() {
  if (typeof window !== 'undefined' && !window.storage) window.storage = storage;
}
