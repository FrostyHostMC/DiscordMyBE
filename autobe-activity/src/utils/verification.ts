import { VerificationState } from '@/types/modpack';
import {
  APP_VERSION,
  MIN_ALLOWED_VERSION,
  VERIFICATION_ENDPOINTS,
  VERIFICATION_TTL_MS,
  OFFLINE_LICENSE_KEYS,
  OFFLINE_LICENSE_KEY_HASHES,
  REQUIRE_LICENSE_KEY,
  REQUIRE_TOS_ACCEPTANCE,
  BLOCK_AUTOMATED_ENVIRONMENTS
} from '@/config/verification';
import { getDeviceId, sha256Hex, userAgentString } from './deviceFingerprint';
import { normalizeKey } from './keyFormat';

// Local mirrors of the Python `.autope/.ab` (verified) and `.autope/.ac`
// (blocked) files. Only hashes are ever written.
const LS_VERIFIED = 'autobe.verified.v1';
const LS_BLOCKED = 'autobe.blocked.v1';
const LS_TOS = 'autobe.tosAccepted.v1';

interface CachedVerification {
  deviceId: string;
  verifiedAt: number;
  keyHash: string | null;
}

// --- tiny local store helpers ---------------------------------------------

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota - verification simply won't persist */
  }
}

function readLines(key: string): string[] {
  const data = readJson<string[]>(key, []);
  return Array.isArray(data) ? data.filter((x) => typeof x === 'string' && x.trim()) : [];
}

const writeLines = (key: string, lines: string[]) => writeJson(key, lines);

// --- block list -----------------------------------------------------------

export function loadBlockedDevices(): string[] {
  return readLines(LS_BLOCKED);
}

export function blockDevice(deviceId: string): void {
  if (!deviceId) return;
  const list = loadBlockedDevices();
  if (!list.includes(deviceId)) {
    list.push(deviceId);
    writeLines(LS_BLOCKED, list);
  }
}

async function refreshBlockList(): Promise<string[]> {
  const url = VERIFICATION_ENDPOINTS.deviceBlacklist;
  if (!url) return loadBlockedDevices();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return loadBlockedDevices();
    const text = await res.text();
    const ids = text
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    writeLines(LS_BLOCKED, ids);
    return ids;
  } catch {
    // Offline: fall back to whatever was cached.
    return loadBlockedDevices();
  }
}

// --- verified list --------------------------------------------------------

export function loadVerifiedRecord(): CachedVerification | null {
  return readJson<CachedVerification | null>(LS_VERIFIED, null);
}

function saveVerifiedRecord(record: CachedVerification): void {
  writeJson(LS_VERIFIED, record);
}

export function clearVerifiedRecord(): void {
  try {
    localStorage.removeItem(LS_VERIFIED);
  } catch {
    /* ignore */
  }
}

export function hasAcceptedTos(): boolean {
  try {
    return localStorage.getItem(LS_TOS) === '1';
  } catch {
    return false;
  }
}

export function acceptTos(): void {
  try {
    localStorage.setItem(LS_TOS, '1');
  } catch {
    /* ignore */
  }
}

// --- version gate ---------------------------------------------------------

export function compareSemver(a: string, b: string): number {
  const nums = (v: string) =>
    String(v || '0')
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const na = nums(a);
  const nb = nums(b);
  for (let i = 0; i < 3; i++) {
    if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0);
  }
  return 0;
}

interface VersionPolicy {
  minVersion: string;
  latestVersion: string;
  /** False when the check could not run (no endpoint / offline). */
  online: boolean;
}

async function fetchVersionPolicy(): Promise<VersionPolicy> {
  const fallback: VersionPolicy = {
    minVersion: MIN_ALLOWED_VERSION,
    latestVersion: APP_VERSION,
    online: false
  };
  const url = VERIFICATION_ENDPOINTS.versionEndpoint;
  if (!url) return fallback;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return fallback;
    const lines = (await res.text())
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^v/i, ''))
      .filter(Boolean);
    return {
      minVersion: lines[0] || MIN_ALLOWED_VERSION,
      latestVersion: lines[1] || APP_VERSION,
      online: true
    };
  } catch {
    return fallback;
  }
}

