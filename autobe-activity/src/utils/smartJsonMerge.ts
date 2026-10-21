/**
 * Port of AutoBE Part 18 _merge_json / _merge_entity_json_simple /
 * _deep_merge_union (file-specific branches) plus the blocks.json and
 * client-entity post-processing passes.
 *
 * The generic entity/behavior merge (max-wins stats, component-group
 * routing) lives in behaviorEntityMerge.ts (Part 17). This module covers
 * the remaining per-file strategies:
 *   - player animation/controller files: first-wins per named entry
 *   - _ui_defs.json: union of ui_defs arrays
 *   - hud_screen.json: modifications arrays concatenated, `visible`
 *     conditions combined with `&&`
 *   - item_texture/terrain_texture: first-wins per texture_data key
 *   - sound_definitions.json: union of sounds arrays per definition
 *   - crafting_item_catalog.json: union groups by category/icon
 *   - blocks.json: strip legacy geometry/shape keys from custom entries
 *   - client entity: strip empty-string alias values
 */

const UNION_LIST_KEYS = new Set([
  'component_groups', 'animations', 'animate', 'particle_effects',
  'sound_effects', 'scripts', 'pools', 'entries', 'conditions',
  'spawn_rules', 'behaviors', 'render_controllers'
]);

const MERGE_MAX_KEYS = new Set([
  'value', 'max', 'min', 'amount', 'speed', 'damage',
  'range', 'radius', 'duration', 'cooldown', 'max_dist', 'priority'
]);

const KEEP_FIRST_KEYS = new Set(['format_version', 'description', 'identifier',
  'minecraft:collision_box', 'minecraft:movement']);

/** Union-dedupe two lists preserving order (by JSON fingerprint). */
export function unionMergeList(existing: any[], incoming: any[]): any[] {
  const seen = new Set(
    existing.map((i) => (typeof i === 'object' ? JSON.stringify(i) : String(i)))
  );
  const result = [...existing];
  for (const item of incoming) {
    const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
    if (!seen.has(key)) {
      result.push(item);
      seen.add(key);
    }
  }
  return result;
}

/** Normalize Molang spelling variants so duplicates are recognized. */
function normalizeString(s: string): string {
  let out = s.replace(/\s*=\s*/g, '=');
  out = out
    .replaceAll('1st_person', 'first_person')
    .replaceAll('3rd_person', 'third_person')
    .replaceAll('v.is_first_person', 'variable.is_first_person')
    .replaceAll('q.is_spectator', 'query.is_spectator');
  return out;
}

