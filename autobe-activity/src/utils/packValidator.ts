import JSZip from 'jszip';
import { AddonPack } from '@/types/modpack';
import { highestVersion } from './mergeEngine';

/**
 * Pre-merge verification. Web counterpart of the Python
 * `_check_compatibility`, `_is_pack_obfuscated`, `_validate_files`,
 * `_extract_and_store_highest_versions` and the `subpacks` prompt.
 */

export type PackIssueLevel = 'error' | 'warning' | 'info';

export interface PackIssue {
  level: PackIssueLevel;
  /** Stable code so the UI can localise without string matching. */
  code:
    | 'missing_manifest'
    | 'bad_zip'
    | 'obfuscated'
    | 'missing_icon'
    | 'unknown_module_type'
    | 'no_files'
    | 'subpack_available'
    | 'script_version_unknown'
    | 'script_version_mismatch'
    | 'resource_pack_only'
    | 'mixed_pack_types'
    | 'legacy_engine'
    | 'missing_script_entry';
  packIds: string[];
  packNames: string[];
  detail: string;
}

export interface CompatibilityReport {
  ok: boolean;
  issues: PackIssue[];
  /** True when the merge can proceed (warnings do not block it). */
  canMerge: boolean;
  /** True when at least one pack ships subpacks and the user must choose. */
  requiresSubpackChoice: boolean;
}

const MIN_SAFE_ENGINE = [1, 13, 0] as const;

function engineTuple(version?: string): [number, number, number] | null {
  if (!version) return null;
  const parts = version.split('-')[0].split('.');
  const nums = [parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, parseInt(parts[2], 10) || 0];
  return nums[0] > 0 ? [nums[0], nums[1], nums[2]] : null;
}

function engineAtLeast(version: string | undefined, min: readonly number[]): boolean {
  const t = engineTuple(version);
  if (!t) return true; // unknown -> do not nag
  for (let i = 0; i < 3; i++) {
    if (t[i] > min[i]) return true;
    if (t[i] < min[i]) return false;
  }
  return true;
}

/**
 * Validates the selected packs before the merge runs.
 *
 * Errors block the merge; warnings and info never do (mirrors the Python flow
 * where `_check_compatibility` only warns about a missing manifest, but
 * `_validate_files` hard-fails).
 */
export function validatePacks(packs: AddonPack[]): CompatibilityReport {
  const issues: PackIssue[] = [];
  const add = (
    level: PackIssueLevel,
    code: PackIssue['code'],
    packs: AddonPack[],
    detail: string
  ) => issues.push({ level, code, packIds: packs.map((p) => p.id), packNames: packs.map((p) => p.name), detail });

  if (packs.length === 0) {
    add('error', 'no_files', [], 'Select at least one addon before continuing.');
    return { ok: false, issues, canMerge: false, requiresSubpackChoice: false };
  }

  const obfuscated = packs.filter((p) => p.isObfuscated);
  if (obfuscated.length > 0) {
    add(
      'error',
      'obfuscated',
      obfuscated,
      'These packs contain closed-source or obfuscated JSON. Merging them corrupts the output and crashes Minecraft.'
    );
  }

  const noBlob = packs.filter((p) => !p.fileBlob);
  if (noBlob.length > 0) {
    add(
      noBlob.length === packs.length ? 'error' : 'warning',
      'no_files',
      noBlob,
      noBlob.length === packs.length
        ? 'None of the selected addons still have their file data. Re-import them from your device before merging.'
        : 'These entries have no stored file data and will be skipped. Re-import them from your device.'
    );
  }

  const legacy = packs.filter((p) => !engineAtLeast(p.minEngineVersion, MIN_SAFE_ENGINE));
  if (legacy.length > 0) {
    add(
      'info',
      'legacy_engine',
      legacy,
      'These packs target an engine older than 1.13.0. Bedrock ignores them on modern versions.'
    );
  }

  const unknownScript = packs.filter((p) => p.hasScripts && !p.scriptApiVersion);
  if (unknownScript.length > 0) {
    add(
      'info',
      'script_version_unknown',
      unknownScript,
      'These scripted packs do not declare an @minecraft/server version. They will be merged into a separate scripted pack so they are never mixed with versioned scripts.'
    );
  }

  // Script API version spread - the exact thing the desktop "Check Packs" warns about.
  const versions = new Map<string, AddonPack[]>();
  for (const p of packs) {
    if (!p.hasScripts || !p.scriptApiVersion) continue;
    const list = versions.get(p.scriptApiVersion) || [];
    list.push(p);
    versions.set(p.scriptApiVersion, list);
  }
  if (versions.size > 1) {
    add(
      'warning',
      'script_version_mismatch',
      packs.filter((p) => p.hasScripts),
      `These packs target ${versions.size} different Script API versions (${[...versions.keys()].join(', ')}). AutoBE will split them into separate behavior packs automatically - do not force them into one output.`
    );
  }

  const resourceOnly = packs.every((p) => p.type === 'Resource Pack');
  if (resourceOnly) {
    add(
      'info',
      'resource_pack_only',
      packs,
      'Only resource packs selected. The result will be a single resource pack with no behavior pack.'
    );
  }

  const withSubpacks = packs.filter((p) => (p.subpacks?.length || 0) > 0);
  if (withSubpacks.length > 0) {
    add(
      'info',
      'subpack_available',
      withSubpacks,
      'Some packs ship multiple subpacks. You will be asked which one to use.'
    );
  }

  const canMerge = !issues.some((i) => i.level === 'error');
  return {
    ok: issues.length === 0,
    issues,
    canMerge,
    requiresSubpackChoice: withSubpacks.length > 0
  };
}

