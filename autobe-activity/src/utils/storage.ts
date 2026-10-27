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
// Generated project archives are stored as binary records alongside pack files.
const projectOutputKey = (projectId: string, outputId: string) => `project:${projectId}:output:${outputId}`;
const projectCombinedKey = (projectId: string) => `project:${projectId}:combined`;

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
    console.error('[Storage] Could not persist pack, keeping it in memory:', pack.name, lastStorageError);
    if (!pack.fileBlob) throw err; // nothing useful to keep without its file
    memoryPacks.set(pack.id, pack);
    return 'memory';
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

  const file = (await run<StoredFile | undefined>(STORE_FILES, 'readonly', (tx) =>
    tx.objectStore(STORE_FILES).get(pack.id)
  )) as StoredFile | undefined;
  if (file?.fileData) {
    return { ...pack, fileBlob: new Blob([file.fileData], { type: file.fileType || 'application/zip' }) };
  }

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
  const rows = ((await run<LegacyPackRow[]>(STORE_PACKS, 'readonly', (tx) =>
    tx.objectStore(STORE_PACKS).getAll()
  )) || []) as LegacyPackRow[];
  const persisted = rows.map(stripFile); // metadata only — files load on demand via loadPackFile()
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
    await run([STORE_PACKS, STORE_FILES], 'readwrite', (tx) => {
      tx.objectStore(STORE_PACKS).delete(id);
      tx.objectStore(STORE_FILES).delete(id);
    });
  } catch (err) {
    if (!wasInMemory) throw err; // memory-only pack: nothing stored to delete
  }
}

export async function saveModpackToDB(modpack: MergedModpack): Promise<void> {
  // Save project metadata and generated files together. Files are stored as ArrayBuffers
  // because Discord's mobile webview can be less reliable with Blob values in IndexedDB.
  const { outputBlob, outputs, ...metadata } = modpack;
  const storedProject = {
    ...metadata,
    __autobeStoredAt: Date.now(),
    outputs: (outputs || []).map(({ blob: _blob, ...out }) => {
      void _blob;
      return out;
    }),
  };
  const files: StoredFile[] = [];
  if (outputBlob) files.push({
    id: projectCombinedKey(modpack.id),
    fileData: await outputBlob.arrayBuffer(),
    fileType: outputBlob.type || 'application/vnd.minecraft.mcaddon',
  });
  for (const output of outputs || []) {
    if (!output.blob) continue;
    files.push({
      id: projectOutputKey(modpack.id, output.id),
      fileData: await output.blob.arrayBuffer(),
      fileType: output.blob.type || 'application/octet-stream',
    });
  }
  await run([STORE_MODPACKS, STORE_FILES], 'readwrite', (tx) => {
    tx.objectStore(STORE_MODPACKS).put(storedProject);
    const fileStore = tx.objectStore(STORE_FILES);
    files.forEach(file => fileStore.put(file));
  });
}

/** Rehydrates generated project files from local IndexedDB when available. */
export async function loadModpackFiles(modpack: MergedModpack): Promise<MergedModpack> {
  let outputBlob = modpack.outputBlob;
  if (!outputBlob) {
    const stored = await run<StoredFile | undefined>(STORE_FILES, 'readonly', tx =>
      tx.objectStore(STORE_FILES).get(projectCombinedKey(modpack.id))
    ) as StoredFile | undefined;
    if (stored?.fileData) {
      outputBlob = new Blob([stored.fileData], { type: stored.fileType || 'application/vnd.minecraft.mcaddon' });
    }
  }

  const outputs = await Promise.all((modpack.outputs || []).map(async output => {
    if (output.blob) return output;
    const stored = await run<StoredFile | undefined>(STORE_FILES, 'readonly', tx =>
      tx.objectStore(STORE_FILES).get(projectOutputKey(modpack.id, output.id))
    ) as StoredFile | undefined;
    if (!stored?.fileData) return output;
    return {
      ...output,
      blob: new Blob([stored.fileData], { type: stored.fileType || 'application/octet-stream' }),
    };
  }));
  return { ...modpack, ...(outputBlob ? { outputBlob } : {}), outputs };
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
  const files = await run<StoredFile[]>(STORE_FILES, 'readonly', tx =>
    tx.objectStore(STORE_FILES).getAll()
  ) as StoredFile[];
  const prefix = `project:${id}:`;
  const related = files.filter(file => file.id.startsWith(prefix)).map(file => file.id);
  await run([STORE_MODPACKS, STORE_FILES], 'readwrite', (tx) => {
    tx.objectStore(STORE_MODPACKS).delete(id);
    const fileStore = tx.objectStore(STORE_FILES);
    related.forEach(fileId => fileStore.delete(fileId));
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
