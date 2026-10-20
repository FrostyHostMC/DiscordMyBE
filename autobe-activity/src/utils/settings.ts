/**
 * Persisted app preferences.
 *
 * The desktop build stores these in `.autope/settings.be` next to the exe. The
 * web build mirrors that with localStorage so settings survive a reload (they
 * previously reset to defaults on every refresh).
 */

export interface AppSettings {
  autoMergeConflicts: boolean;
  keepOriginals: boolean;
  hapticEnabled: boolean;
  soundEnabled: boolean;
  /** Restrict the library to on-device processing only (always true today). */
  onDeviceOnly: boolean;
}

const KEY = 'autobe.settings.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  autoMergeConflicts: false,
  keepOriginals: true,
  hapticEnabled: true,
  soundEnabled: true,
  onDeviceOnly: true
};

/** Marks that the demo library has already been seeded (see `clearAllDB`). */
const DEMO_SEEDED_KEY = 'autobe.demoSeeded.v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* quota / private mode - defaults are used next load */
  }
}

/**
 * Demo data is seeded on first run only.
 *
 * Previously the "Reset & Clear Demo Addons" button cleared IndexedDB but the
 * next launch re-seeded the demo packs, making the button a no-op.
 */
export function hasSeededDemo(): boolean {
  try {
    return localStorage.getItem(DEMO_SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDemoSeeded(): void {
  try {
    localStorage.setItem(DEMO_SEEDED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearDemoSeedFlag(): void {
  try {
    localStorage.removeItem(DEMO_SEEDED_KEY);
  } catch {
    /* ignore */
  }
}