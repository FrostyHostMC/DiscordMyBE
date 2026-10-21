/**
 * Port of AutoBE.py PART 13/19 script API version logic:
 * _get_pack_script_api_version, _version_to_group_key, _script_api_version_sort_key,
 * _group_files_by_script_api_version, _extract_and_store_highest_versions,
 * and _validate_files/_check_compatibility.
 *
 * Pure functions — no network access (the Python version's webhook/social log is
 * intentionally not ported: the web app has no external services).
 */

import { AddonPack } from '@/types/modpack';

type ManifestLike = Record<string, any> | null | undefined;

/** Convert '1.19.0-beta' -> (1,19,0,0) for numeric comparison. Handles literal 'beta' and [1,4,7] arrays. */
export function scriptApiVerTuple(v: unknown): [number, number, number, number] {
  try {
    let vStr = String(v ?? '').trim().toLowerCase();
    if (vStr === 'beta') vStr = '2.7.0-beta';
    if (vStr.startsWith('[') && vStr.endsWith(']')) {
      vStr = vStr.slice(1, -1).replace(/,\s*/g, '.');
    }
    const clean = vStr.replace('-beta', '.1').replace(/-/g, '.');
    const parts = clean.split('.');
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const p = parts[i];
      out[i] = p && /^\d+$/.test(p) ? parseInt(p, 10) : 0;
    }
    return out;
  } catch {
    return [0, 0, 0, 0];
  }
}

