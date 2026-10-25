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
    if (!lower.includes('animation') && !lower.includes('entity')) return;
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