// --- automation / spoofing gate -------------------------------------------

/**
 * Web counterpart of the Python `_detect_spoofing`.
 *
 * Flags automation harnesses and obvious tampered environments. Kept opt-in via
 * `BLOCK_AUTOMATED_ENVIRONMENTS` so a normal user is never locked out by a
 * heuristic false positive.
 */
export function detectSuspiciousEnvironment(): string[] {
  const flags: string[] = [];
  const nav = navigator as Navigator & { webdriver?: boolean };

  if (nav.webdriver === true) flags.push('automation_webdriver');
  if (/headless/i.test(userAgentString())) flags.push('headless_user_agent');

  // Chrome DevTools protocol / puppeteer markers on window
  const w = window as any;
  if (w.__playwright || w.__puppeteer_evaluation_script__) flags.push('automation_runtime');
  if (w.cdc_adoQpoasnfa76pfcZLmcfl_Array) flags.push('devtools_protocol');

  return flags;
}

// --- activation -----------------------------------------------------------

export interface ActivationResult {
  ok: boolean;
  message: string;
}

/**
 * Fetches the key list from the configured endpoint.
 *
 * Accepts every shape that can plausibly serve `keys.csv`, so the user can point
 * at whichever URL they already have:
 *
 *   raw.githubusercontent.com/.../keys.csv   -> plain text, one key per line
 *   any static host, keys.csv                -> CSV (quotes tolerated)
 *   api.github.com/repos/.../contents/keys.csv -> JSON `{ "content": "<base64>" }`
 *
 * Returns `null` for ANY problem (404, private repo, offline, malformed body).
 * The caller then falls back to the hashes compiled into the bundle, so the app
 * still activates when the repo cannot be reached.
 */
async function fetchRemoteKeys(): Promise<string[] | null> {
  const url = VERIFICATION_ENDPOINTS.licenseKeysEndpoint;
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw = await res.text();

    let text = raw;
    // GitHub contents API returns JSON with base64 file content.
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"content"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed?.content === 'string') {
          const b64 = parsed.content.replace(/\s+/g, '');
          text = atob(b64);
        }
      } catch {
        return null;
      }
    }

    const keys = text
      .split(/\r?\n/)
      .flatMap((line) => line.split(','))
      .map((k) => normalizeKey(k.replace(/^"|"$/g, '').trim()))
      .filter(Boolean);
    return keys.length ? keys : null;
  } catch {
    return null;
  }
}