function compareVersionTuples(
  left: [number, number, number, number],
  right: [number, number, number, number]
): number {
  for (let i = 0; i < 4; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * Return the script API version string from manifest dependencies
 * (e.g. '1.8.0', '2.5.0', '1.2.0-beta'), or null. Resource packs return null.
 */
export function getPackScriptApiVersion(manifestData: ManifestLike): string | null {
  if (!manifestData || !manifestData.dependencies) return null;
  const modules = manifestData.modules;
  if (Array.isArray(modules) && modules.length > 0) {
    const first = modules[0];
    if (first && typeof first === 'object' && first.type === 'resources') return null;
  }
  let versionStr: string | null = null;
  let versionTup: [number, number, number, number] = [0, 0, 0, 0];
  for (const dep of manifestData.dependencies ?? []) {
    if (!dep || typeof dep !== 'object') continue;
    const name = dep.module_name;
    if (name !== '@minecraft/server' && name !== '@minecraft/server-ui' && name !== '@minecraft/server-gametest') {
      continue;
    }
    const v = dep.version;
    if (!v) continue;
    const vt = scriptApiVerTuple(v);
    if (versionStr === null || compareVersionTuples(vt, versionTup) > 0) {
      const vStr = String(v).trim().toLowerCase();
      if (vStr === 'beta') versionStr = '2.7.0-beta';
      else if (vStr.startsWith('[') && vStr.endsWith(']')) versionStr = vStr.slice(1, -1).replace(/,\s*/g, '.');
      else versionStr = vStr;
      versionTup = vt;
    }
  }
  return versionStr;
}

/** '1.5.0' -> '1_x'; '2.0.0' -> '2_x'; '2.5.0-beta' -> '2_x_beta'; '3.0.0-alpha' -> '3_x_alpha'. */
export function versionToGroupKey(ver: unknown): string {
  if (!ver) return 'none';
  const v = String(ver).trim().toLowerCase();
  const isAlpha = v.includes('alpha');
  const isBeta = !isAlpha && ['beta', 'preview', 'rc'].some((s) => v.includes(s));
  const m = /^(\d+)/.exec(v);
  if (!m) return 'none';
  const major = m[1];
  if (isAlpha) return `${major}_x_alpha`;
  if (isBeta) return `${major}_x_beta`;
  return `${major}_x`;
}

/** Sort key for version strings: newest first; 'none' last. */
export function scriptApiVersionSortKey(v: string | null | undefined): [number, number, number, number, number] {
  if (!v || v === 'none') return [0, 0, 0, 0, 1];
  const s = v.toLowerCase().replace('-beta', '');
  const parts = s.split('.');
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;
  const isBeta = v.toLowerCase().includes('beta');
  return [-major, -minor, -patch, isBeta ? 1 : 0, 0];
}

export interface ScriptApiGroup {
  key: string; // 'none' | '1_x' | '2_x_beta' ...
  packs: AddonPack[];
}

/**
 * Group packs by broad script API version bucket (major + stability).
 * Two-pass strategy so paired BP/RP halves land in the same group: RP-only
 * packs tentatively go to 'none', then are matched to a BP group by base name.
 */
export function groupPacksByScriptApiVersion(
  packs: AddonPack[],
  manifestOf: (pack: AddonPack) => ManifestLike
): Record<string, AddonPack[]> {
  const fileGroup = new Map<string, string>();
  const rpPacks: AddonPack[] = [];

  // Pass 1: classify every pack
  for (const pack of packs) {
    const manifest = manifestOf(pack);
    const modules = manifest?.modules;
    const isRpOnly =
      Array.isArray(modules) && modules.length > 0 && modules[0] && modules[0].type === 'resources';
    if (isRpOnly) {
      fileGroup.set(pack.id, 'none');
      rpPacks.push(pack);
      continue;
    }
    const ver = getPackScriptApiVersion(manifest);
    fileGroup.set(pack.id, ver ? versionToGroupKey(ver) : 'none');
  }

  // Pass 2: pair each RP pack with its BP counterpart by base name
  const bpBaseToVersion = new Map<string, string>();
  for (const pack of packs) {
    const vk = fileGroup.get(pack.id);
    if (vk && vk !== 'none' && !rpPacks.includes(pack)) {
      bpBaseToVersion.set(packBaseName(pack.name), vk);
    }
  }
  for (const rp of rpPacks) {
    const matched = bpBaseToVersion.get(packBaseName(rp.name));
    if (matched) fileGroup.set(rp.id, matched);
  }

  const groups: Record<string, AddonPack[]> = {};
  for (const pack of packs) {
    const key = fileGroup.get(pack.id) || 'none';
    (groups[key] ||= []).push(pack);
  }
  return groups;
}

/** Strip BP/RP suffixes and trailing _1/_2 from a pack name for pairing. */
export function packBaseName(name: string): string {
  return name
    .replace(/\.mcpack$|\.mcaddon$/i, '')
    .replace(/[-_\s]*(bp|rp|behaviors?|resources?|behavior[-_]?pack|resource[-_]?pack|[-_\s]*\d+)$/i, '')
    .trim()
    .toLowerCase();
}

// --- Highest version extraction (port of _extract_and_store_highest_versions) ---

export interface HighestVersions {
  rpMinEngine: [number, number, number] | null;
  bpMinEngine: [number, number, number] | null;
  serverVersion: string; // full, including '-beta'
  serverUiVersion: string;
  gametestVersion: string | null;
  /** Packs bucketed by their min_engine_version major.minor era. */
  sections: Array<{ label: string; packs: string[] }>;
}

const SECTION_ORDER = [
  'These Addons Are Using 1.21+ Codes',
  'These Addons Are Using 1.20+ Codes',
  'These Addons Are Using 1.19+ Codes',
  'These Addons Are Using 1.18+ Codes',
  'These Addons Are Using 1.17+ Codes',
  "These Addons Are Using '1.16 And Below' Codes"
] as const;

function normalizeMinEngine(raw: unknown): [number, number, number] {
  const parts = Array.isArray(raw)
    ? raw.map((x) => parseInt(String(x), 10) || 0)
    : String(raw ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const out: [number, number, number] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  return out;
}

function sectionFor(v: [number, number, number]): string {
  if (v[0] !== 1) return SECTION_ORDER[5];
  const minor = v[1];
  if (minor >= 21) return SECTION_ORDER[0];
  if (minor <= 16) return SECTION_ORDER[5];
  return SECTION_ORDER[21 - minor] ?? SECTION_ORDER[5];
}

function compareTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Extract highest min_engine / dependency versions across packs for manifest creation. */
export function extractHighestVersions(
  packs: AddonPack[],
  manifestOf: (pack: AddonPack) => ManifestLike
): HighestVersions {
  let highestRp: [number, number, number] | null = null;
  let highestBp: [number, number, number] | null = null;
  let highestServer: string | null = null;
  let highestServerTup: [number, number, number, number] = [0, 0, 0, 0];
  let highestServerUi: string | null = null;
  let highestServerUiTup: [number, number, number, number] = [0, 0, 0, 0];
  let highestGametest: string | null = null;
  let highestGametestTup: [number, number, number, number] = [0, 0, 0, 0];

  const sectionPacks = new Map<string, string[]>(SECTION_ORDER.map((s) => [s, []]));

  for (const pack of packs) {
    const manifest = manifestOf(pack);
    if (!manifest || !manifest.header) continue;
    const header = manifest.header;
    if (header.min_engine_version === undefined) continue;

    const minEngine = normalizeMinEngine(header.min_engine_version);
    const label = `${pack.name} (Version: ${minEngine.join('.')})`;
    const section = sectionFor(minEngine);
    sectionPacks.get(section)?.push(label);

    const isResource = (manifest.modules ?? []).some((m: any) => m?.type === 'resources');
    const isData = (manifest.modules ?? []).some((m: any) => m?.type === 'data');
    if (isResource && (!highestRp || compareTriple(minEngine, highestRp) > 0)) highestRp = minEngine;
    if (isData && (!highestBp || compareTriple(minEngine, highestBp) > 0)) highestBp = minEngine;

    for (const dep of manifest.dependencies ?? []) {
      if (!dep || typeof dep !== 'object' || !dep.version) continue;
      const tup = scriptApiVerTuple(dep.version);
      const name = dep.module_name;
      if (name === '@minecraft/server' && compareVersionTuples(tup, highestServerTup) > 0) {
        highestServerTup = tup;
        highestServer = String(dep.version);
      } else if (name === '@minecraft/server-ui' && compareVersionTuples(tup, highestServerUiTup) > 0) {
        highestServerUiTup = tup;
        highestServerUi = String(dep.version);
      } else if (name === '@minecraft/server-gametest' && compareVersionTuples(tup, highestGametestTup) > 0) {
        highestGametestTup = tup;
        highestGametest = String(dep.version);
      }
    }
  }

  return {
    rpMinEngine: highestRp,
    bpMinEngine: highestBp,
    serverVersion: highestServer ?? '1.13.0',
    serverUiVersion: highestServerUi ?? '1.2.0',
    gametestVersion: highestGametest,
    sections: SECTION_ORDER.filter((s) => (sectionPacks.get(s)?.length ?? 0) > 0).map((label) => ({
      label,
      packs: sectionPacks.get(label)!
    }))
  };
}

// --- Validation (port of _validate_files / _check_compatibility) ---

export interface PackValidationResult {
  valid: AddonPack[];
  missingManifest: AddonPack[];
  corrupt: AddonPack[];
}

/**
 * Verify every pack has a parseable manifest with a header UUID.
 * `manifestOf` returns null for unreadable/corrupt archives.
 */
export function validatePacks(
  packs: AddonPack[],
  manifestOf: (pack: AddonPack) => ManifestLike
): PackValidationResult {
  const valid: AddonPack[] = [];
  const missingManifest: AddonPack[] = [];
  const corrupt: AddonPack[] = [];
  for (const pack of packs) {
    const manifest = manifestOf(pack);
    if (manifest === null) corrupt.push(pack);
    else if (!manifest || !manifest.header || !manifest.header.uuid) missingManifest.push(pack);
    else valid.push(pack);
  }
  return { valid, missingManifest, corrupt };
}

/** Highest script version among packs, preserving '-beta' suffixes (used for merged manifest dependency). */
export function highestFullScriptVersion(versions: string[]): string | null {
  let best: string | null = null;
  let bestTup: [number, number, number, number] = [0, 0, 0, 0];
  for (const v of versions) {
    const tup = scriptApiVerTuple(v);
    if (best === null || compareVersionTuples(tup, bestTup) > 0) {
      best = v;
      bestTup = tup;
    }
  }
  return best;
}