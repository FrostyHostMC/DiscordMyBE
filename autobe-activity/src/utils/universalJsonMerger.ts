// Ported from AutoBE.py UniversalJsonMerger (Part 1/19).
// Desktop/GitHub/Discord/token references removed. Pure logic only.

export interface MergeReport {
  conflicts: string[];
  warnings: string[];
}

/** Keys merged first-wins per entry ID (animations, controllers, textures...). */
const FIRST_WINS_KEYS = new Set([
  'animations',
  'animation_controllers',
  'render_controllers',
  'materials',
  'textures',
  'sounds',
  'particle_effects'
]);

/** Keys whose arrays are concatenated with duplicate removal. */
const CONCATENATE_KEYS = new Set(['initialize', 'pre_animation', 'animate', 'scripts']);

/** Keys keeping the highest version value. */
const VERSION_KEYS = new Set(['format_version', 'min_engine_version']);

const CRITICAL_ANIM_KEYS = ['loops', 'blend_expression', 'anim_time_update', 'transition_duration'];

export type Json = any;

function isObj(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Detect file type from structure / path. */
export function detectFileType(obj: Json, filePath?: string): string {
  const p = filePath || '';
  const s = JSON.stringify(obj);
  if (p.includes('entity')) {
    if (s.includes('minecraft:client_entity')) return 'client_entity';
    if (s.includes('minecraft:entity')) return 'entity';
  }
  if (p.includes('item')) return 'item';
  if (p.includes('block')) return 'block';
  if (isObj(obj)) {
    if ('minecraft:client_entity' in obj) return 'client_entity';
    if ('minecraft:entity' in obj) return 'entity';
    if ('minecraft:item' in obj) return 'item';
    if ('minecraft:block' in obj) return 'block';
  }
  return 'generic';
}

/** Compare two version values (list or string) and return the highest. */
export function compareVersionValues(v1: Json, v2: Json): Json {
  try {
    if (Array.isArray(v1) && Array.isArray(v2)) {
      for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
        const a = Number(v1[i]) || 0;
        const b = Number(v2[i]) || 0;
        if (a > b) return v1;
        if (b > a) return v2;
      }
      return v1;
    }
    if (typeof v1 === 'string' && typeof v2 === 'string') {
      const p1 = v1.split('.').map((x) => parseInt(x, 10) || 0);
      const p2 = v2.split('.').map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const a = p1[i] || 0;
        const b = p2[i] || 0;
        if (a > b) return v1;
        if (b > a) return v2;
      }
      return v1;
    }
  } catch {
    // fall through to last-wins
  }
  return v2;
}

function entriesCompatible(e1: Json, e2: Json): boolean {
  if (typeof e1 !== typeof e2) return false;
  if (isObj(e1) && isObj(e2)) {
    const k1 = Object.keys(e1);
    const k2 = Object.keys(e2);
    if (Math.abs(k1.length - k2.length) > 3) return false;
    for (const k of CRITICAL_ANIM_KEYS) {
      if (k in e1 && k in e2 && JSON.stringify(e1[k]) !== JSON.stringify(e2[k])) return false;
    }
  }
  return true;
}

function concatUnique(base: Json[], overlay: Json[]): Json[] {
  const seen = new Set(base.map((i) => JSON.stringify(i)));
  const result = [...base];
  for (const item of overlay) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      result.push(item);
      seen.add(key);
    }
  }
  return result;
}

export class UniversalJsonMerger {
  conflicts: string[] = [];
  warnings: string[] = [];

  reset(): void {
    this.conflicts = [];
    this.warnings = [];
  }

  /**
   * Merge a list of JSON objects (multiple packs providing the same file)
   * with context-aware strategies. Returns the merged object.
   */
  mergeJsonList(jsonList: Json[], filePath?: string): Json {
    if (!jsonList || jsonList.length === 0) return {};
    this.reset();
    const fileType = detectFileType(jsonList[0], filePath);
    let merged = structuredClone(jsonList[0]);
    for (let i = 1; i < jsonList.length; i++) {
      try {
        merged = this.mergeObjects(merged, jsonList[i], fileType, '');
      } catch (e) {
        this.warnings.push(`Smart merge failed for ${filePath ?? 'unknown'}, using fallback: ${String(e)}`);
        merged = fallbackMerge(merged, jsonList[i]);
      }
    }
    return merged;
  }

  mergeObjects(base: Json, overlay: Json, fileType: string, path: string): Json {
    for (const [key, value] of Object.entries(overlay)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (!(key in base)) {
        base[key] = structuredClone(value);
      } else if (isObj(base[key]) && isObj(value)) {
        if (FIRST_WINS_KEYS.has(key)) {
          base[key] = this.mergeFirstWinsMap(base[key], value, key, currentPath);
        } else {
          base[key] = this.mergeObjects(base[key], value, fileType, currentPath);
        }
      } else if (Array.isArray(base[key]) && Array.isArray(value)) {
        if (CONCATENATE_KEYS.has(key) || currentPath.includes('scripts')) {
          base[key] = concatUnique(base[key], value);
        } else {
          base[key] = structuredClone(value);
        }
      } else if (VERSION_KEYS.has(key)) {
        base[key] = compareVersionValues(base[key], value);
      } else {
        base[key] = value;
      }
    }
    return base;
  }

  private mergeFirstWinsMap(base: Json, overlay: Json, key: string, path: string): Json {
    for (const [entryId, entryData] of Object.entries(overlay)) {
      if (!(entryId in base)) {
        base[entryId] = entryData;
      } else if (entriesCompatible(base[entryId], entryData)) {
        base[entryId] = this.mergeObjects(base[entryId], entryData, key, path);
      } else {
        this.conflicts.push(`Incompatible ${key} entry '${entryId}' at ${path}`);
      }
    }
    return base;
  }
}

/** Simple last-wins deep merge used when smart merge fails. */
export function fallbackMerge(base: Json, overlay: Json): Json {
  try {
    for (const [key, value] of Object.entries(overlay)) {
      if (!(key in base)) {
        base[key] = structuredClone(value);
      } else if (isObj(base[key]) && isObj(value)) {
        base[key] = fallbackMerge(base[key], value);
      } else if (Array.isArray(base[key]) && Array.isArray(value)) {
        base[key] = [...base[key], ...value];
      } else {
        base[key] = value;
      }
    }
  } catch (e) {
    console.warn(`[Aippy] Fallback merge error: ${String(e)}`);
  }
  return base;
}