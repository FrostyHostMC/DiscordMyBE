/**
 * Verified Bedrock script-module versions.
 *
 * The client publishes a SEPARATE version list per `@minecraft/*` module, and a version that
 * one module accepts is not automatically valid for its siblings. Writing a single "highest"
 * version onto every `@minecraft/server*` dependency is what produced
 * `requested invalid version [1.16.0] of [@minecraft/server-ui]` on real ports — the whole
 * script context then fails to create and every generated action dies with it.
 *
 * This table is the single authority the export pipeline reads: only a version that is listed
 * for that exact module is ever written into a manifest. A module with no verified list is
 * never guessed at; it is reported for manual review instead.
 */

const compare = (a: string, b: string): number => {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** Versions the Bedrock engine publishes as accepted, per module. */
export const SCRIPT_MODULE_VERSIONS: Record<string, string[]> = {
  '@minecraft/server': ['1.9.0', '1.11.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0', '1.19.0'],
  // The client's own list for this module, taken verbatim from its rejection message:
  // `Available versions: 0.1.0 1.3.0 2.3.0 2.4.0-beta 3.0.0-alpha`. The 1.0.0/1.1.0/1.2.0 values
  // that used to be listed here are NOT published by the engine, so a manifest that declared
  // them failed to create its script context. Prereleases are excluded from the stable pool.
  '@minecraft/server-ui': ['0.1.0', '1.3.0', '2.3.0'],
  '@minecraft/server-gametest': ['1.0.0-beta'],
  '@minecraft/server-admin': ['1.0.0-beta'],
  '@minecraft/server-net': ['1.0.0-beta'],
};

/** Every version this engine will write for a module, or an empty list when unverified. */
export function verifiedVersions(moduleName: string): string[] {
  return SCRIPT_MODULE_VERSIONS[moduleName] ?? [];
}

/** Highest verified version of a module, or null when the module has no verified list. */
export function highestVerifiedVersion(moduleName: string): string | null {
  const list = verifiedVersions(moduleName);
  if (list.length === 0) return null;
  return [...list].sort(compare)[list.length - 1];
}

/**
 * Resolve the version a manifest may declare for `moduleName`.
 *
 * - a requested version the engine publishes is kept untouched;
 * - otherwise the highest verified version sharing the requested major is used;
 * - when no version of that major exists, the highest verified version is used;
 * - a module with no verified list returns null so the caller reports it instead of guessing.
 */
export function resolveScriptModuleVersion(
  moduleName: string,
  requested: string | undefined,
): string | null {
  const list = verifiedVersions(moduleName);
  if (list.length === 0) return null;
  const wanted = (requested ?? '').trim();
  if (wanted && list.includes(wanted)) return wanted;
  const stable = list.filter((version) => !version.includes('-'));
  const pool = stable.length > 0 ? stable : list;
  const requestedMajor = parseInt(wanted.split('.')[0] ?? '', 10);
  const sameMajor = Number.isFinite(requestedMajor)
    ? pool.filter((version) => parseInt(version.split('.')[0] ?? '', 10) === requestedMajor)
    : [];
  const candidates = sameMajor.length > 0 ? sameMajor : pool;
  return [...candidates].sort(compare)[candidates.length - 1];
}