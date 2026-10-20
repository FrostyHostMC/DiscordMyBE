/**
 * Activation key format — shared by the app and the key manager script.
 *
 * Keeping this in one place guarantees that a key hashed by
 * `scripts/manageKeys.mjs` is normalised exactly the same way at runtime,
 * otherwise every generated key would silently fail to validate.
 */

/** Prefix stripped before hashing so "AUTOBE-" is cosmetic. */
export const KEY_PREFIX = 'autobe-';

/**
 * Canonical form of a key: only A-Z and 0-9 survive.
 *
 * Deliberately forgiving — every one of these is the same key, which matters
 * because users retype keys from emails and screenshots:
 *
 *   "autobe-abcd-1234"     -> "ABCD1234"
 *   "  AUTOBE ABCD 1234 " -> "ABCD1234"
 *   "ABCD-1234"           -> "ABCD1234"
 */
export function normalizeKey(raw: string): string {
  return String(raw ?? '')
    // Trim FIRST: a pasted key almost always carries a trailing space or
    // newline, and skipping this would leave the prefix unrecognised so a valid
    // key would silently fail to activate.
    .trim()
    .toUpperCase()
    .replace(/^AUTOBE-?/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** `AUTOBE-XXXX-XXXX-XXXX-XXXX`, used only as an input placeholder. */
export const KEY_PLACEHOLDER = 'AUTOBE-XXXX-XXXX-XXXX-XXXX';