// ---------------------------------------------------------------------------
// Subpack selection (port of the Python `_show_subpack_selection` flow)
// ---------------------------------------------------------------------------

/**
 * Rebuilds a pack zip using only the chosen subpack folder.
 *
 * The desktop build extracts the archive, hoists the selected `subpacks/<folder>`
 * contents to the archive root and drops the `subpacks/` tree, which is exactly
 * what Bedrock expects for a flattened pack.
 */
export async function applySubpackChoice(pack: AddonPack, subpackIndex: number): Promise<AddonPack> {
  const subpacks = pack.subpacks || [];
  const chosen = subpacks[subpackIndex];
  if (!chosen || !pack.fileBlob) return pack;

  const zip = await JSZip.loadAsync(pack.fileBlob);
  const prefix = `subpacks/${chosen.folder}/`;

  const out = new JSZip();
  let copied = 0;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const norm = path.replace(/\\/g, '/');
    if (norm.startsWith('subpacks/')) {
      if (!norm.startsWith(prefix)) continue;
      const rel = norm.slice(prefix.length);
      if (!rel) continue;
      out.file(rel, entry.async('uint8array'));
      copied++;
    } else if (!norm.includes('/')) {
      // Root-level files that are not part of the subpack tree.
      out.file(norm, entry.async('uint8array'));
      copied++;
    }
  }

  if (copied === 0) return pack;

  const blob = await out.generateAsync({ type: 'blob' });
  return {
    ...pack,
    name: chosen.name && chosen.name !== chosen.folder ? `${pack.name} — ${chosen.name}` : pack.name,
    subpacks: undefined,
    fileBlob: blob,
    fileSize: blob.size
  };
}

/**
 * Highest declared engine version across the selected packs.
 * Port of `_extract_and_store_highest_versions` (BP/RP are tracked separately
 * because Minecraft validates each pack's own min_engine_version).
 */
export function highestEngineVersions(packs: AddonPack[]): {
  bp: string;
  rp: string;
  overall: string;
} {
  const bp = packs.filter((p) => p.type === 'Behavior Pack').map((p) => p.minEngineVersion || '');
  const rp = packs.filter((p) => p.type === 'Resource Pack').map((p) => p.minEngineVersion || '');
  const overall = highestVersion([...bp, ...rp]) || '1.20.0';
  return {
    bp: highestVersion(bp) || overall,
    rp: highestVersion(rp) || overall,
    overall
  };
}

// ---------------------------------------------------------------------------
// MCPACKER (Pack & Extract tool)
// ---------------------------------------------------------------------------

/**
 * Finds every pack folder inside an archive, mirroring the recursive
 * `find_valid_packs` walk (nested archives are unpacked up to `maxDepth`).
 */
export async function findValidPacksInArchive(
  blob: Blob,
  fileName: string,
  maxDepth = 6
): Promise<JSZip[]> {
  const found: JSZip[] = [];
  if (maxDepth < 1) return found;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(blob);
  } catch {
    return found;
  }

  const manifestEntries = Object.values(zip.files).filter(
    (f) => !f.dir && f.name.toLowerCase().replace(/\\/g, '/').endsWith('manifest.json')
  );

  const hasIconIn = async (root: string) => {
    const lowerRoot = root.toLowerCase();
    return Object.keys(zip.files).some((n) => {
      const l = n.toLowerCase();
      return l.startsWith(lowerRoot) && /^pack_icon\.(png|jpe?g)$/.test(l.split('/').pop() || '');
    });
  };

  if (manifestEntries.length > 0) {
    for (const manifest of manifestEntries) {
      const root = manifest.name.slice(0, manifest.name.lastIndexOf('/') + 1);
      if (await hasIconIn(root)) {
        found.push(zip);
        return found;
      }
    }
  }

  // Unpack nested archives and recurse.
  const nested = Object.values(zip.files).filter(
    (f) => !f.dir && /\.(mcpack|mcaddon|zip)$/i.test(f.name)
  );
  for (const entry of nested) {
    try {
      const inner = await entry.async('blob');
      found.push(...(await findValidPacksInArchive(inner, entry.name, maxDepth - 1)));
    } catch {
      /* skip unreadable nested archive */
    }
  }

  return found;
}

/** Short label describing what an archive contains, for the extract tool UI. */
export async function describeArchive(blob: Blob): Promise<{
  fileCount: number;
  packs: Array<{ name: string; type: string; version: string }>;
}> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(blob);
  } catch {
    return { fileCount: 0, packs: [] };
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const packs: Array<{ name: string; type: string; version: string }> = [];

  for (const entry of files) {
    if (!/manifest\.json$/i.test(entry.name)) continue;
    const root = entry.name.slice(0, entry.name.lastIndexOf('/') + 1);
    const siblings = files.filter((f) => f.name.startsWith(root));
    const icon = siblings.find((f) => /^pack_icon\.(png|jpe?g)$/i.test(f.name.split('/').pop() || ''));
    const type =
      files.some((f) => f.name.startsWith(`${root}entities/`) || f.name.startsWith(`${root}blocks/`))
        ? 'Behavior Pack'
        : files.some((f) => f.name.startsWith(`${root}textures/`) || f.name.startsWith(`${root}items/`))
        ? 'Resource Pack'
        : 'Unknown';
    packs.push({
      name: root || 'archive root',
      type: icon ? type : `${type} (no pack_icon)`,
      version: String(siblings.length)
    });
  }

  return { fileCount: files.length, packs };
}