function removeDuplicates(list: any[], checkKeys = false): any[] {
  const unique: any[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    try {
      if (typeof item === 'string') {
        const norm = normalizeString(item);
        if (!seen.has(norm)) {
          unique.push(item);
          seen.add(norm);
        }
      } else if (item && typeof item === 'object') {
        const normEntries = Object.entries(item).map(([k, v]) => [
          normalizeString(k),
          typeof v === 'string' ? normalizeString(v) : v
        ]);
        const key = checkKeys
          ? JSON.stringify(normEntries.map(([k]) => k).sort())
          : JSON.stringify(normEntries.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
        if (!seen.has(key)) {
          unique.push(item);
          seen.add(key);
        }
      } else {
        unique.push(item);
      }
    } catch {
      unique.push(item);
    }
  }
  return unique;
}

/** Union strategy deep merge — overlay adds to base, never overwrites. */
export function deepMergeUnion(base: any, overlay: any): any {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return overlay ?? base;
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return overlay;
  for (const key of Object.keys(overlay)) {
    if (!(key in base)) {
      base[key] = overlay[key];
    } else if (base[key] && overlay[key] && typeof base[key] === 'object' && typeof overlay[key] === 'object') {
      if (Array.isArray(base[key]) && Array.isArray(overlay[key])) {
        for (const item of overlay[key]) {
          if (!base[key].some((x: any) => JSON.stringify(x) === JSON.stringify(item))) {
            base[key].push(item);
          }
        }
      } else if (!Array.isArray(base[key]) && !Array.isArray(overlay[key])) {
        deepMergeUnion(base[key], overlay[key]);
      }
    }
    // primitives: keep base (first wins)
  }
  return base;
}

/** Simple union merge for client entity JSON to preserve all custom features. */
export function mergeEntityJsonSimple(list: any[]): any {
  if (list.length === 0) return {};
  if (list.length === 1) return list[0];
  const merged = structuredClone(list[0]);
  for (let i = 1; i < list.length; i++) deepMergeUnion(merged, list[i]);
  return merged;
}

function mergeCatGroup(mergedCat: any, newCat: any): void {
  const categories = newCat?.categories;
  if (!Array.isArray(categories)) return;
  if (!Array.isArray(mergedCat.categories)) mergedCat.categories = [];
  const existing = new Map<string, any>();
  for (const c of mergedCat.categories) {
    if (c && typeof c === 'object') existing.set(c.category_name, c);
  }
  for (const nc of categories) {
    if (!nc || typeof nc !== 'object') continue;
    const cname = nc.category_name;
    if (existing.has(cname)) {
      const eg = (existing.get(cname).groups ??= []);
      const icons = new Set(
        eg.filter((g: any) => g && typeof g === 'object').map((g: any) => g.group_identifier?.icon)
      );
      for (const ng of nc.groups ?? []) {
        if (ng && typeof ng === 'object') {
          const icon = ng.group_identifier?.icon;
          if (!icons.has(icon)) {
            eg.push(ng);
            icons.add(icon);
          }
        }
      }
    } else {
      mergedCat.categories.push(nc);
      existing.set(cname, nc);
    }
  }
}

/**
 * Merge a list of parsed JSON values for one output file using the legacy
 * per-file strategies. `fileName` is the lowercase zip path.
 */
export function mergeJsonForFile(fileName: string, list: any[]): any {
  if (list.length === 0) return {};
  if (list.length === 1) return postProcessFile(fileName, structuredClone(list[0]));
  const base = fileName.substring(fileName.lastIndexOf('/') + 1);

  if (base.endsWith('.entity.json') || base === 'player.entity.json') {
    return postProcessFile(fileName, mergeEntityJsonSimple(list));
  }

  const merged: any = {};
  for (const data of list) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    for (const [key, value] of Object.entries(data)) {
      if (key === 'format_version') {
        if (!('format_version' in merged)) merged.format_version = value;
        continue;
      }
      if (base === 'player.animation_controllers.json' || base === 'player.render_controllers.json' || base === 'player.animation.json') {
        // First-wins per named entry: deep-merging two incompatible animation
        // state machines produces broken results.
        if (!(key in merged)) {
          merged[key] = value;
        } else if (merged[key] && typeof merged[key] === 'object' && value && typeof value === 'object') {
          if (Array.isArray(merged[key]) && Array.isArray(value)) {
            merged[key] = removeDuplicates([...merged[key], ...value]);
          } else if (!Array.isArray(merged[key]) && !Array.isArray(value)) {
            for (const [sk, sv] of Object.entries(value)) {
              if (!(sk in merged[key])) merged[key][sk] = sv;
            }
          }
        }
        continue;
      }
      if (base === '_ui_defs.json') {
        if (!(key in merged)) {
          merged[key] = value;
        } else if (Array.isArray(value)) {
          if (!Array.isArray(merged[key])) merged[key] = [merged[key]];
          merged[key] = removeDuplicates([...merged[key], ...value]);
        } else if (typeof value === 'string') {
          if (Array.isArray(merged[key])) {
            if (!merged[key].some((v: any) => normalizeString(v) === normalizeString(value))) {
              merged[key].push(value);
            }
          } else {
            merged[key] = [merged[key], value];
          }
        } else {
          merged[key] = value;
        }
        continue;
      }
      if (base === 'hud_screen.json') {
        if (!(key in merged)) {
          merged[key] = structuredClone(value);
        } else if (key === 'modifications' && Array.isArray(merged[key]) && Array.isArray(value)) {
          merged[key] = [...merged[key], ...value];
        } else if (Array.isArray(merged[key]) && Array.isArray(value)) {
          merged[key] = [...merged[key], ...value];
        } else {
          merged[key] = mergeJsonForFile(base, [merged[key], value]);
        }
        continue;
      }
      if (base === 'item_texture.json' || base === 'terrain_texture.json') {
        if (!(key in merged)) {
          merged[key] = structuredClone(value);
        } else if (key === 'texture_data' && merged[key] && typeof merged[key] === 'object' && value && typeof value === 'object') {
          // First-wins: only add texture entries not already present
          for (const [tk, tv] of Object.entries(value)) {
            if (!(tk in merged[key])) merged[key][tk] = tv;
          }
        } else {
          merged[key] = mergeJsonForFile(base, [merged[key], value]);
        }
        continue;
      }
      if (base === 'sound_definitions.json' && key === 'sound_definitions') {
        if (!(key in merged)) {
          merged[key] = structuredClone(value);
        } else if (merged[key] && typeof merged[key] === 'object' && value && typeof value === 'object') {
          for (const [sk, sv] of Object.entries(value as Record<string, any>)) {
            if (!(sk in merged[key])) {
              merged[key][sk] = sv;
            } else if (merged[key][sk] && typeof merged[key][sk] === 'object') {
              const ex = merged[key][sk].sounds;
              const nw = sv.sounds;
              if (Array.isArray(ex) && Array.isArray(nw)) {
                merged[key][sk].sounds = [...ex, ...nw.filter((s: any) => !ex.some((e: any) => JSON.stringify(e) === JSON.stringify(s)))];
              }
            }
          }
        }
        continue;
      }
      if (base === 'crafting_item_catalog.json' && key === 'minecraft:crafting_items_catalog') {
        if (!(key in merged)) {
          merged[key] = structuredClone(value);
        } else if (merged[key] && typeof merged[key] === 'object' && value && typeof value === 'object') {
          mergeCatGroup(merged[key], value);
        }
        continue;
      }
      // Generic merge
      if (!(key in merged)) {
        merged[key] = structuredClone(value);
      } else if (base.endsWith('.json') && ['components', 'component_groups', 'events', 'spawn_rules', 'behaviors'].includes(key)) {
        merged[key] = mergeJsonForFile(base, [merged[key], value]);
      } else if (Array.isArray(merged[key]) && Array.isArray(value)) {
        merged[key] = key in UNION_LIST_KEYS
          ? unionMergeList(merged[key], value)
          : removeDuplicates([...merged[key], ...value], true);
      } else if (merged[key] && typeof merged[key] === 'object' && value && typeof value === 'object' && !Array.isArray(merged[key]) && !Array.isArray(value)) {
        merged[key] = mergeJsonForFile(base, [merged[key], value]);
      } else if (key in MERGE_MAX_KEYS && typeof merged[key] === 'number' && typeof value === 'number') {
        merged[key] = Math.max(merged[key], value);
      } else if (key in KEEP_FIRST_KEYS) {
        // keep first
      } else if (key === 'visible' && base === 'hud_screen.json' && typeof merged[key] === 'string' && typeof value === 'string' && merged[key] !== value) {
        merged[key] = `(${merged[key]}) && (${value})`;
      } else {
        merged[key] = value;
      }
    }
  }
  return postProcessFile(fileName, merged);
}