function offlineKeyHashes(): string[] {
  return OFFLINE_LICENSE_KEY_HASHES.map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function offlinePlainKeys(): string[] {
  return OFFLINE_LICENSE_KEYS.map(normalizeKey).filter(Boolean);
}

/**
 * Validates an activation key and, on success, binds it to this device.
 *
 * Order of checks:
 *   1. remote key list (plaintext, same shape as the Python `keys.csv`)
 *   2. offline SHA-256 hash list — the production path, since the shipped
 *      bundle never contains a usable key
 *   3. offline plaintext list (development only)
 *   4. device binding: one key cannot be re-used on a second device
 */
export async function validateLicenseKey(
  rawKey: string,
  deviceId: string
): Promise<ActivationResult> {
  const key = normalizeKey(rawKey);
  if (!key) return { ok: false, message: 'Enter an activation key first.' };

  const keyHash = await sha256Hex(key);

  // 1) Remote list takes precedence when a key server is configured.
  const remote = await fetchRemoteKeys();
  if (remote) {
    if (!remote.includes(key)) {
      return { ok: false, message: 'That activation key is not recognised.' };
    }
  } else if (!offlineKeyHashes().includes(keyHash) && !offlinePlainKeys().includes(key)) {
    // 2 + 3) No key server and no local match.
    return {
      ok: false,
      message:
        'That key is not valid for this build. Check for typos, or contact support if you have a paid key.'
    };
  }

  // 4) One key, one device. Re-entering it here on the same device is fine.
  const record = loadVerifiedRecord();
  if (record?.keyHash && record.keyHash === keyHash && record.deviceId !== deviceId) {
    return {
      ok: false,
      message: 'This activation key is already in use on another device.'
    };
  }

  saveVerifiedRecord({ deviceId, verifiedAt: Date.now(), keyHash });
  return { ok: true, message: 'Activation successful.' };
}

/** Lets the caller rebuild state after a successful activation. */
export function markDeviceVerified(deviceId: string, keyHash: string): void {
  saveVerifiedRecord({ deviceId, verifiedAt: Date.now(), keyHash });
}

/**
 * Full verification pipeline, mirroring the Python `_check_activation` order:
 *
 *   1. minimum-version gate  (skip when offline, like the Python build)
 *   2. block list           (remote list, falling back to the cached hashes)
 *   3. suspicious environment gate
 *   4. cached local verification (this is what lets a user in on later launches)
 *   5. activation key
 */
export async function runVerification(): Promise<VerificationState> {
  const deviceId = await getDeviceId();

  // 1) version gate
  const policy = await fetchVersionPolicy();
  if (compareSemver(APP_VERSION, policy.minVersion) < 0) {
    return {
      deviceId,
      status: 'update_required',
      reason: `AutoBE ${policy.minVersion} or newer is required. You have ${APP_VERSION}.`,
      minVersion: policy.minVersion,
      latestVersion: policy.latestVersion
    };
  }

  // 2) block list
  const blocked = await refreshBlockList();
  if (blocked.includes(deviceId.toLowerCase())) {
    return {
      deviceId,
      status: 'denied',
      reason: 'This device has been blocked from using AutoBE.',
      latestVersion: policy.latestVersion
    };
  }

  // 3) suspicious environment
  if (BLOCK_AUTOMATED_ENVIRONMENTS) {
    const flags = detectSuspiciousEnvironment();
    if (flags.length > 0) {
      blockDevice(deviceId);
      return {
        deviceId,
        status: 'denied',
        reason: `Untrusted environment detected (${flags.join(', ')}).`,
        latestVersion: policy.latestVersion
      };
    }
  }

  // 4) cached verification
  const record = loadVerifiedRecord();
  const fresh =
    record && record.deviceId === deviceId && Date.now() - record.verifiedAt < VERIFICATION_TTL_MS;
  if (fresh) {
    return {
      deviceId,
      status: 'verified',
      verifiedAt: record.verifiedAt,
      minVersion: policy.minVersion,
      latestVersion: policy.latestVersion
    };
  }

  // 4b) Offline with a previously-activated device.
  // Mirrors the Python offline path: if we cannot reach the key server but this
  // device was activated before, let it keep working.
  if (record && record.deviceId === deviceId && !policy.online) {
    return {
      deviceId,
      status: 'verified',
      verifiedAt: record.verifiedAt,
      minVersion: policy.minVersion,
      latestVersion: policy.latestVersion
    };
  }

  // 5) activation key
  if (!REQUIRE_LICENSE_KEY) {
    return {
      deviceId,
      status: 'verified',
      verifiedAt: Date.now(),
      minVersion: policy.minVersion,
      latestVersion: policy.latestVersion
    };
  }

  // A key is always required from here on. Whether a remote key server happens
  // to be reachable only decides *where* the key is checked, never *whether*
  // one is needed — so this must stay `unverified` in both cases, otherwise
  // the activation screen would hide the key field and lock the user out.
  return {
    deviceId,
    status: 'unverified',
    reason: policy.online
      ? undefined
      : 'Offline: your key will be checked against the keys built into this version.',
    minVersion: policy.minVersion,
    latestVersion: policy.latestVersion
  };
}

/** Clears the cached verification for this device (Settings -> reset). */
export function forgetThisDevice(): void {
  clearVerifiedRecord();
}

export { APP_VERSION, REQUIRE_TOS_ACCEPTANCE, normalizeKey };