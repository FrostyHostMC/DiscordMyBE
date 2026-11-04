import type JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';
import { hasDynamicTemplateIdentifierReference, rewriteIdentifierTokens, rewriteStaticScriptIdentifierReferences } from './identifierReferences';

type Definition = { path: string; root: string; identifier: string; data: any };

const DEFINITION_ROOTS = [
  'minecraft:item', 'minecraft:block', 'minecraft:entity', 'minecraft:client_entity',
  'minecraft:attachable', 'minecraft:recipe_shaped', 'minecraft:recipe_shapeless',
  'minecraft:recipe_furnace', 'minecraft:recipe_brewing_mix',
  'minecraft:recipe_brewing_container', 'minecraft:recipe_smithing_transform',
  'minecraft:recipe_smithing_trim', 'minecraft:recipe'
];

const REFERENCE_KEYS = new Set([
  'identifier', 'item', 'item_name', 'result', 'input', 'output', 'block', 'blocks',
  'entity', 'entities', 'spawn_entity', 'spawn_entities', 'target', 'loot_table',
  'table', 'place_on', 'destroy_speeds', 'spawnable_entities', 'equipment',
  'trade_item', 'buy', 'sell', 'ingredient', 'ingredients', 'drop', 'drops',
  'texture', 'textures', 'geometry', 'animations', 'animation',
  'animation_controllers', 'render_controllers', 'particle_effect', 'effect',
  'sound', 'sounds', 'controller', 'controllers'
]);
const EXPRESSION_KEYS = /(?:molang|expression|condition|query|script|pre_animation|initialize|animate|on_entry|on_exit|command|function)/i;

function isDefinitionPath(path: string): boolean {
  const normalized = path.replaceAll('\\\\', '/').toLowerCase();
  const segments = normalized.split('/');
  const folder = segments.length > 1 ? segments[segments.length - 2] : '';
  return new Set(['items', 'blocks', 'entities', 'entity', 'attachables', 'recipes', 'loot_tables', 'spawn_rules']).has(folder) ||
    new Set(['items.json', 'blocks.json', 'entities.json', 'entity.json', 'attachables.json', 'recipes.json']).has(segments[segments.length - 1]);
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

function rewriteEmbeddedIdentifierTokens(value: string, idMap: Map<string, string>): string {
  let output = value;
  for (const [oldId, newId] of [...idMap.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const escaped = oldId.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
    const expression = new RegExp(`(^|[^A-Za-z0-9_.:-])${escaped}(?![A-Za-z0-9_.:-])`, 'g');
    output = output.replace(expression, (_match, before) => before + newId);
  }
  return output;
}

function collectKnownReferences(value: any, idMap: Map<string, string>, key = '', parent?: any): any {
  if (typeof value === 'string') {
    if (REFERENCE_KEYS.has(key) && idMap.has(value)) return idMap.get(value)!;
    if (key === 'name' && parent?.type === 'item' && idMap.has(value)) return idMap.get(value)!;
    if (EXPRESSION_KEYS.test(key)) return rewriteEmbeddedIdentifierTokens(value, idMap);
    return value;
  }
  if (Array.isArray(value)) return value.map(item => collectKnownReferences(item, idMap, key, parent));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, any> = {};
  for (const [childKey, child] of Object.entries(value)) {
    const mappedKey = idMap.get(childKey) || childKey;
    out[mappedKey] = collectKnownReferences(child, idMap, childKey, value);
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
 * Source-aware registry. Renames only incoming custom definitions that collide
 * with an earlier pack, then repairs schema-recognized references in that source.
 * Vanilla minecraft:* identifiers are deliberately never renamed.
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
    if (!file.dir) paths.push(path);
  });
  for (const path of paths) {
    const file = sourceZip.file(path);
    if (!file) continue;
    const lower = path.toLowerCase();
    try {
      if (lower.endsWith('.json')) {
        const data = JSON.parse(sanitizeJsonString(await file.async('text')));
        const rewritten = collectKnownReferences(data, idMap);
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
      } else if (/\\.(js|mjs|cjs|ts)$/i.test(lower)) {
        const original = await file.async('text');
        if (hasDynamicTemplateIdentifierReference(original, idMap)) {
          diagnostics.push(`WARNING DYNAMIC_SCRIPT_IDENTIFIER_REFERENCE [${sourceLabel}:${path}]: A dynamic template literal contains a renamed identifier. AutoBE left that expression unchanged because its runtime value cannot be safely inferred.`);
        }
        const output = rewriteStaticScriptIdentifierReferences(original, idMap);
        if (output !== original) {
          sourceZip.file(path, output);
          changedFiles++;
        }
      } else if (/\\.(mcfunction|molang|material)$/i.test(lower)) {
        const original = await file.async('text');
        const output = rewriteIdentifierTokens(original, idMap);
        if (output !== original) {
          sourceZip.file(path, output);
          changedFiles++;
        }
      }
    } catch {
      // Invalid or unsupported source remains intact; archive validation reports malformed JSON.
    }
  }
  return changedFiles;
}
