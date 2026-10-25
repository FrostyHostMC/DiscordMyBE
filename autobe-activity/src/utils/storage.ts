// IndexedDB storage for packs and merged modpacks.
//
// Errors are THROWN (not swallowed) so callers can tell the user when a save,
// delete or read really failed — previously failures were logged and the UI
// reported success / showed an empty list.
import { AddonPack, MergedModpack } from '@/types/modpack';

const DB_NAME = 'AutoBE_DB';
const DB_VERSION = 2;
const STORE_PACKS = 'addons_library';
const STORE_MODPACKS = 'merged_modpacks';
// Pack FILE bytes live in their own store so listing packs never loads them into memory.
const STORE_FILES = 'pack_files';

// Personal workspace data must not expire before account sync is available.
// Never automatically delete local packs/projects: a device may contain the only
// copy of an import that has not yet reached the user's account.

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
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
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
    // An older open copy may briefly block the upgrade; the request completes once it closes.
    request.onblocked = () => console.warn('[Storage] Upgrade waiting for another open copy of the app to close.');
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
interface StoredFile {
  id: string;
  fileData: ArrayBuffer;
  fileType?: string;
}
// Legacy rows (older app versions) kept the file inside the pack row itself.
type LegacyPackRow = AddonPack & { fileData?: ArrayBuffer; fileType?: string };

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

const FALLBACK_CACHE = 'autobe-persistent-pack-fallback-v1';

function describeErrorForStorage(err: unknown): string { return err instanceof Error ? err.message : String(err); }

function fallbackKey(kind: 'meta' | 'file', id: string): Request {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://autobe-storage.invalid';
  return new Request(new URL(`/__autobe_storage__/${kind}/${encodeURIComponent(id)}`, origin).toString());
}

async function getFallbackCache(): Promise<Cache> {
  if (typeof caches === 'undefined') throw new Error('Persistent Cache Storage is not available in this app view.');
  return caches.open(FALLBACK_CACHE);
}

