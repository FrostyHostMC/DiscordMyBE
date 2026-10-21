import JSZip from 'jszip';
import { AddonPack } from '@/types/modpack';

/**
 * Port of AutoBE Part 18 _scan_script_runtime_conflicts: scan every JS script
 * in every selected pack for direct runtime entity/world property writes.
 * Only entries hit by 2+ different packs are genuine conflicts — surfaced as
 * a warning before merging (last merged pack wins).
 */

export interface ScriptConflictHit {
  packName: string;
  file: string;
  line: number;
}

/** [pattern, componentGroupIndex (null = 'entity'), propertyNameGroupIndex] */
const WRITE_PATTERNS: Array<[RegExp, number | null, number]> = [
  // entity.getComponent("minecraft:health").currentValue = ...
  [/getComponent\s*\(\s*["']([^"']+)["']\s*\)\s*\.\s*(\w+)\s*=(?!=)/gi, 1, 2],
  // entity.nameTag = ... / entity.isSneaking = ... etc.
  [/\bentity\s*\.\s*(nameTag|selectedSlot|isSneaking|isFlying|isClimbing|isGliding)\s*=(?!=)/gi, null, 1],
  [/\bplayer\s*\.\s*(nameTag|selectedSlot|isSneaking|isFlying)\s*=(?!=)/gi, null, 1],
  // entity.applyKnockback / teleport / kill / triggerEvent — can conflict
  [/\bentity\s*\.\s*(applyKnockback|teleport|kill|triggerEvent)\s*\(/gi, null, 1],
  // world/entity dynamic property writes (bare keys)
  [/\.setDynamicProperty\s*\(\s*["'`]([^"'`\s]+)/gi, null, 1]
];

export async function scanScriptRuntimeConflicts(
  packs: AddonPack[]
): Promise<Map<string, ScriptConflictHit[]>> {
  // key: "component.property"
  const results = new Map<string, ScriptConflictHit[]>();
  let processed = 0;

  for (const pack of packs) {
    if (!pack.fileBlob || !pack.hasScripts) continue;
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(pack.fileBlob);
    } catch {
      continue;
    }
    for (const [path, f] of Object.entries(zip.files)) {
      if (f.dir || !/\.js$/i.test(path)) continue;
      let text: string;
      try {
        text = await f.async('text');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let li = 0; li < lines.length; li++) {
        for (const [pattern, compGroup, propGroup] of WRITE_PATTERNS) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(lines[li])) !== null) {
            const comp = compGroup !== null && m[compGroup] ? m[compGroup] : 'entity';
            const key = `${comp}.${m[propGroup]}`;
            const bucket = results.get(key) || [];
            // Only record each pack once per (component, property)
            if (!bucket.some((h) => h.packName === pack.name)) {
              bucket.push({ packName: pack.name, file: path, line: li + 1 });
              results.set(key, bucket);
            }
          }
        }
      }
    }
    zip.files = {} as typeof zip.files;
    if (++processed % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // Keep only entries hit by 2+ different packs (actual conflicts)
  for (const [key, arr] of results) {
    const uniquePacks = new Set(arr.map((h) => h.packName));
    if (uniquePacks.size < 2) results.delete(key);
  }
  return results;
}

/** Serializable form for the merge report. */
export function conflictsToReport(
  hits: Map<string, ScriptConflictHit[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [prop, arr] of hits) {
    out[prop] = arr.map((h) => `${h.packName} (${h.file}:${h.line})`);
  }
  return out;
}