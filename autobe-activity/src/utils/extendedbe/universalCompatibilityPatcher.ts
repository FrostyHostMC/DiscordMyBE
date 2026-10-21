// ExtendedBE — Universal Compatibility Patcher
// Automatically detects and fixes common merge conflicts across all addon types.
// Optional: users toggle this fixer on/off from Settings → Compatibility.

const STORAGE_KEY = 'autobe_compat_patcher_enabled';

export interface PatchEntry {
  file: string;
  type: string;
  section?: string;
  animation?: string;
  controller?: string;
  texture?: string;
  source?: string;
}

/** Critical sections that should never be missing from entity files */
const CRITICAL_ENTITY_SECTIONS = new Set([
  'materials',
  'textures',
  'geometry',
  'render_controllers'
]);

type Json = Record<string, unknown>;

let patchesApplied: PatchEntry[] = [];

// ── Toggle persistence ────────────────────────────────────────────

export function isCompatibilityPatcherEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** True when the user has an explicit stored on/off preference. */
export function hasStoredPatcherPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function setCompatibilityPatcherEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // storage unavailable — toggle stays session-only
  }
}

export function getPatchReport(): PatchEntry[] {
  return [...patchesApplied];
}

export function clearPatchReport(): void {
  patchesApplied = [];
}

// ── Deep merge helper ─────────────────────────────────────────────

function deepMerge(base: Json, overlay: Json): Json {
  const result: Json = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    if (!(key in result)) {
      result[key] = value;
    } else if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      result[key] = [...existing, ...value.filter((v) => !existing.includes(v))];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── File type detection ───────────────────────────────────────────

function detectFileType(filePath: string, data: Json): string {
  const lower = filePath.toLowerCase();
  if (lower.includes('entity')) {
    const str = JSON.stringify(data);
    if (str.includes('minecraft:client_entity')) return 'client_entity';
    return 'entity';
  }
  if (lower.includes('animation')) {
    if (lower.includes('controller')) return 'animation_controller';
    return 'animation';
  }
  return 'generic';
}

// ── Patcher ───────────────────────────────────────────────────────

function getDesc(data: Json, rootKey: string): Json | null {
  const root = data[rootKey];
  if (!isPlainObject(root)) return null;
  const desc = root['description'];
  return isPlainObject(desc) ? desc : null;
}

function restoreSections(
  desc: Json,
  rootKey: string,
  sourceDataList: Json[],
  filePath: string
): void {
  const missing = [...CRITICAL_ENTITY_SECTIONS].filter((s) => !(s in desc));
  if (missing.length === 0) return;
  console.warn(`[Aippy] Patcher: missing sections ${missing.join(', ')} in ${filePath}`);
  for (const sourceData of sourceDataList) {
    const sourceDesc = getDesc(sourceData, rootKey);
    if (!sourceDesc) continue;
    for (const section of missing) {
      if (!(section in sourceDesc)) continue;
      if (!(section in desc)) {
        desc[section] = sourceDesc[section];
        patchesApplied.push({ file: filePath, type: 'restored_section', section, source: 'original_pack' });
      } else if (isPlainObject(desc[section]) && isPlainObject(sourceDesc[section])) {
        desc[section] = deepMerge(desc[section] as Json, sourceDesc[section] as Json);
        patchesApplied.push({ file: filePath, type: 'merged_section', section, source: 'original_pack' });
      }
    }
  }
}

/**
 * Patch a merged file by restoring missing critical sections from source packs.
 * Returns the patched merged data (a new object when patches were applied).
 */
export function patchMergedFile(
  mergedData: Json,
  sourceDataList: Json[],
  filePath: string
): Json {
  if (!sourceDataList || sourceDataList.length === 0) return mergedData;
  if (!isCompatibilityPatcherEnabled()) return mergedData;

  const before = patchesApplied.length;
  const fileType = detectFileType(filePath, mergedData);
  const data: Json = { ...mergedData };

  if (fileType === 'entity') {
    const desc = getDesc(data, 'minecraft:entity');
    if (desc) restoreSections(desc, 'minecraft:entity', sourceDataList, filePath);
  } else if (fileType === 'client_entity') {
    const desc = getDesc(data, 'minecraft:client_entity');
    if (desc) {
      restoreSections(desc, 'minecraft:client_entity', sourceDataList, filePath);
      // Ensure the default texture is preserved
      const textures = desc['textures'];
      if (isPlainObject(textures) && !('default' in textures)) {
        for (const sourceData of sourceDataList) {
          const sourceDesc = getDesc(sourceData, 'minecraft:client_entity');
          const sourceTextures = sourceDesc?.['textures'];
          if (isPlainObject(sourceTextures) && 'default' in sourceTextures) {
            textures['default'] = sourceTextures['default'];
            patchesApplied.push({
              file: filePath,
              type: 'restored_texture',
              texture: 'default',
              source: 'original_pack'
            });
            break;
          }
        }
      }
    }
  } else if (fileType === 'animation') {
    const anims = data['animations'];
    if (isPlainObject(anims)) {
      const merged: Json = { ...anims };
      for (const sourceData of sourceDataList) {
        const sourceAnims = sourceData['animations'];
        if (!isPlainObject(sourceAnims)) continue;
        for (const [name, animData] of Object.entries(sourceAnims)) {
          if (!(name in merged)) {
            merged[name] = animData;
            patchesApplied.push({ file: filePath, type: 'restored_animation', animation: name });
          }
        }
      }
      data['animations'] = merged;
    }
  } else if (fileType === 'animation_controller') {
    const ctrls = data['animation_controllers'];
    if (isPlainObject(ctrls)) {
      const merged: Json = { ...ctrls };
      for (const sourceData of sourceDataList) {
        const sourceCtrls = sourceData['animation_controllers'];
        if (!isPlainObject(sourceCtrls)) continue;
        for (const [name, ctrlData] of Object.entries(sourceCtrls)) {
          if (!(name in merged)) {
            merged[name] = ctrlData;
            patchesApplied.push({ file: filePath, type: 'restored_controller', controller: name });
          }
        }
      }
      data['animation_controllers'] = merged;
    }
  }

  // Universal: ensure format_version is present
  if (!('format_version' in data)) {
    for (const sourceData of sourceDataList) {
      if ('format_version' in sourceData) {
        data['format_version'] = sourceData['format_version'];
        patchesApplied.push({ file: filePath, type: 'restored_format_version' });
        break;
      }
    }
  }

  if (patchesApplied.length > before) {
    console.info(`[Aippy] Patcher: ${patchesApplied.length - before} fix(es) applied to ${filePath}`);
  }
  return data;
}