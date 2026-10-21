/**
 * Port of AutoBE Part 17 behavior-entity merging (_merge_behavior_entity) and
 * the intelligent JSON merge (_merge_json_data with _MERGE_MAX_KEYS /
 * _UNION_LIST_KEYS / component-group routing).
 *
 * Strategy for root `components` conflicts when two addons define the same
 * entity:
 *   - The first addon's value is kept as the base.
 *   - Each subsequent addon's *conflicting* component is placed into a
 *     uniquely-named component_group (`autobe_<packname>_ov`) and that group is
 *     activated via the `minecraft:entity_spawned` event. ALL addons' values
 *     remain present and Bedrock applies them in component-group stack order —
 *     fully deterministic, no silent drops.
 *   - Non-conflicting components merge into the base directly.
 * Everything outside `components` is union-merged as usual.
 */

// Numeric keys where "take the max" is the safest strategy when two addons conflict
const MERGE_MAX_KEYS = new Set([
  'value', 'max', 'min', 'amount', 'speed', 'damage',
  'range', 'radius', 'duration', 'cooldown', 'max_dist',
  'priority' // lower number = higher priority; max keeps the less aggressive override
]);

const KEEP_FIRST_KEYS = new Set(['format_version', 'description', 'identifier']);

/** Player.json components that must keep the first pack's value. */
const KEEP_FIRST_COMPONENTS = new Set(['minecraft:collision_box', 'minecraft:movement']);

/** Keys whose list values must always be union-deduplicated (order preserved). */
const UNION_LIST_KEYS = new Set([
  'component_groups', 'animations', 'animate', 'particle_effects',
  'sound_effects', 'scripts', 'pools', 'entries', 'conditions',
  'spawn_rules', 'behaviors', 'render_controllers'
]);

function fingerprint(item: any): string {
  return typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item);
}

/** Return existing + any items from incoming not already present (by JSON fingerprint). */
export function unionMergeList(existing: any[], incoming: any[]): any[] {
  const seen = new Set(existing.map(fingerprint));
  const result = [...existing];
  for (const item of incoming) {
    const key = fingerprint(item);
    if (!seen.has(key)) {
      result.push(item);
      seen.add(key);
    }
  }
  return result;
}

/**
 * Recursively merges JSON data from `source` into `target` (mutates target)
 * with intelligent conflict resolution. Port of AutoBE._merge_json_data.
 */
export function mergeJsonData(target: any, source: any): void {
  if (!source || typeof source !== 'object') return;
  if (!target || typeof target !== 'object') return;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (!(key in target)) {
      target[key] = value;
      continue;
    }
    const t = target[key];

    // Dicts always recurse
    if (t && typeof t === 'object' && value && typeof value === 'object' && !Array.isArray(t) && !Array.isArray(value)) {
      mergeJsonData(t, value);
      continue;
    }

    // Lists — union-deduplicate (both union keys and others)
    if (Array.isArray(t) && Array.isArray(value)) {
      target[key] = unionMergeList(t, value);
      continue;
    }

    // Primitive vs primitive
    if (KEEP_FIRST_KEYS.has(key)) {
      // keep first
    } else if (MERGE_MAX_KEYS.has(key) && typeof t === 'number' && typeof value === 'number') {
      // Two addons set the same stat differently — honour both by taking the larger value
      target[key] = Math.max(t, value);
    } else if (KEEP_FIRST_COMPONENTS.has(key)) {
      // keep first — prevents vanilla values overwriting pack overrides
    } else {
      target[key] = value; // last-wins for everything else
    }
  }
}

interface EntityFileEntry {
  /** Original pack/file name used to build the override group name. */
  packName: string;
  data: any;
}

function cleanPackToken(packName: string): string {
  return packName
    .replace(/\.(mcpack|mcaddon)$/i, '')
    .replace(/_modified$/i, '')
    .replace(/_\d+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 16)
    .replace(/^_+|_+$/g, '');
}

/**
 * Merge multiple behavior-pack definitions of the same entity.
 * `entries[0]` is the base; later entries route conflicting components into
 * component groups. Mutates and returns the merged definition.
 */
export function mergeBehaviorEntity(entries: EntityFileEntry[]): any {
  if (entries.length === 0) return {};
  if (entries.length === 1) return entries[0].data;

  const merged = structuredClone(entries[0].data);
  const ENT_KEY = 'minecraft:entity';

  for (let i = 1; i < entries.length; i++) {
    const src = entries[i].data;
    const groupName = `autobe_${cleanPackToken(entries[i].packName)}_ov`;

    if (!src || typeof src !== 'object' || !src[ENT_KEY] || !merged[ENT_KEY]) {
      mergeJsonData(merged, src);
      continue;
    }

    const srcDef = src[ENT_KEY];
    const baseDef = merged[ENT_KEY];
    const srcComps = srcDef.components ?? {};
    if (!baseDef.components || typeof baseDef.components !== 'object') baseDef.components = {};
    const baseComps = baseDef.components;

    const overrides: Record<string, any> = {};
    for (const compKey of Object.keys(srcComps)) {
      const compVal = srcComps[compKey];
      if (compKey in baseComps) {
        if (JSON.stringify(compVal) !== JSON.stringify(baseComps[compKey])) {
          // Genuinely different value — route to component group
          overrides[compKey] = compVal;
        }
        // else: identical, skip
      } else {
        baseComps[compKey] = compVal; // new component, add to base
      }
    }

    if (Object.keys(overrides).length > 0) {
      if (!baseDef.component_groups || typeof baseDef.component_groups !== 'object') baseDef.component_groups = {};
      baseDef.component_groups[groupName] = overrides;
      if (!baseDef.events || typeof baseDef.events !== 'object') baseDef.events = {};
      if (!baseDef.events['minecraft:entity_spawned'] || typeof baseDef.events['minecraft:entity_spawned'] !== 'object') {
        baseDef.events['minecraft:entity_spawned'] = {};
      }
      const spawnEv = baseDef.events['minecraft:entity_spawned'];
      if (!spawnEv.add || typeof spawnEv.add !== 'object') spawnEv.add = {};
      if (!Array.isArray(spawnEv.add.component_groups)) spawnEv.add.component_groups = [];
      const cgList: string[] = spawnEv.add.component_groups;
      if (!cgList.includes(groupName)) cgList.push(groupName);
    }

    // Merge everything else in the entity definition except components
    for (const key of Object.keys(srcDef)) {
      if (key === 'components') continue;
      const v = srcDef[key];
      if (key in baseDef) {
        const bv = baseDef[key];
        if (bv && typeof bv === 'object' && v && typeof v === 'object' && !Array.isArray(bv) && !Array.isArray(v)) {
          mergeJsonData(bv, v);
        } else if (Array.isArray(bv) && Array.isArray(v)) {
          baseDef[key] = unionMergeList(bv, v);
        }
      } else {
        baseDef[key] = structuredClone(v);
      }
    }

    // Merge top-level keys outside minecraft:entity
    for (const key of Object.keys(src)) {
      if (key === ENT_KEY) continue;
      if (!(key in merged)) merged[key] = structuredClone(src[key]);
    }
  }

  return merged;
}