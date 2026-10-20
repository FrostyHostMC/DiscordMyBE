// IndexedDB storage for packs and merged modpacks
import { AddonPack, MergedModpack } from '@/types/modpack';
import { describeError } from '@/utils/errorLog';

const DB_NAME = 'AutoBE_DB';
const DB_VERSION = 1;
const STORE_PACKS = 'addons_library';
const STORE_MODPACKS = 'merged_modpacks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePackToDB(pack: AddonPack): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PACKS, 'readwrite');
    tx.objectStore(STORE_PACKS).put(pack);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('[Aippy] savePackToDB error:', describeError(e));
  }
}

export async function getAllPacksFromDB(): Promise<AddonPack[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PACKS, 'readonly');
    const store = tx.objectStore(STORE_PACKS);
    return new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    console.error('[Aippy] getAllPacksFromDB error:', describeError(e));
    return [];
  }
}

export async function deletePackFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PACKS, 'readwrite');
    tx.objectStore(STORE_PACKS).delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('[Aippy] deletePackFromDB error:', describeError(e));
  }
}

export async function saveModpackToDB(modpack: MergedModpack): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MODPACKS, 'readwrite');
    tx.objectStore(STORE_MODPACKS).put(modpack);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('[Aippy] saveModpackToDB error:', describeError(e));
  }
}

export async function getAllModpacksFromDB(): Promise<MergedModpack[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MODPACKS, 'readonly');
    const store = tx.objectStore(STORE_MODPACKS);
    return new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    console.error('[Aippy] getAllModpacksFromDB error:', describeError(e));
    return [];
  }
}

export async function deleteModpackFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MODPACKS, 'readwrite');
    tx.objectStore(STORE_MODPACKS).delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('[Aippy] deleteModpackFromDB error:', describeError(e));
  }
}

export async function clearAllDB(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_PACKS, STORE_MODPACKS], 'readwrite');
    tx.objectStore(STORE_PACKS).clear();
    tx.objectStore(STORE_MODPACKS).clear();
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('[Aippy] clearAllDB error:', describeError(e));
  }
}