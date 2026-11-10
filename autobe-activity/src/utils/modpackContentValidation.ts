import JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';
import type { PackValidationIssue } from './mergedArchiveValidation';

type JsonEntry = { path: string; data: any };

async function readJson(zip: JSZip): Promise<JsonEntry[]> {
  const entries: JsonEntry[] = [];
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || !path.toLowerCase().endsWith('.json')) continue;
    try { entries.push({ path, data: JSON.parse(sanitizeJsonString(await file.async('text'))) }); }
    catch { /* Syntax errors are reported by validateMergedArchive. */ }
  }
  return entries;
}

function isCustomIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value) &&
    !value.toLowerCase().startsWith('minecraft:');
}

/** Cross-check references across the final RP and every split BP output. */
export async function validateModpackContent(
  resourceZip: JSZip | null,
  behaviorZips: JSZip[],
): Promise<PackValidationIssue[]> {
  const issues: PackValidationIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ severity: 'warning', code, path, message });
  const [resourceEntries, behaviorGroups] = await Promise.all([
    resourceZip ? readJson(resourceZip) : Promise.resolve([]),
    Promise.all(behaviorZips.map(readJson))
  ]);
  const behaviorEntries = behaviorGroups.flat();

  // Verify static relative module imports after script-pack namespacing. Each
  // script output is an isolated runtime pack, so imports must resolve inside
  // that exact archive rather than merely somewhere in the combined modpack.
  for (let groupIndex = 0; groupIndex < behaviorZips.length; groupIndex++) {
    const zip = behaviorZips[groupIndex];
    const files = new Set(Object.entries(zip.files)
      .filter(([path, file]) => !file.dir && /\.(?:[cm]?js)$/i.test(path))
      .map(([path]) => path.replace(/\\/g, '/').toLowerCase()));
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir || !/\.(?:[cm]?js)$/i.test(path)) continue;
      const source = await file.async('text');
      const imports = source.matchAll(/(?:\bimport\s+(?:[^'";]*?\s+from\s+)?|\bexport\s+[^'";]*?\s+from\s+|\bimport\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g);
      for (const match of imports) {
        const specifier = match[1].replace(/\\/g, '/');
        const base = path.replace(/\\/g, '/').split('/');
        base.pop();
        for (const segment of specifier.split('/')) {
          if (!segment || segment === '.') continue;
          if (segment === '..') base.pop();
          else base.push(segment);
        }
        const resolved = base.join('/').toLowerCase();
        const candidates = [resolved, resolved + '.js', resolved + '.mjs', resolved + '.cjs', resolved + '.ts', resolved + '/index.js', resolved + '/index.mjs'];
        if (!candidates.some(candidate => files.has(candidate))) {
          add('MISSING_SCRIPT_MODULE_IMPORT', path,
            'Script imports "' + specifier + '", but no matching relative module exists in this generated behavior output. Imports cannot resolve across separate behavior-pack outputs.');
        }
      }
    }
  }
  const itemIds = new Set<string>();
  const blockIds = new Set<string>();
  const entityIds = new Set<string>();
  const clientEntityIds = new Set<string>();

  for (const entry of resourceEntries) {
    const clientEntity = entry.data?.['minecraft:client_entity']?.description?.identifier;
    if (typeof clientEntity === 'string') clientEntityIds.add(clientEntity);
  }
  for (const entry of behaviorEntries) {
    const item = entry.data?.['minecraft:item']?.description?.identifier;
    const block = entry.data?.['minecraft:block']?.description?.identifier;
    const entity = entry.data?.['minecraft:entity']?.description?.identifier;
    if (typeof item === 'string') itemIds.add(item);
    if (typeof block === 'string') blockIds.add(block);
    if (typeof entity === 'string') entityIds.add(entity);
  }

  const itemAliases = new Set<string>();
  const terrainAliases = new Set<string>();
  for (const entry of resourceEntries) {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    if (path.endsWith('textures/item_texture.json')) {
      Object.keys(entry.data?.texture_data || {}).forEach(alias => itemAliases.add(alias));
    }
    if (path.endsWith('textures/terrain_texture.json')) {
      Object.keys(entry.data?.texture_data || {}).forEach(alias => terrainAliases.add(alias));
    }
  }

  for (const entry of behaviorEntries) {
    const entityId = entry.data?.['minecraft:entity']?.description?.identifier;
    if (isCustomIdentifier(entityId) && !clientEntityIds.has(entityId)) {
      add('MISSING_CLIENT_ENTITY_DEFINITION', entry.path,
        `Behavior entity "${entityId}" has no matching resource-pack minecraft:client_entity definition; it may load without its intended model, textures or render controllers.`);
    }
    const item = entry.data?.['minecraft:item'];
    if (item) {
      const components = item.components || {};
      const placer = components['minecraft:entity_placer'];
      const entity = placer?.entity;
      if (isCustomIdentifier(entity) && !entityIds.has(entity)) {
        add('MISSING_SPAWN_EGG_ENTITY', entry.path,
          `Item "${item.description?.identifier || '(unknown)'}" places "${entity}", but no matching behavior entity exists in any generated behavior output.`);
      }
      const icon = components['minecraft:icon'];
      const iconAlias = typeof icon === 'string' ? icon : icon?.texture;
      if (isCustomIdentifier(iconAlias) && !itemAliases.has(iconAlias)) {
        add('MISSING_CUSTOM_ITEM_ICON_ALIAS', entry.path,
          `Item "${item.description?.identifier || '(unknown)'}" references icon alias "${iconAlias}", but that alias is absent from the merged item_texture.json.`);
      }
    }

    const block = entry.data?.['minecraft:block'];
    if (block) {
      const visit = (value: any): void => {
        if (typeof value === 'string') {
          if (isCustomIdentifier(value) && !terrainAliases.has(value)) {
            add('MISSING_CUSTOM_BLOCK_TEXTURE_ALIAS', entry.path,
              `Block "${block.description?.identifier || '(unknown)'}" references terrain alias "${value}", but it is absent from the merged terrain_texture.json.`);
          }
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      visit(block.components?.['minecraft:material_instances']);
    }

    const recipeRoots = [
      'minecraft:recipe_shaped', 'minecraft:recipe_shapeless', 'minecraft:recipe_furnace',
      'minecraft:recipe_brewing_mix', 'minecraft:recipe_brewing_container',
      'minecraft:recipe_smithing_transform', 'minecraft:recipe_smithing_trim'
    ];
    for (const root of recipeRoots) {
      const recipe = entry.data?.[root];
      if (!recipe) continue;
      const visitRecipe = (value: any, key = ''): void => {
        if (typeof value === 'string') {
          if (isCustomIdentifier(value) &&
              /^(?:item|input|output|reagent|base|addition|template|result)$/i.test(key) &&
              !itemIds.has(value) && !blockIds.has(value)) {
            add('MISSING_RECIPE_CONTENT_REFERENCE', entry.path,
              `Recipe "${recipe.description?.identifier || '(unknown)'}" references "${value}" in "${key}", but no matching custom item or block exists in any generated behavior output.`);
          }
        } else if (Array.isArray(value)) value.forEach(child => visitRecipe(child, key));
        else if (value && typeof value === 'object') {
          Object.entries(value).forEach(([childKey, child]) => visitRecipe(child, childKey));
        }
      };
      visitRecipe(recipe);
    }

    const normalizedPath = entry.path.toLowerCase().replace(/\\/g, '/');
    if (normalizedPath.includes('/loot_tables/') || normalizedPath.startsWith('loot_tables/')) {
      const visitLoot = (value: any): void => {
        if (Array.isArray(value)) { value.forEach(visitLoot); return; }
        if (!value || typeof value !== 'object') return;
        if (value.type === 'item' && isCustomIdentifier(value.name) && !itemIds.has(value.name) && !blockIds.has(value.name)) {
          add('MISSING_LOOT_ITEM_REFERENCE', entry.path,
            `Loot table references "${value.name}", but no matching custom item exists in any generated behavior output.`);
        }
        Object.values(value).forEach(visitLoot);
      };
      visitLoot(entry.data);
    }
  }

  for (const entry of resourceEntries) {
    const clientEntityId = entry.data?.['minecraft:client_entity']?.description?.identifier;
    if (isCustomIdentifier(clientEntityId) && !entityIds.has(clientEntityId)) {
      add('ORPHAN_CLIENT_ENTITY_DEFINITION', entry.path,
        `Resource client entity "${clientEntityId}" has no matching behavior minecraft:entity definition in any generated behavior output.`);
    }
  }

  for (const entry of resourceEntries) {
    if (entry.path.toLowerCase().replace(/\\/g, '/') !== 'blocks.json') continue;
    for (const [blockId, definition] of Object.entries(entry.data || {})) {
      if (!blockId.includes(':') || blockId.startsWith('minecraft:')) continue;
      const visit = (value: any, key = ''): void => {
        if (typeof value === 'string' &&
            ['textures', 'carried_textures', 'up', 'down', 'side', 'north', 'south', 'east', 'west'].includes(key) &&
            isCustomIdentifier(value) && !terrainAliases.has(value)) {
          add('MISSING_BLOCK_TEXTURE_ALIAS', entry.path,
            `Block mapping "${blockId}" references terrain alias "${value}", but it is absent from the merged terrain_texture.json.`);
        } else if (Array.isArray(value)) value.forEach(child => visit(child, key));
        else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
      };
      visit(definition);
    }
  }

  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = issue.code + '|' + issue.path + '|' + issue.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
