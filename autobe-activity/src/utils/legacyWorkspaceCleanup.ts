/**
 * One-time cleanup for the old private, device-local workspace database.
 *
 * AutoBE now keeps source packs and generated merge output in memory only.
 * Public Community Modpacks use their separate server-side API and are not
 * stored in this IndexedDB database.
 */
const LEGACY_DATABASE_NAME = 'AutoBE_DB';

export function deleteLegacyWorkspaceDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not remove old local workspace data.'));
    request.onblocked = () => {
      // Another open tab may still hold the old DB. It will be removed after
      // those tabs close; don't block the merge interface while that happens.
      console.warn('[LegacyWorkspace] Database deletion is waiting for older app tabs to close.');
      resolve();
    };
  });
}
