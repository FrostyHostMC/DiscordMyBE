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

// ---------------------------------------------------------------------------
// Pack persistence with an in-memory fallback.
//
// Some mobile webviews (e.g. Discord's) refuse to persist large Blobs in
// IndexedDB. Packs are stored with their file as a plain ArrayBuffer (more
// reliable than Blob-backed storage). If persisting still fails, the pack is kept
// in memory so it can be merged during this session, and the caller is told.
// ---------------------------------------------------------------------------
type StoredPack = Omit<AddonPack, 'fileBlob'> & {
  fileBlob?: Blob;
  fileData?: ArrayBuffer;
  fileType?: string;
};

const memoryPacks = new Map<string, AddonPack>();
let lastStorageError = '';

export function getLastStorageError(): string {
  return lastStorageError;
}

async function describeStorage(): Promise<string> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && est.quota !== undefined && est.usage !== undefined) {
      const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
      return ` (storage used ${mb(est.usage)} of ${mb(est.quota)})`;
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function toStored(pack: AddonPack): Promise<StoredPack> {
  const { fileBlob, ...rest } = pack;
  if (!fileBlob) return rest as StoredPack;
  return { ...rest, fileData: await fileBlob.arrayBuffer(), fileType: fileBlob.type };
}

function fromStored(stored: StoredPack): AddonPack {
  const { fileData, fileType, ...rest } = stored;
  const pack = rest as AddonPack;
  if (fileData && !pack.fileBlob) {
    pack.fileBlob = new Blob([fileData], { type: fileType || 'application/zip' });
  }
  return pack;
}

/** Resolves 'saved' when persisted, 'memory' when it could only be kept for this session. */
export async function savePackToDB(pack: AddonPack): Promise<'saved' | 'memory'> {
  try {
    const stored = await toStored(pack);
    await run(STORE_PACKS, 'readwrite', (tx) => {
      tx.objectStore(STORE_PACKS).put(stored);
    });
    memoryPacks.delete(pack.id);
    return 'saved';
  } catch (err) {
    lastStorageError = `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}${await describeStorage()}`;
    console.error('[Storage] Could not persist pack, keeping it in memory:', pack.name, lastStorageError);
    if (!pack.fileBlob) throw err; // nothing useful to keep without its file
    memoryPacks.set(pack.id, pack);
    return 'memory';
  }
}

export async function getAllPacksFromDB(): Promise<AddonPack[]> {
  const rows = ((await run<StoredPack[]>(STORE_PACKS, 'readonly', (tx) =>
    tx.objectStore(STORE_PACKS).getAll()
  )) || []) as StoredPack[];
  const persisted = rows.map(fromStored);
  const persistedIds = new Set(persisted.map((p) => p.id));
  const packs = [...persisted, ...[...memoryPacks.values()].filter((p) => !persistedIds.has(p.id))];

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
  const wasInMemory = memoryPacks.delete(id);
  try {
    await run(STORE_PACKS, 'readwrite', (tx) => {
      tx.objectStore(STORE_PACKS).delete(id);
    });
  } catch (err) {
    if (!wasInMemory) throw err; // memory-only pack: nothing stored to delete
  }
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
  memoryPacks.clear();
  await run([STORE_PACKS, STORE_MODPACKS], 'readwrite', (tx) => {
    tx.objectStore(STORE_PACKS).clear();
    tx.objectStore(STORE_MODPACKS).clear();
  });
}
