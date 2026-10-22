// IndexedDB storage for packs and merged modpacks.
//
// Errors are THROWN (not swallowed) so callers can tell the user when a save,
// delete or read really failed — previously failures were logged and the UI
// reported success / showed an empty list.
import { AddonPack, MergedModpack } from '@/types/modpack';

const DB_NAME = 'AutoBE_DB';
const DB_VERSION = 1;
const STORE_PACKS = 'addons_library';
const STORE_MODPACKS = 'merged_modpacks';

// One shared connection. Opening a new connection per operation (and never
// closing it) piles up handles, which is fragile in mobile WebViews.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Storage (IndexedDB) is not available in this app view.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PACKS)) {
        db.createObjectStore(STORE_PACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MODPACKS)) {
        db.createObjectStore(STORE_MODPACKS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If the browser closes/upgrades the DB under us, reconnect next time.
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open storage.'));
    request.onblocked = () => reject(new Error('Storage is blocked by another open copy of the app.'));
  }).catch((err) => {
    dbPromise = null; // allow a retry on the next call
    throw err;
  });
  return dbPromise;
}

/** Runs a transaction and resolves only once it has fully committed. */
async function run<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise<T | undefined>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      dbPromise = null; // connection may be dead; reconnect next time
      reject(e);
      return;
    }
    let result: T | undefined;
    try {
      const req = work(tx);
      if (req) req.onsuccess = () => { result = req.result; };
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('Storage write failed.'));
    tx.onabort = () =>
      reject(tx.error ?? new Error('Storage write was aborted (the device may be out of space).'));
  });
}

export async function savePackToDB(pack: AddonPack): Promise<void> {
  await run(STORE_PACKS, 'readwrite', (tx) => {
    tx.objectStore(STORE_PACKS).put(pack);
  });
}

export async function getAllPacksFromDB(): Promise<AddonPack[]> {
  const packs = ((await run<AddonPack[]>(STORE_PACKS, 'readonly', (tx) =>
    tx.objectStore(STORE_PACKS).getAll()
  )) || []) as AddonPack[];

  const demoIds = packs.filter((p) => p.id.startsWith('demo-pack-')).map((p) => p.id);
  if (demoIds.length > 0) {
    // Best-effort cleanup of old demo data; never fail a read because of it.
    run(STORE_PACKS, 'readwrite', (tx) => {
      demoIds.forEach((id) => tx.objectStore(STORE_PACKS).delete(id));
    }).catch(() => {});
  }
  return packs.filter((p) => !p.id.startsWith('demo-pack-'));
}

export async function deletePackFromDB(id: string): Promise<void> {
  await run(STORE_PACKS, 'readwrite', (tx) => {
    tx.objectStore(STORE_PACKS).delete(id);
  });
}

export async function saveModpackToDB(modpack: MergedModpack): Promise<void> {
  // Blobs for merged outputs are kept in memory for the current session only,
  // so strip them before saving the metadata.
  const modpackWithoutBlob = {
    ...modpack,
    outputBlob: undefined,
    outputs: modpack.outputs?.map((out) => ({ ...out, blob: undefined })) || [],
  };
  await run(STORE_MODPACKS, 'readwrite', (tx) => {
    tx.objectStore(STORE_MODPACKS).put(modpackWithoutBlob);
  });
}

export async function getAllModpacksFromDB(): Promise<MergedModpack[]> {
  const modpacks = ((await run<MergedModpack[]>(STORE_MODPACKS, 'readonly', (tx) =>
    tx.objectStore(STORE_MODPACKS).getAll()
  )) || []) as MergedModpack[];

  const demoIds = modpacks.filter((m) => m.id.startsWith('demo-modpack-')).map((m) => m.id);
  if (demoIds.length > 0) {
    run(STORE_MODPACKS, 'readwrite', (tx) => {
      demoIds.forEach((id) => tx.objectStore(STORE_MODPACKS).delete(id));
    }).catch(() => {});
  }
  return modpacks.filter((m) => !m.id.startsWith('demo-modpack-'));
}

export async function deleteModpackFromDB(id: string): Promise<void> {
  await run(STORE_MODPACKS, 'readwrite', (tx) => {
    tx.objectStore(STORE_MODPACKS).delete(id);
  });
}

export async function clearAllDB(): Promise<void> {
  await run([STORE_PACKS, STORE_MODPACKS], 'readwrite', (tx) => {
    tx.objectStore(STORE_PACKS).clear();
    tx.objectStore(STORE_MODPACKS).clear();
  });
}