/**
 * Post-merge fixes ported from _merge_json:
 *  - blocks.json: strip legacy geometry/shape specs from custom-namespace
 *    block entries so they don't clash with minecraft:geometry components.
 *  - client entity: strip empty-string keys from geometry/textures/materials
 *    to prevent Molang "geometry. not found" errors.
 */
export function postProcessFile(fileName: string, merged: any): any {
  if (!merged || typeof merged !== 'object') return merged;
  const base = fileName.substring(fileName.lastIndexOf('/') + 1);

  if (base === 'blocks.json') {
    const legacyKeys = ['geometry', 'carried_textures', 'isotropic', 'brightness_gamma'];
    for (const key of Object.keys(merged)) {
      if (key.includes(':') && !key.startsWith('minecraft:') && merged[key] && typeof merged[key] === 'object') {
        for (const lk of legacyKeys) delete merged[key][lk];
      }
    }
    return merged;
  }

  if (base.endsWith('.entity.json')) {
    for (const rootKey of ['minecraft:client_entity', 'minecraft:entity']) {
      const desc = merged[rootKey]?.description;
      if (!desc || typeof desc !== 'object') continue;
      for (const sect of ['geometry', 'textures', 'materials', 'animations']) {
        const v = desc[sect];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const cleaned: Record<string, any> = {};
          for (const [k, val] of Object.entries(v)) {
            if (k.trim() && val !== '' && val != null && String(val).trim()) cleaned[k] = val;
          }
          desc[sect] = cleaned;
        }
      }
    }
  }
  return merged;
}