async function savePackFallback(pack: AddonPack): Promise<void> {
  if (!pack.fileBlob) throw new Error('Cannot persist an add-on without its original archive bytes.');
  const cache = await getFallbackCache();
  const meta = stripFile(pack as LegacyPackRow);
  try {
    await cache.put(fallbackKey('file', pack.id), new Response(await pack.fileBlob.arrayBuffer(), {
      headers: { 'Content-Type': pack.fileBlob.type || 'application/zip' }
    }));
    await cache.put(fallbackKey('meta', pack.id), new Response(JSON.stringify(meta), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (err) {
    await Promise.allSettled([cache.delete(fallbackKey('file', pack.id)), cache.delete(fallbackKey('meta', pack.id))]);
    throw err;
  }
}

async function readFallbackPacks(): Promise<AddonPack[]> {
  const cache = await getFallbackCache();
  const requests = await cache.keys();
  const packs: AddonPack[] = [];
  for (const request of requests) {
    const url = new URL(request.url);
    if (!url.pathname.includes('/meta/')) continue;
    try {
      const response = await cache.match(request);
      if (response) packs.push(JSON.parse(await response.text()) as AddonPack);
    } catch (err) {
      console.warn('[Storage] Skipping unreadable fallback metadata:', err);
    }
  }
  return packs;
}

async function readFallbackFile(id: string): Promise<Blob | null> {
  const cache = await getFallbackCache();
  const response = await cache.match(fallbackKey('file', id));
  if (!response) return null;
  return new Blob([await response.arrayBuffer()], { type: response.headers.get('Content-Type') || 'application/zip' });
}

async function deleteFallbackPack(id: string): Promise<void> {
  const cache = await getFallbackCache();
  await Promise.all([cache.delete(fallbackKey('meta', id)), cache.delete(fallbackKey('file', id))]);
}

function stripFile(row: LegacyPackRow): AddonPack {
  const { fileData: _fileData, fileType: _fileType, fileBlob: _fileBlob, ...meta } = row;
  void _fileData; void _fileType; void _fileBlob;
  return meta as AddonPack;
}

/** Resolves 'saved' when persisted, 'memory' when it could only be kept for this session. */
export async function savePackToDB(pack: AddonPack): Promise<'saved' | 'memory'> {
  try {
    const meta = { ...stripFile(pack as LegacyPackRow), __autobeStoredAt: Date.now() };
    const file: StoredFile | null = pack.fileBlob
      ? { id: pack.id, fileData: await pack.fileBlob.arrayBuffer(), fileType: pack.fileBlob.type }
      : null;
    // Metadata and file bytes commit together or not at all.
    await run([STORE_PACKS, STORE_FILES], 'readwrite', (tx) => {
      tx.objectStore(STORE_PACKS).put(meta);
      if (file) tx.objectStore(STORE_FILES).put(file);
    });
    memoryPacks.delete(pack.id);
    return 'saved';
  } catch (err) {
    lastStorageError = `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}${await describeStorage()}`;
    console.error('[Storage] IndexedDB save failed; trying persistent Cache Storage fallback:', pack.name, lastStorageError);
    try {
      await savePackFallback(pack);
      memoryPacks.delete(pack.id);
      lastStorageError = '';
      return 'saved';
    } catch (fallbackErr) {
      const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      lastStorageError = `${lastStorageError}; persistent fallback failed: ${fallbackMessage}`;
      // Do not pretend this item was saved. An in-memory copy would disappear on
      // navigation/restart and is exactly the failure users reported.
      throw new Error(`Could not save this add-on persistently. ${lastStorageError}`);
    }
  }
}

/**
 * Returns the pack WITH its file attached (fileBlob), loading it from storage on demand.
 * Listing packs deliberately does not load files, so a big library doesn't fill phone memory.
 */
export async function loadPackFile(pack: AddonPack): Promise<AddonPack> {
  if (pack.fileBlob) return pack;
  const inMemory = memoryPacks.get(pack.id);
  if (inMemory?.fileBlob) return { ...pack, fileBlob: inMemory.fileBlob };

  try {
    const file = (await run<StoredFile | undefined>(STORE_FILES, 'readonly', (tx) =>
      tx.objectStore(STORE_FILES).get(pack.id)
    )) as StoredFile | undefined;
    if (file?.fileData) {
      return { ...pack, fileBlob: new Blob([file.fileData], { type: file.fileType || 'application/zip' }) };
    }
  } catch (err) {
    console.warn('[Storage] IndexedDB file read failed; trying persistent fallback:', err);
  }
  const fallbackBlob = await readFallbackFile(pack.id).catch(() => null);
  if (fallbackBlob) return { ...pack, fileBlob: fallbackBlob };

  // Fall back to a legacy row that stored the file inline.
  const legacy = (await run<LegacyPackRow | undefined>(STORE_PACKS, 'readonly', (tx) =>
    tx.objectStore(STORE_PACKS).get(pack.id)
  )) as LegacyPackRow | undefined;
  if (legacy?.fileBlob) return { ...pack, fileBlob: legacy.fileBlob };
  if (legacy?.fileData) {
    return { ...pack, fileBlob: new Blob([legacy.fileData], { type: legacy.fileType || 'application/zip' }) };
  }
  return pack;
}

export async function getAllPacksFromDB(): Promise<AddonPack[]> {
  let rows: LegacyPackRow[] = [];
  let idbError: unknown = null;
  try {
    rows = ((await run<LegacyPackRow[]>(STORE_PACKS, 'readonly', (tx) =>
      tx.objectStore(STORE_PACKS).getAll()
    )) || []) as LegacyPackRow[];
  } catch (err) {
    idbError = err;
    console.warn('[Storage] IndexedDB listing failed; trying persistent fallback:', err);
  }
  const persisted = rows.map(stripFile); // metadata only — files load on demand via loadPackFile()
  let fallback: AddonPack[] = [];
  try { fallback = await readFallbackPacks(); } catch (err) {
    if (idbError) throw new Error(`IndexedDB and persistent fallback are unavailable: ${describeErrorForStorage(idbError)}; ${err instanceof Error ? err.message : String(err)}`);
  }
  const all = [...persisted, ...fallback, ...[...memoryPacks.values()]];
  const byId = new Map<string, AddonPack>();
  for (const pack of all) if (!byId.has(pack.id)) byId.set(pack.id, pack);
  const packs = [...byId.values()];

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
  memoryPacks.delete(id);
  let idbError: unknown = null;
  try {
    await run([STORE_PACKS, STORE_FILES], 'readwrite', (tx) => {
      tx.objectStore(STORE_PACKS).delete(id);
      tx.objectStore(STORE_FILES).delete(id);
    });
  } catch (err) { idbError = err; }
  try { await deleteFallbackPack(id); } catch (err) {
    if (idbError) throw new Error(`Could not delete pack from IndexedDB or persistent fallback: ${describeErrorForStorage(idbError)}; ${describeErrorForStorage(err)}`);
  }
  if (idbError) {
    // If fallback deletion succeeded, a missing IndexedDB row is harmless.
    const fallbackPacks = await readFallbackPacks().catch(() => []);
    if (fallbackPacks.some((p) => p.id === id)) throw idbError;
  }
}

export async function saveModpackToDB(modpack: MergedModpack): Promise<void> {
  // Blobs for merged outputs are kept in memory for the current session only,
  // so strip them before saving the metadata.
  const modpackWithoutBlob = {
    ...modpack,
    __autobeStoredAt: Date.now(),
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
  await run([STORE_PACKS, STORE_FILES, STORE_MODPACKS], 'readwrite', (tx) => {
    tx.objectStore(STORE_PACKS).clear();
    tx.objectStore(STORE_FILES).clear();
    tx.objectStore(STORE_MODPACKS).clear();
  });
}
