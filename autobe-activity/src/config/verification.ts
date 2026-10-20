/**
 * Runtime / verification configuration.
 *
 * The desktop build of AutoBE (AutoBE.py) talks to GitHub over a private token.
 * A browser bundle must NEVER contain such a token, so the web build uses the
 * same *shape* of pipeline against public, read-only endpoints instead. Every
 * URL can be blanked out, in which case the corresponding check is skipped
 * exactly like the Python build does when it cannot reach the network.
 */

export const APP_VERSION = '1.0.0';

/** Bumping this forces users onto a new build (mirrors `version.txt` line 1). */
export const MIN_ALLOWED_VERSION = '1.0.0';

/**
 * Repo the desktop build (AutoBE.py) keeps its keys in.
 */
export const GITHUB_REPO = 'FrostyHostMC/AutoBE';
export const GITHUB_BRANCH = 'main';

/**
 * Where the app fetches its activation policy. Shape matches the Python
 * `version.txt` / `keys.csv` / `blacklist.txt` files:
 *
 *   versionEndpoint      -> "minVersion\nlatestVersion"  (text/plain)
 *   licenseKeysEndpoint  -> one activation key per line (text/plain or csv)
 *   deviceBlacklist      -> one blocked device id per line
 *
 * Leave empty to disable that specific check.
 *
 * ⚠ IMPORTANT — a browser CANNOT read a PRIVATE GitHub repo. There is no safe
 * way to send an Authorization header from a shipped bundle: the token would be
 * visible to anyone who opens DevTools. The licence endpoint therefore only
 * works once `FrostyHostMC/AutoBE` is PUBLIC, or if you point it at any other
 * publicly readable URL (a gist, a static host, a serverless function).
 *
 * If the fetch fails for any reason the app silently falls back to the
 * SHA-256 hashes compiled in below, so activation still works offline.
 * Run `npm run keys -- check-url` to test reachability from your machine.
 */
export const VERIFICATION_ENDPOINTS = {
  versionEndpoint: '',
  licenseKeysEndpoint: `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/keys.csv`,
  deviceBlacklist: `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/blacklist.txt`
} as const;

/**
 * Plaintext keys, for local development and self-hosted testing only.
 *
 * ⚠ Readable inside the shipped JavaScript. Keep this to a throwaway dev key
 * and delete it from any build you hand to users.
 */
export const OFFLINE_LICENSE_KEYS: string[] = [
  'AUTOBE-DEV-0000-LOCAL-TEST'
];

/**
 * SHA-256 hashes of every key in `keys/keys.csv`.
 *
 * The build ships hashes only — the plaintext never reaches the browser bundle,
 * so nobody can read a working key out of DevTools.
 *
 * Do not hand-edit this list. Manage it with:
 *   npm run keys -- list      see every key and whether it is in the build
 *   npm run keys -- add 10    generate keys (updates keys.csv AND this list)
 *   npm run keys -- rebuild   rewrite this list from keys.csv
 *   npm run keys -- verify    confirm keys.csv and this list agree
 *
 * Keys are normalised before hashing (uppercase, "AUTOBE" prefix and all
 * non-alphanumerics stripped) — identical to `normalizeKey()` in
 * src/utils/keyFormat.ts, which scripts/keysRepo.mjs shares.
 */
export const OFFLINE_LICENSE_KEY_HASHES: string[] = [
  '43f2b8762925d78311e9b68d6c29caa3301ea52b4cd4b56d8441d001812fc409',
  '08177de65d30a9c5d4f488c8f0b961391ace004498483ea5e5eb81eaf8bb1d1a',
  '4fc7233f953d521ac2f8b8beb32d3f7dc28667a575d0bdd7b6a4d5174a11a6aa',
  'f241bb09ce4d7a8df8cc58f6dd921f2c95045e1a4313c18526620750d7938dfc',
  '0e3616549cd2aabfe8f064574edeaf2038c07a62c0b087245f1d31020d2e603f',
  '90fa97e122ed2b7712cf519ff17fa35255a5b208d43551747171f9c35682f816',
  '40b62815fc9e120be75bb30c602ab3094a03066ff653924f503f17cb1f57d3e5',
  'd5bb3d9343cddc9317adcec174138949a0ad54ee62b524fa096e4b36341aeb4d',
  'a0563850fcc83a241ed0926e7112d720507635417dae66a39f47a7435d4ff37f',
  'a995ef503f018e0c9e58f4fa06284ac62649812575cbe0905364239b49fd5956'
];

/** Require a valid key before the app can be used. */
export const REQUIRE_LICENSE_KEY = true;

/** Require the user to accept the Terms of Use before entering the app. */
export const REQUIRE_TOS_ACCEPTANCE = true;

/**
 * Refuse to run inside automated/browsed contexts.
 *
 * This is the web equivalent of the Python `_detect_spoofing` gate. It matches
 * on hard automation markers only (headless UA, webdriver, CDP/playwright
 * injections) so real devices are never flagged. Verified by tests.
 */
export const BLOCK_AUTOMATED_ENVIRONMENTS = true;

/** How long a cached verification stays valid before it is re-checked. */
export const VERIFICATION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/** Show the local dev key in the activation screen so testers can get in. */
export const SHOW_DEV_KEY_HINT = true;