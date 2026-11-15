// Ported from AutoBE.py IdentifierManager (Part 1/19) — scan_pack_identifiers.
// Detects identifier collisions across packs so BP/RP references never break.
// Desktop-specific code removed. Pure zip-based logic.

import JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';

export type IdentifierType =
  | 'entities'
  | 'items'
  | 'blocks'
  | 'loot_tables'
  | 'recipes'
  | 'animation_controllers'
  | 'render_controllers'
  | 'textures';

export type PackIdentifiers = Record<IdentifierType, Set<string>>;

export function newIdentifierMap(): PackIdentifiers {
  return {
    entities: new Set(),
    items: new Set(),
    blocks: new Set(),
    loot_tables: new Set(),
    recipes: new Set(),
    animation_controllers: new Set(),
    render_controllers: new Set(),
    textures: new Set()
  };
}

function collectIdentifiers(obj: any, out: Set<string>): void {
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'identifier' && typeof v === 'string' && v.includes(':')) out.add(v);
      else walk(v);
    }
  };
  walk(obj);
}

async function readJson(zip: JSZip, path: string): Promise<any | null> {
  try {
    const file = zip.file(path);
    if (!file) return null;
    return JSON.parse(sanitizeJsonString(await file.async('text')));
  } catch {
    return null;
  }
}

/**
 * Scan a pack zip for all identifiers (entities, items, blocks, loot tables,
 * recipes, animation controllers, render controllers, textures).
 */
export async function scanPackIdentifiers(packZip: JSZip, packPath: string): Promise<PackIdentifiers> {
  const ids = newIdentifierMap();
  try {
    for (const path of Object.keys(packZip.files)) {
      const lower = path.toLowerCase();
      if (lower.startsWith('subpacks/') || !lower.endsWith('.json')) continue;

      if (lower.startsWith('entities/')) {
        const json = await readJson(packZip, path);
        if (json) collectIdentifiers(json, ids.entities);
      } else if (lower.startsWith('items/')) {
        const json = await readJson(packZip, path);
        if (json) collectIdentifiers(json, ids.items);
      } else if (lower.startsWith('blocks/')) {
        const json = await readJson(packZip, path);
        if (json) collectIdentifiers(json, ids.blocks);
      } else if (lower.startsWith('loot_tables/')) {
        const id = lower.slice('loot_tables/'.length).replace(/\.json$/, '');
        if (id) ids.loot_tables.add(id);
      } else if (lower.startsWith('recipes/')) {
        const json = await readJson(packZip, path);
        if (json) collectIdentifiers(json, ids.recipes);
      } else if (lower.includes('animation_controllers')) {
        const json = await readJson(packZip, path);
        if (json) collectIdentifiers(json, ids.animation_controllers);
      } else if (lower.includes('render_controllers')) {
        const json = await readJson(packZip, path);
        if (json) collectIdentifiers(json, ids.render_controllers);
      } else if (lower === 'textures/item_texture.json' || lower === 'textures/terrain_texture.json') {
        const json = await readJson(packZip, path);
        if (json && typeof json.texture_data === 'object') {
          for (const key of Object.keys(json.texture_data)) ids.textures.add(key);
        }
      }
    }
  } catch (e) {
    console.warn(`[Aippy] Error scanning identifiers in ${packPath}: ${String(e)}`);
  }
  return ids;
}

/** Detect identifiers claimed by two or more packs (collision report). */
export function findIdentifierConflicts(
  perPack: Array<{ packId: string; packName: string; ids: PackIdentifiers }>
): Array<{ type: IdentifierType; identifier: string; packNames: string[] }> {
  const ownerMap = new Map<string, string[]>();
  for (const pack of perPack) {
    for (const type of Object.keys(pack.ids) as IdentifierType[]) {
      for (const id of pack.ids[type]) {
        const key = `${type}::${id}`;
        const owners = ownerMap.get(key) ?? [];
        owners.push(pack.packName);
        ownerMap.set(key, owners);
      }
    }
  }
  const conflicts: Array<{ type: IdentifierType; identifier: string; packNames: string[] }> = [];
  for (const [key, packNames] of ownerMap.entries()) {
    if (packNames.length > 1) {
      const [type, identifier] = key.split('::') as [IdentifierType, string];
      conflicts.push({ type, identifier, packNames: [...new Set(packNames)] });
    }
  }
  return conflicts;
}