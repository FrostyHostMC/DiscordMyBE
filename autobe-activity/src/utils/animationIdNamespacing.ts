import type JSZip from 'jszip';
import { sanitizeJsonString } from './addonParser';

export interface AnimationIdRepair {
  pack: string;
  file: string;
  originalId: string;
  renamedId: string;
}

interface DefinitionRecord {
  signature: string;
  owner: string;
}

function packToken(name: string): string {
  const token = (name || 'pack').toLowerCase().replace(/\.(mcpack|mcaddon)$/i, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14);
  return token || 'pack';
}

function renamedId(original: string, token: string, attempt: number): string {
  const suffix = attempt > 1 ? `_${attempt}` : '';
  const parts = original.match(/^([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\.)(.+)$/);
  if (parts) return `${parts[1]}autobe_${token}_${parts[2]}${suffix}`;
  const namespace = original.match(/^([^:]+):(.+)$/);
  if (namespace) return `${namespace[1]}:autobe_${token}_${namespace[2]}${suffix}`;
  return `autobe_${token}_${original}${suffix}`;
}

function visitAndRename(value: any, renames: Map<string, string>): any {
  if (typeof value === 'string') return renames.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => visitAndRename(item, renames));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    result[renames.get(key) ?? key] = visitAndRename(child, renames);
  }
  return result;
}


export interface PlayerAliasRepair {
  pack: string;
  file: string;
  originalAlias: string;
  renamedAlias: string;
}

interface PlayerAliasRecord {
  signature: string;
  owner: string;
}

function playerEntityDescriptions(value: any): any[] {
  const descriptions: any[] = [];
  if (!value || typeof value !== 'object') return descriptions;
  for (const key of ['minecraft:client_entity', 'minecraft:entity']) {
    const entity = value[key];
    if (entity?.description?.identifier === 'minecraft:player') descriptions.push(entity.description);
  }
  return descriptions;
}

/**
 * Player entity aliases (e.g. "idle", "custom_attack") are a separate namespace
 * from animation definition IDs. Two packs can have unique animation IDs but
 * still silently lose one animation when both use the same alias key in
 * entity/player.entity.json. Rename only conflicting aliases in the incoming
 * pack and update that pack's scripts.animate references before JSON merging.
 */
export async function namespaceConflictingPlayerAliases(
  zip: JSZip,
  packId: string,
  packName: string,
  seen: Map<string, PlayerAliasRecord>,
): Promise<PlayerAliasRepair[]> {
  const files = new Map<string, any>();
  const repairs: PlayerAliasRepair[] = [];
  const jobs: Promise<void>[] = [];
  zip.forEach((path, file) => {
    if (file.dir || !path.toLowerCase().endsWith('.json')) return;
    jobs.push(file.async('text').then(text => {
      const parsed = JSON.parse(sanitizeJsonString(text));
      files.set(path, parsed);
    }).catch(() => undefined));
  });
  await Promise.all(jobs);

  const aliasesInPack = new Map<string, { signature: string; file: string }>();
  for (const [path, data] of files) {
    for (const description of playerEntityDescriptions(data)) {
      const animations = description.animations && typeof description.animations === 'object' && !Array.isArray(description.animations)
        ? description.animations as Record<string, any> : {};
      const controllers = description.animation_controllers && typeof description.animation_controllers === 'object' && !Array.isArray(description.animation_controllers)
        ? description.animation_controllers as Record<string, any> : {};
      const aliases = new Set([...Object.keys(animations), ...Object.keys(controllers)]);
      for (const alias of aliases) {
        const signature = JSON.stringify({
          animation: Object.prototype.hasOwnProperty.call(animations, alias) ? animations[alias] : null,
          controller: Object.prototype.hasOwnProperty.call(controllers, alias) ? controllers[alias] : null,
        });
        if (!aliasesInPack.has(alias)) aliasesInPack.set(alias, { signature, file: path });
      }
    }
  }

  const renames = new Map<string, string>();
  const reserved = new Set([...seen.keys(), ...aliasesInPack.keys()]);
  const token = packToken(packName);
  for (const [alias, record] of aliasesInPack) {
    const previous = seen.get(alias);
    if (!previous || previous.owner === packId || previous.signature === record.signature) continue;
    const safeAlias = alias.replace(/[^a-zA-Z0-9_.-]+/g, '_');
    let attempt = 1;
    let candidate = `autobe_${token}_${safeAlias}`;
    while (reserved.has(candidate)) {
      attempt++;
      candidate = `autobe_${token}_${safeAlias}_${attempt}`;
    }
    renames.set(alias, candidate);
    reserved.add(candidate);
    repairs.push({ pack: packName, file: record.file, originalAlias: alias, renamedAlias: candidate });
  }

  if (renames.size > 0) {
    for (const [path, data] of files) {
      let changed = false;
      for (const description of playerEntityDescriptions(data)) {
        for (const collectionName of ['animations', 'animation_controllers']) {
          const collection = description[collectionName];
          if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
          for (const [oldAlias, newAlias] of renames) {
            if (Object.prototype.hasOwnProperty.call(collection, oldAlias)) {
              collection[newAlias] = collection[oldAlias];
              delete collection[oldAlias];
              changed = true;
            }
          }
        }
        const animate = description.scripts?.animate;
        if (Array.isArray(animate)) {
          description.scripts.animate = animate.map((item: any) => {
            if (typeof item === 'string' && renames.has(item)) {
              changed = true;
              return renames.get(item);
            }
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const rewritten: Record<string, any> = {};
              for (const [key, value] of Object.entries(item)) {
                const nextKey = renames.get(key) ?? key;
                if (nextKey !== key) changed = true;
                rewritten[nextKey] = value;
              }
              return rewritten;
            }
            return item;
          });
        }
      }
      if (changed) zip.file(path, JSON.stringify(data, null, 2));
    }
  }

  // Record the post-repair aliases. Preserve the first identical definition;
  // renamed aliases are new unique keys and therefore never overwrite another pack.
  for (const [path, data] of files) {
    for (const description of playerEntityDescriptions(data)) {
      const animations = description.animations && typeof description.animations === 'object' && !Array.isArray(description.animations)
        ? description.animations as Record<string, any> : {};
      const controllers = description.animation_controllers && typeof description.animation_controllers === 'object' && !Array.isArray(description.animation_controllers)
        ? description.animation_controllers as Record<string, any> : {};
      for (const alias of new Set([...Object.keys(animations), ...Object.keys(controllers)])) {
        const signature = JSON.stringify({
          animation: Object.prototype.hasOwnProperty.call(animations, alias) ? animations[alias] : null,
          controller: Object.prototype.hasOwnProperty.call(controllers, alias) ? controllers[alias] : null,
        });
        if (!seen.has(alias) || seen.get(alias)?.owner === packId) seen.set(alias, { signature, owner: packId });
      }
    }
  }
  return repairs;
}

