import type JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';

type Definition = { path: string; root: string; identifier: string; data: any };

const DEFINITION_ROOTS = [
  'minecraft:item',
  'minecraft:block',
  'minecraft:entity',
  'minecraft:client_entity',
  'minecraft:attachable',
  'minecraft:recipe_shaped',
  'minecraft:recipe_shapeless',
  'minecraft:recipe_furnace',
  'minecraft:recipe_brewing_mix',
  'minecraft:recipe_brewing_container',
  'minecraft:recipe_smithing_transform',
  'minecraft:recipe_smithing_trim',
  'minecraft:recipe'
];

const REFERENCE_KEYS = new Set([
  'identifier', 'item', 'item_name', 'result', 'input', 'output',
  'block', 'blocks', 'entity', 'entities', 'spawn_entity', 'target',
  'loot_table', 'table', 'place_on', 'destroy_speeds',
  'spawnable_entities', 'equipment'
]);

function isDefinitionPath(path: string): boolean {
  const p = path.toLowerCase().replace(/\\/g, '/');
  return /(^|\/)(items|blocks|entities|entity|attachables|recipes|loot_tables|spawn_rules)\//.test(p) ||
    /(^|\/)(items|blocks|entities|entity|attachables|recipes)\.json$/.test(p);
}

function collectDefinitions(zip: JSZip): Promise<Definition[]> {
  const jobs: Promise<Definition | null>[] = [];
  zip.forEach((path, file) => {
    if (file.dir || !path.toLowerCase().endsWith('.json') || !isDefinitionPath(path)) return;
    jobs.push(file.async('text').then(text => {
      const data = JSON.parse(sanitizeJsonString(text));
      for (const root of DEFINITION_ROOTS) {
        const id = data?.[root]?.description?.identifier;
        if (typeof id === 'string' && id.includes(':')) return { path, root, identifier: id, data };
      }
      return null;
    }).catch(() => null));
  });
  return Promise.all(jobs).then(items => items.filter((x): x is Definition => !!x));
}

function collectKnownReferences(value: any, idMap: Map<string, string>, key = '', parent?: any): any {
  if (typeof value === 'string') {
    if (REFERENCE_KEYS.has(key) && idMap.has(value)) return idMap.get(value)!;
    // Loot tables reference an item through { type: "item", name: "namespace:id" }.
    // A generic display/name field is not an identifier and must remain untouched.
    if (key === 'name' && parent?.type === 'item' && idMap.has(value)) return idMap.get(value)!;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => collectKnownReferences(item, idMap, key, parent));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, any> = {};
  for (const [childKey, child] of Object.entries(value)) {
    out[childKey] = collectKnownReferences(child, idMap, childKey, value);
  }
  return out;
}

function uniqueIdentifier(original: string, occupied: Set<string>): string {
  const colon = original.indexOf(':');
  const namespace = colon >= 0 ? original.slice(0, colon) : 'autobe';
  const path = colon >= 0 ? original.slice(colon + 1) : original;
  let suffix = 2;
  let candidate = '';
  do {
    candidate = `${namespace}_autobe_${suffix}:${path}`;
    suffix++;
  } while (occupied.has(candidate));
  return candidate;
}

/**
 * Source-aware feature registry. When a later pack defines an identifier already
 * claimed by an earlier pack, give the incoming definition a deterministic new
 * identifier and repair exact, schema-shaped references inside that source pack.
 * Vanilla minecraft:* identifiers are never renamed automatically.
 */
export async function applyFeatureRegistry(sourceZip: JSZip, targetZip: JSZip, sourceLabel: string, diagnostics: string[] = []): Promise<number> {
  const [incoming, existing] = await Promise.all([collectDefinitions(sourceZip), collectDefinitions(targetZip)]);
  const occupied = new Set<string>([...existing, ...incoming].map(item => item.identifier));
  const existingById = new Map<string, Definition[]>();
  for (const def of existing) {
    const list = existingById.get(def.identifier) || [];
    list.push(def);
    existingById.set(def.identifier, list);
  }

  const idMap = new Map<string, string>();
  for (const def of incoming) {
    if (!existingById.has(def.identifier)) continue;
    if (def.identifier.startsWith('minecraft:')) {
      diagnostics.push(`VANILLA_IDENTIFIER_CONFLICT [${sourceLabel}:${def.path}]: ${def.identifier} overrides an identifier already supplied by an earlier pack. AutoBE preserved vanilla semantics; choose which pack should own this override.`);
      continue;
    }
    if (idMap.has(def.identifier)) continue;
    const replacement = uniqueIdentifier(def.identifier, occupied);
    occupied.add(replacement);
    idMap.set(def.identifier, replacement);
    diagnostics.push(`FEATURE_REGISTRY_RENAMED [${sourceLabel}:${def.path}]: duplicate custom identifier "${def.identifier}" was renamed to "${replacement}" in this add-on; recognized references in the same add-on were updated.`);
  }

  if (!idMap.size) return 0;
  let changedFiles = 0;
  const paths: string[] = [];
  sourceZip.forEach((path, file) => {
    if (!file.dir && path.toLowerCase().endsWith('.json')) paths.push(path);
  });
  for (const path of paths) {
    const file = sourceZip.file(path);
    if (!file) continue;
    try {
      const text = await file.async('text');
      const data = JSON.parse(sanitizeJsonString(text));
      const rewritten = collectKnownReferences(data, idMap);
      // Definitions are recognized by their root schema; only those identifiers
      // are rewritten as definitions, never arbitrary strings or display text.
      let didChange = false;
      for (const root of DEFINITION_ROOTS) {
        const id = rewritten?.[root]?.description?.identifier;
        if (typeof id === 'string' && idMap.has(id)) {
          rewritten[root].description.identifier = idMap.get(id);
          didChange = true;
        }
      }
      const output = JSON.stringify(rewritten, null, 2);
      if (didChange || output !== JSON.stringify(data, null, 2)) {
        sourceZip.file(path, output);
        changedFiles++;
      }
    } catch {
      // Invalid JSON remains untouched; the archive validator reports it.
    }
  }
  return changedFiles;
}