/**
 * Namespace only genuinely conflicting animation/controller definitions in the
 * in-memory copy of a resource pack. Every exact reference in that same pack is
 * updated together; original addon archives remain untouched.
 */
export async function namespaceConflictingAnimationIds(
  zip: JSZip,
  packId: string,
  packName: string,
  seen: Map<string, DefinitionRecord>,
): Promise<AnimationIdRepair[]> {
  const parsedFiles = new Map<string, any>();
  const definitions: Array<{ path: string; kind: 'animation' | 'controller'; id: string; value: any }> = [];
  const repairs: AnimationIdRepair[] = [];

  const jobs: Promise<void>[] = [];
  zip.forEach((path, file) => {
    if (file.dir || !path.toLowerCase().endsWith('.json')) return;
    const lower = path.toLowerCase();
    // Parse all JSON files so renamed IDs are rewritten in attachables, item
    // definitions, and any other consumers—not only the definition files.
    jobs.push(file.async('text').then(text => {
      const parsed = JSON.parse(sanitizeJsonString(text));
      parsedFiles.set(path, parsed);
      if (parsed.animations && typeof parsed.animations === 'object' && !Array.isArray(parsed.animations) && !lower.includes('animation_controllers')) {
        for (const [id, value] of Object.entries(parsed.animations)) definitions.push({ path, kind: 'animation', id, value });
      }
      if (parsed.animation_controllers && typeof parsed.animation_controllers === 'object' && !Array.isArray(parsed.animation_controllers)) {
        for (const [id, value] of Object.entries(parsed.animation_controllers)) definitions.push({ path, kind: 'controller', id, value });
      }
    }).catch(() => undefined));
  });
  await Promise.all(jobs);

  const renames = new Map<string, string>();
  const token = packToken(packName);
  const reserved = new Set(seen.keys());
  for (const def of definitions) {
    const signature = JSON.stringify(def.value);
    const previous = seen.get(def.id);
    if (!previous || previous.owner === packId || previous.signature === signature || renames.has(def.id)) continue;
    let attempt = 1;
    let candidate = renamedId(def.id, token, attempt);
    while (reserved.has(candidate) || definitions.some(other => other.id === candidate)) {
      attempt++;
      candidate = renamedId(def.id, token, attempt);
    }
    renames.set(def.id, candidate);
    reserved.add(candidate);
    repairs.push({ pack: packName, file: def.path, originalId: def.id, renamedId: candidate });
  }

  // A controller whose definition was identical before a referenced animation
  // was renamed is no longer identical afterward. Namespace it too so the two
  // packs retain independent controller logic instead of last-wins replacement.
  for (const def of definitions) {
    if (def.kind !== 'controller' || renames.has(def.id)) continue;
    const referencesRenamedId = [...renames.keys()].some(id => JSON.stringify(def.value).includes(JSON.stringify(id)));
    const previous = seen.get(def.id);
    if (!referencesRenamedId || !previous || previous.owner === packId) continue;
    let attempt = 1;
    let candidate = renamedId(def.id, token, attempt);
    while (reserved.has(candidate) || definitions.some(other => other.id === candidate)) {
      attempt++;
      candidate = renamedId(def.id, token, attempt);
    }
    renames.set(def.id, candidate);
    reserved.add(candidate);
    repairs.push({ pack: packName, file: def.path, originalId: def.id, renamedId: candidate });
  }

  if (renames.size > 0) {
    for (const [path, data] of parsedFiles) {
      const rewritten = visitAndRename(data, renames);
      zip.file(path, JSON.stringify(rewritten, null, 2));
      parsedFiles.set(path, rewritten);
    }
  }

  for (const def of definitions) {
    const id = renames.get(def.id) ?? def.id;
    const value = parsedFiles.get(def.path);
    const collection = def.kind === 'animation' ? value?.animations : value?.animation_controllers;
    if (!collection || !(id in collection)) continue;
    const signature = JSON.stringify(collection[id]);
    if (!seen.has(id) || seen.get(id)?.owner === packId) seen.set(id, { signature, owner: packId });
  }
  return repairs;
}
