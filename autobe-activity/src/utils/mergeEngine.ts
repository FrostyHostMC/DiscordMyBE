import assetsData from "@/config/assets";
import JSZip from 'jszip';
import { buildStoreZip, type StoreZipEntry } from '@/utils/storeZip';
import { AddonPack, ConflictItem, MergedModpack, MergedOutput } from '@/types/modpack';
import { generateUUID, deepMerge, mergeLangFiles, sanitizeJsonString } from './addonParser';
import { highestFullScriptVersion } from './scriptApiVersion';
import { unifyCrossGroupBps } from './crossGroupUnify';
import { mergeDefinitionsByIdentifier } from './definitionMerger';
import { mergeSubpackHudFiles } from './subpackHudMerge';
import { applyPlayerEntityPass, type PlayerEntityDiagnostic } from './playerEntityFix';
import { makePackNs, namespaceScriptDirAsync } from './scriptNamespacing';
import { mergeJsonForFile } from './smartJsonMerge';
import { namespaceConflictingAnimationIds, type AnimationIdRepair } from './animationIdNamespacing';
import { stableUUID } from '@/utils/stableUuid';
export interface MergeProgressCallback {
  (step: string, percent: number): void;
}
export interface MergePlanScriptGroup {
  major: number;
  packs: AddonPack[];
}
export interface MergePlan {
  rp: AddonPack[];
  dataBp: AddonPack[];
  scriptGroups: MergePlanScriptGroup[];
  unassigned: AddonPack[]; // scripted packs without a recognizable script API version
}

// Special JSON paths that must be deep merged when multiple packs provide them
const DEEP_MERGE_FILES = new Set(['textures/item_texture.json', 'textures/terrain_texture.json', 'blocks.json', 'sounds.json', 'sounds/sound_definitions.json', 'sounds/music_definitions.json', 'biomes_client.json', 'tick.json']);
const ARRAY_MERGE_FILES = new Set(['textures/flipbook_textures.json', 'textures/textures_list.json']);

export interface AnimationConflictFinding {
  severity: 'safe' | 'warning' | 'critical';
  kind: 'bone-overlap' | 'controller-overlap' | 'parse-warning';
  scope: 'player' | 'mob' | 'unknown';
  packs: string[];
  file: string;
  detail: string;
}

/**
 * Read-only preflight for animation/controller overlaps. It never renames bones
 * or edits source files; findings are diagnostic hints, not proof of runtime failure.
 */
export async function analyzeAnimationConflicts(packs: AddonPack[]): Promise<AnimationConflictFinding[]> {
  const findings: AnimationConflictFinding[] = [];
  const sources: Array<{ name: string; path: string; controller: string; state: string; animation: string; bones: string[]; scope: 'player' | 'mob' | 'unknown' }> = [];
  for (const pack of packs) {
    if (!pack.fileBlob) continue;
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(pack.fileBlob); }
    catch { continue; }
    const animationBones = new Map<string, string[]>();
    const referenceScopes = new Map<string, 'player' | 'mob'>();
    // A reference remains ambiguous once both entity scopes use it. Keeping
    // this state separate prevents later files from accidentally reclassifying it.
    const ambiguousReferences = new Set<string>();
    const controllers: Array<{ path: string; name: string; state: string; animations: string[] }> = [];
    const addReferenceScope = (reference: string, scope: 'player' | 'mob') => {
      if (ambiguousReferences.has(reference)) return;
      const previous = referenceScopes.get(reference);
      if (previous && previous !== scope) {
        referenceScopes.delete(reference);
        ambiguousReferences.add(reference);
      } else if (!referenceScopes.has(reference)) {
        referenceScopes.set(reference, scope);
      }
    };
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.toLowerCase().endsWith('.json')) continue;
      const lower = path.toLowerCase();
      if (!lower.includes('animation') && !lower.includes('entities/')) continue;
      try {
        const parsed = JSON.parse(sanitizeJsonString(await entry.async('text')));
        // Entity identifiers, not folder names, are the source of truth for scope.
        const entityDefs = parsed['minecraft:entity'] ? [parsed['minecraft:entity']] : [];
        for (const entityDef of entityDefs) {
          const identifier = entityDef?.description?.identifier;
          if (typeof identifier !== 'string' || !identifier.includes(':')) continue;
          const scope: 'player' | 'mob' = identifier === 'minecraft:player' ? 'player' : 'mob';
          for (const reference of Object.keys(entityDef.description?.animations || {})) addReferenceScope(reference, scope);
          for (const item of entityDef.description?.scripts?.animate || []) {
            if (typeof item === 'string') addReferenceScope(item, scope);
            else if (item && typeof item === 'object') for (const key of Object.keys(item)) addReferenceScope(key, scope);
          }
          for (const [alias, target] of Object.entries(entityDef.description?.animation_controllers || {})) {
            addReferenceScope(alias, scope);
            if (typeof target === 'string') addReferenceScope(target, scope);
          }
        }
        if (parsed.animations && typeof parsed.animations === 'object' && !lower.includes('animation_controllers')) {
          for (const [id, definition] of Object.entries(parsed.animations as Record<string, any>)) {
            const bones = Object.keys((definition as any)?.bones || {});
            animationBones.set(id, bones);
          }
        }
        if (parsed.animation_controllers && typeof parsed.animation_controllers === 'object') {
          for (const [name, controller] of Object.entries(parsed.animation_controllers as Record<string, any>)) {
            for (const [state, stateDef] of Object.entries((controller as any)?.states || {})) {
              const refs: string[] = [];
              const animations = (stateDef as any)?.animations;
              if (Array.isArray(animations)) for (const item of animations) {
                if (typeof item === 'string') refs.push(item);
                else if (item && typeof item === 'object') refs.push(...Object.keys(item));
              }
              controllers.push({ path, name, state, animations: refs });
            }
          }
        }
      } catch {
        if (lower.includes('animation_controllers') || lower.includes('animations/') || lower.includes('animation/')) {
          findings.push({ severity: 'warning', kind: 'parse-warning', scope: 'unknown', packs: [pack.name], file: path, detail: 'Animation JSON could not be parsed during preflight; it was not analyzed.' });
        }
      }
    }
    for (const c of controllers) {
      for (const animation of c.animations) {
        const scope = ambiguousReferences.has(c.name) || ambiguousReferences.has(animation)
          ? 'unknown'
          : referenceScopes.get(c.name) || referenceScopes.get(animation) || 'unknown';
        sources.push({ name: pack.name, path: c.path, controller: c.name, state: c.state, animation, bones: animationBones.get(animation) || [], scope });
      }
    }
  }

  // Same controller/state and same bone is a stronger signal than a simple
  // shared controller name. Bedrock execution order and Molang still determine runtime behavior.
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i], b = sources[j];
      if (a.name === b.name) continue;
      const sharedBones = a.bones.filter(bone => b.bones.includes(bone));
      const sameControllerState = a.controller === b.controller && a.state === b.state;
      if (sameControllerState && sharedBones.length) {
        findings.push({
          severity: 'critical', kind: 'bone-overlap', scope: a.scope === b.scope ? a.scope : 'unknown', packs: [a.name, b.name], file: b.path,
          detail: `Controller ${a.controller} state ${a.state}: animations ${a.animation} and ${b.animation} both target bone(s) ${[...new Set(sharedBones)].join(', ')}. Check conditions and load order; this is a potential conflict, not a guaranteed failure.`
        });
      } else if (sameControllerState) {
        findings.push({
          severity: 'warning', kind: 'controller-overlap', scope: a.scope === b.scope ? a.scope : 'unknown', packs: [a.name, b.name], file: b.path,
          detail: `Both packs define animations in controller ${a.controller}, state ${a.state}; inspect transition conditions and animation references.`
        });
      } else if (sharedBones.length) {
        findings.push({
          severity: 'warning', kind: 'bone-overlap', scope: a.scope === b.scope ? a.scope : 'unknown', packs: [a.name, b.name], file: b.path,
          detail: `Animations ${a.animation} and ${b.animation} both target bone(s) ${[...new Set(sharedBones)].join(', ')} in different controller/state contexts.`
        });
      }
    }
  }
  const seen = new Set<string>();
  return findings.filter(f => {
    const key = [f.severity, f.kind, ...f.packs, f.file, f.detail].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


// Per-file strategy merge files (Part 18 _merge_json special branches):
// collected as lists and merged with mergeJsonForFile at write time.
const STRATEGY_MERGE_FILES = new Set(['ui/hud_screen.json', 'ui/_ui_defs.json', 'ui/_global_variables.json', 'crafting_item_catalog.json']);

/** Every UI JSON file participates in the UI merge, not just a hardcoded shortlist. */
function isStrategyMergeFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return STRATEGY_MERGE_FILES.has(normalized) || (normalized.startsWith('ui/') && normalized.endsWith('.json'));
}

// --- Version utilities -------------------------------------------------

/** Parse "1.10.0" / "1.9.0-beta" into comparable tuple. */
export function parseVersion(v: string): {
  nums: number[];
  beta: boolean;
} {
  const clean = (v || '0.0.0').trim().replace(/^v/i, '');
  const beta = /-beta|-rc|-preview/i.test(clean);
  const nums = clean.split('-')[0].split('.').map(x => parseInt(x, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return {
    nums,
    beta
  };
}

/** Numeric compare: 1.10.0 > 1.9.0. Beta is LOWER than its own release. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va.nums[i] !== vb.nums[i]) return va.nums[i] - vb.nums[i];
  }
  if (va.beta !== vb.beta) return va.beta ? -1 : 1; // release beats beta
  return 0;
}
function highestVersion(versions: string[]): string {
  const highest = versions.reduce((acc, v) => compareVersions(v, acc) >= 0 ? v : acc, versions[0] || '0.0.0');
  return compareVersions(highest, '1.13.0') < 0 ? '1.13.0' : highest;
}

/** Major version of @minecraft/server dependency (fallback handled by caller). */
export function getScriptMajor(pack: AddonPack): number | null {
  if (!pack.hasScripts) return null;
  const versionText = pack.scriptVersion?.match(/\d+(?:\.\d+){0,3}(?:-[\w.-]+)?/)?.[0] || pack.scriptVersion || '';
  const v = parseVersion(versionText);
  if (!versionText || v.nums[0] <= 0) return null;
  return v.nums[0];
}

/** Build the Script API output plan: one RP, one data-only BP, one BP per script major. */
export function buildMergePlan(packs: AddonPack[]): MergePlan {
  const rp = packs.filter(p => p.type === 'Resource Pack');
  const bps = packs.filter(p => p.type === 'Behavior Pack');
  const dataBp: AddonPack[] = [];
  const groupMap = new Map<number, AddonPack[]>();
  const unassigned: AddonPack[] = [];
  for (const p of bps) {
    const major = getScriptMajor(p);
    if (major === null) {
      if (p.hasScripts) unassigned.push(p);else dataBp.push(p);
    } else {
      const arr = groupMap.get(major) || [];
      arr.push(p);
      groupMap.set(major, arr);
    }
  }
  const scriptGroups = [...groupMap.entries()].sort((a, b) => a[0] - b[0]).map(([major, gPacks]) => ({
    major,
    packs: gPacks
  }));

  // Scripted packs without a recognizable API version MUST still be merged —
  // group them together (major 0) instead of silently dropping them.
  if (unassigned.length > 0) {
    scriptGroups.push({
      major: 0,
      packs: unassigned
    });
  }
  return {
    rp,
    dataBp,
    scriptGroups,
    unassigned: []
  };
}
export function formatPlanSummary(plan: MergePlan): string {
  const parts: string[] = [];
  if (plan.rp.length > 0) parts.push(`Resource pack: ${plan.rp.length} packs`);
  if (plan.dataBp.length > 0) parts.push(`BP data-only: ${plan.dataBp.length} packs`);
  for (const g of plan.scriptGroups) parts.push(g.major > 0 ? `BP v${g.major}: ${g.packs.length} packs` : `BP scripts: ${g.packs.length} packs`);
  return parts.join(' · ') || 'No packs selected';
}

// --- Zip merge helpers -------------------------------------------------

interface MergeAccum {
  jsonFiles: Map<string, any>;
  jsonLists: Map<string, any[]>;
  langFiles: Map<string, string>;
  binaryPaths: Array<{
    path: string;
    data: Uint8Array;
  }>;
  textPaths: Array<{
    path: string;
    data: string;
  }>;
  writtenBinaryPaths: Set<string>;
  fileOwners: Map<string, string>;
  fileCollisions: Array<{
    path: string;
    firstPack: string;
    laterPack: string;
    handling: 'merged' | 'last_wins' | 'first_wins';
  }>;
}
function newAccum(): MergeAccum {
  return {
    jsonFiles: new Map(),
    jsonLists: new Map(),
    langFiles: new Map(),
    binaryPaths: [],
    textPaths: [],
    writtenBinaryPaths: new Set(),
    fileOwners: new Map(),
    fileCollisions: []
  };
}
function writeBinaryIfFirst(targetZip: JSZip, accum: MergeAccum, path: string, data: Uint8Array): void {
  if (accum.writtenBinaryPaths.has(path)) return;
  targetZip.file(path, data);
  accum.writtenBinaryPaths.add(path);
}

/**
 * Yield to the UI thread so the browser can paint, respond to input, and run
 * garbage collection. Without this, merging hundreds of packs blocks the main
 * thread long enough for mobile browsers to flag the page as unresponsive and
 * reload it.
 */
const yieldToUI = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
async function accumulatePack(zip: JSZip, targetZip: JSZip, accum: MergeAccum, renameMap: Map<string, string> | undefined, sourcePackKey: string, sourcePackName: string, pathTransform?: (p: string) => string, onPackFile?: () => Promise<void>): Promise<void> {
  let batchCount = 0;
  for (const [path, fileObj] of Object.entries(zip.files)) {
    const lower = path.toLowerCase();
    if (fileObj.dir) continue;
    // Skip every manifest (root AND nested copies from subfolders) and macOS junk.
    const base = lower.substring(lower.lastIndexOf('/') + 1);
    if (base === 'manifest.json' || lower.includes('__macosx')) continue;
    // Safety net: subpack variant folders must never leak into the merged output.
    // The user-selected variant is extracted to the archive root beforehand
    // (applySubpackSelection), so anything left under subpacks/ is an unselected
    // variant and is excluded to avoid duplicate/merged variant content.
    if (lower.startsWith('subpacks/')) continue;
    const outPath = pathTransform ? pathTransform(path) : path;
    const collisionKey = outPath.replace(/\\/g, '/').toLowerCase();
    const previousOwner = accum.fileOwners.get(collisionKey);
    const previousOwnerName = previousOwner ? previousOwner.split('::')[1] ?? previousOwner : undefined;
    if (previousOwner && previousOwner.split('::')[0] !== sourcePackKey) {
      const handling: 'merged' | 'last_wins' | 'first_wins' =
        ARRAY_MERGE_FILES.has(lower) ||
        isStrategyMergeFile(lower) ||
        DEEP_MERGE_FILES.has(lower) ||
        lower.endsWith('.lang')
          ? 'merged'
          : !lower.endsWith('.json') && !lower.endsWith('.mcfunction') && !lower.endsWith('.js')
            ? 'first_wins'
            : 'last_wins';
      accum.fileCollisions.push({
        path: outPath,
        firstPack: previousOwnerName ?? previousOwner,
        laterPack: sourcePackName,
        handling
      });
    } else if (!previousOwner) {
      accum.fileOwners.set(collisionKey, `${sourcePackKey}::${sourcePackName}`);
    }
    if (ARRAY_MERGE_FILES.has(lower)) {
      try {
        let text = await fileObj.async('text');
        // Filter out comment lines (AutoBE.py behavior)
        const lines = text.split('\n');
        const filtered = lines.filter(line => !line.trim().startsWith('//'));
        text = filtered.join('\n');
        
        const parsed = JSON.parse(sanitizeJsonString(text));
        if (Array.isArray(parsed)) {
          const list = accum.jsonLists.get(lower) || [];
          list.push(...parsed);
          accum.jsonLists.set(lower, list);
        } else {
          writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
        }
      } catch {
        writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
      }
    } else if (isStrategyMergeFile(lower)) {
      try {
        const txt = await fileObj.async('text');
        const parsed = JSON.parse(sanitizeJsonString(txt));
        const list = accum.jsonLists.get(lower) || [];
        list.push(parsed);
        accum.jsonLists.set(lower, list);
      } catch {
        writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
      }
    } else if (DEEP_MERGE_FILES.has(lower) || lower.includes('animation') && lower.endsWith('.json')) {
      try {
        const txt = await fileObj.async('text');
        const parsed = JSON.parse(sanitizeJsonString(txt));
        const existing = accum.jsonFiles.get(lower) || {};
        accum.jsonFiles.set(lower, deepMerge(existing, parsed));
      } catch {
        writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
      }
    } else if (lower.endsWith('.lang')) {
      try {
        const txt = await fileObj.async('text');
        const existing = accum.langFiles.get(outPath) || '';
        accum.langFiles.set(outPath, mergeLangFiles(existing, txt));
      } catch {
        const data = await fileObj.async('uint8array');
        targetZip.file(outPath, data);
      }
    } else if (renameMap && renameMap.size > 0 && (lower.endsWith('.json') || lower.endsWith('.mcfunction'))) {
      let txt = await fileObj.async('text');
      for (const [oldId, newId] of renameMap.entries()) {
        txt = txt.split(oldId).join(newId);
      }
      targetZip.file(outPath, txt);
    } else if (lower.endsWith('.json') || lower.endsWith('.mcfunction')) {
      targetZip.file(outPath, await fileObj.async('text'));
    } else if (lower.endsWith('.js')) {
      // JS files must be copied as binary to preserve UTF-8 encoding
      targetZip.file(outPath, await fileObj.async('uint8array'));
    } else {
      writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
    }
    // Regularly hand control back to the browser during large packs.
    if (++batchCount % 40 === 0) {
      if (onPackFile) await onPackFile();else await yieldToUI();
    }
  }
}
function writeAccum(zip: JSZip, accum: MergeAccum): void {
  for (const [p, list] of accum.jsonLists.entries()) {
    if (ARRAY_MERGE_FILES.has(p)) {
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const item of list) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
      zip.file(p, JSON.stringify(merged, null, 2));
    } else {
      zip.file(p, JSON.stringify(mergeJsonForFile(p, list), null, 2));
    }
  }
  for (const [p, obj] of accum.jsonFiles.entries()) {
    zip.file(p, JSON.stringify(obj, null, 2));
  }
  for (const [p, str] of accum.langFiles.entries()) {
    zip.file(p, str);
  }
  for (const t of accum.textPaths) zip.file(t.path, t.data);
  for (const b of accum.binaryPaths) zip.file(b.path, b.data);
}
function buildRenameMaps(conflicts: ConflictItem[], autoPrefix: boolean): Map<string, Map<string, string>> {
  const renameMaps = new Map<string, Map<string, string>>();
  for (const c of conflicts) {
    if (c.resolution === 'prefix_all' || autoPrefix && c.resolution !== 'keep_a' && c.resolution !== 'keep_b') {
      const prefix = c.packB.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 10);
      let map = renameMaps.get(c.packB.id);
      if (!map) {
        map = new Map();
        renameMaps.set(c.packB.id, map);
      }
      const parts = c.identifier.split(':');
      const newIdent = parts.length > 1 ? `${parts[0]}_${prefix}:${parts[1]}` : `${prefix}_${c.identifier}`;
      map.set(c.identifier, newIdent);
    }
  }
  return renameMaps;
}
function slugify(name: string, id: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return base || id.replace(/-/g, '').slice(0, 8);
}
async function findFirstPackIcon(packs: AddonPack[]): Promise<Uint8Array | undefined> {
  for (const pack of packs) {
    if (!pack.fileBlob) continue;
    try {
      const zip = await JSZip.loadAsync(pack.fileBlob);
      const iconPath = Object.keys(zip.files).find(path => !zip.files[path].dir && /^pack_icon\.(png|jpg|jpeg)$/i.test(path.split('/').pop() || ''));
      const iconEntry = iconPath ? zip.file(iconPath) : undefined;
      if (iconEntry) return await iconEntry.async('uint8array');
    } catch {
      // Keep looking; an unavailable icon should not stop a merge.
    }
  }
  return undefined;
}

// --- Main merge --------------------------------------------------------

export async function executeMergePacks(packs: AddonPack[], options: {
  modpackName: string;
  description?: string;
  version?: string;
  conflicts?: ConflictItem[];
  autoPrefix?: boolean;
  onProgress?: MergeProgressCallback;
  /** Runtime script property conflicts (property -> pack hits), from scanScriptRuntimeConflicts. */
  scriptConflicts?: Record<string, string[]>;
  /** Applied subpack variants: which variant was baked into which source pack. */
  subpackSelections?: Array<{
    pack: string;
    variant: string;
  }>;
}): Promise<MergedModpack> {
  const {
    modpackName,
    description,
    version = '1.0.0',
    conflicts = [],
    autoPrefix = true,
    onProgress,
    scriptConflicts,
    subpackSelections
  } = options;
  onProgress?.('Reading addons', 10);
  const plan = buildMergePlan(packs);
  const renameMaps = buildRenameMaps(conflicts, autoPrefix);
  const versionNums = version.split('.').map(x => parseInt(x, 10) || 0) as [number, number, number];
  const iconBytes = await findFirstPackIcon(packs);
  // Every merge gets a new identity namespace. Deterministic IDs based only on the
  // modpack name/source UUIDs caused re-merges to reuse the exact same Bedrock pack
  // identities, so Minecraft could treat a new export as the previously imported pack.
  // Keep IDs deterministic *within this merge* so BP dependencies can point at this
  // merge's RP header, but never reuse identities across separate merge operations.
  const mergeIdentity = generateUUID();
  const stablePackId = (role: string, members: AddonPack[]) =>
    stableUUID([mergeIdentity, modpackName, role, ...members.map(pack => pack.uuid).sort()].join('|'));
  const outputs: MergedOutput[] = [];
  const playerEntityDiagnostics: PlayerEntityDiagnostic[] = [];
  const animationIdRepairs: AnimationIdRepair[] = [];
  const fileCollisions: Array<{
    output: string;
    path: string;
    firstPack: string;
    laterPack: string;
    handling: 'merged' | 'last_wins' | 'first_wins';
  }> = [];
  let rpHeaderUUID: string | null = null;
  const builtBps: Array<{
    zip: JSZip;
    label: string;
    fileName: string;
    type: 'behavior_data' | 'behavior_script';
    scriptMajor?: number;
    packCount: number;
    achievementsDisabled: boolean;
  }> = [];

  // --- Resource Pack (always one output if any RP selected) ---
  if (plan.rp.length > 0) {
    const rpZip = new JSZip();
    rpHeaderUUID = stablePackId('resource-header', plan.rp);
    const rpModuleUUID = stablePackId('resource-module', plan.rp);
    const accum = newAccum();
    const seenAnimationIds = new Map<string, { signature: string; owner: string }>();
    if (iconBytes) {
      rpZip.file(assetsData.IMAGE_FFEH, iconBytes);
      accum.writtenBinaryPaths.add(assetsData.IMAGE_FFEH);
    }
    for (let i = 0; i < plan.rp.length; i++) {
      const pack = plan.rp[i];
      if (!pack.fileBlob) continue;
      onProgress?.(`Merging resource pack ${i + 1}/${plan.rp.length}`, 10 + 20 * ((i + 1) / plan.rp.length));
      await yieldToUI();
      const zip = await JSZip.loadAsync(pack.fileBlob);
      animationIdRepairs.push(...await namespaceConflictingAnimationIds(zip, pack.id, pack.name, seenAnimationIds));
      await accumulatePack(zip, rpZip, accum, renameMaps.get(pack.id), pack.id, pack.name);
      // Release the loaded archive so its memory can be reclaimed now.
      zip.files = {} as typeof zip.files;
    }
    fileCollisions.push(...accum.fileCollisions.map(c => ({ output: 'Resource Pack', ...c })));
    writeAccum(rpZip, accum);
    // Port of AutoBE Part 16 RP passes: identifier-based definition merging,
    // subpack HUD merging, and player-entity repair / variable injection.
    await mergeDefinitionsByIdentifier(rpZip);
    await mergeSubpackHudFiles(rpZip);
    playerEntityDiagnostics.push(...await applyPlayerEntityPass(rpZip));
    const minEngine = highestVersion(plan.rp.map(p => p.minEngineVersion || '1.20.0'));
    
    // Collect capabilities from all source packs
    const allCapabilities = new Set<string>();
    for (const pack of plan.rp) {
      try {
        const zip = await JSZip.loadAsync(pack.fileBlob);
        const manifestFile = zip.file('manifest.json') || zip.file(/manifest\.json$/i)[0];
        if (manifestFile) {
          const manifest = JSON.parse(sanitizeJsonString(await manifestFile.async('text')));
          if (manifest.capabilities && Array.isArray(manifest.capabilities)) {
            manifest.capabilities.forEach((cap: string) => allCapabilities.add(cap));
          }
        }
      } catch {
        // Ignore manifest read errors
      }
    }
    
    const rpManifest: any = {
      format_version: 2,
      header: {
        name: `${modpackName} [RP]`,
        description: description || `Merged with AutoBE by StoneByte (${plan.rp.length} resource packs combined)`,
        uuid: rpHeaderUUID,
        version: versionNums,
        min_engine_version: parseVersion(minEngine).nums
      },
      modules: [{
        type: 'resources',
        uuid: rpModuleUUID,
        version: [1, 0, 0]
      }]
    };
    // Add capabilities if any source pack has them
    if (allCapabilities.size > 0) {
      rpManifest.capabilities = Array.from(allCapabilities);
    }
    rpZip.file('manifest.json', JSON.stringify(rpManifest, null, 2));
    const blobData = await rpZip.generateAsync({
      type: 'uint8array'
    });
    outputs.push({
      id: generateUUID(),
      label: 'Resource Pack',
      fileName: 'resource_pack.mcpack',
      type: 'resource',
      packCount: plan.rp.length,
      size: blobData.byteLength,
      achievementsDisabled: plan.rp.some(p => p.hasExperimental),
      blob: new Blob([new Uint8Array(blobData).buffer as ArrayBuffer])
    });
  }

  // --- Behavior Pack (Data-only) ---
  const buildBehaviorPack = async (groupPacks: AddonPack[], type: 'behavior_data' | 'behavior_script', major: number | undefined): Promise<void> => {
    onProgress?.(type === 'behavior_data' ? 'Processing behavior packs' : `Splitting by script API version (v${major})`, type === 'behavior_data' ? 45 : 55);
    const bpZip = new JSZip();
    const headerUUID = stablePackId(`${type}-${major ?? 'data'}-header`, groupPacks);
    const dataModuleUUID = stablePackId(`${type}-${major ?? 'data'}-data-module`, groupPacks);
    const scriptModuleUUID = stablePackId(`${type}-${major ?? 'data'}-script-module`, groupPacks);
    const accum = newAccum();
    if (iconBytes) {
      bpZip.file(assetsData.IMAGE_FFEH, iconBytes);
      accum.writtenBinaryPaths.add(assetsData.IMAGE_FFEH);
    }
    const slugMap: Array<{
      slug: string;
      entry: string | null;
    }> = [];
    for (let pi = 0; pi < groupPacks.length; pi++) {
      const pack = groupPacks[pi];
      if (!pack.fileBlob) continue;
      onProgress?.(`Merging behavior pack ${pi + 1}/${groupPacks.length}`, type === 'behavior_data' ? 40 + 20 * ((pi + 1) / groupPacks.length) : 50 + 15 * ((pi + 1) / groupPacks.length));
      await yieldToUI();
      const zip = await JSZip.loadAsync(pack.fileBlob);
      const slug = slugify(pack.name, pack.id);
      const isScriptGroup = type === 'behavior_script';

      // Find the script entry declared in the pack manifest
      let entry: string | null = null;
      if (isScriptGroup) {
        try {
          const manifestFile = zip.file('manifest.json') || zip.file(/manifest\.json$/i)[0];
          if (manifestFile) {
            const content = await manifestFile.async('text');
            const manifest = JSON.parse(sanitizeJsonString(content));
            const scriptModule = (manifest.modules || []).find((m: any) => m.type === 'script');
            if (scriptModule?.entry) entry = String(scriptModule.entry).replace(/^\.\//, '');
          }
        } catch {
          entry = null;
        }
        if (!entry) entry = 'scripts/main.js';
      }
      await accumulatePack(zip, bpZip, accum, renameMaps.get(pack.id), pack.id, pack.name, isScriptGroup ? p => p.toLowerCase().startsWith('scripts/') ? `scripts/${slug}/${p.slice('scripts/'.length)}` : p : undefined);
      // Release the loaded archive so its memory can be reclaimed now.
      zip.files = {} as typeof zip.files;
      if (isScriptGroup) {
        // Port of AutoBE Part 18 _namespace_script_properties: prefix every
        // bare dynamic-property key and scoreboard objective name with a
        // per-pack namespace token so merged scripts cannot collide.
        await namespaceScriptDirAsync(bpZip, `scripts/${slug}`, makePackNs(pack.name));
        // Ensure the entry file lands under the slug folder even if missing
        const entryPath = entry.startsWith('scripts/') ? `scripts/${slug}/${entry.slice('scripts/'.length)}` : `scripts/${slug}/${entry}`;
        if (!bpZip.file(entryPath)) {
          bpZip.file(entryPath, '// (empty entry)\n');
        }
        slugMap.push({
          slug,
          entry: entryPath
        });
      }
    }
    fileCollisions.push(...accum.fileCollisions.map(c => ({ output: type === 'behavior_data' ? 'Behavior (Data)' : `Behavior (Script API v${major})`, ...c })));
    writeAccum(bpZip, accum);
    // Port of AutoBE Part 16: merge duplicate-identifier entity/item/block
    // definitions instead of letting later packs silently overwrite earlier ones.
    await mergeDefinitionsByIdentifier(bpZip);

    // Scripted BP: one entry file importing every pack's entry
    if (type === 'behavior_script') {
      const imports = slugMap.map(s => `import './${s.entry.replace(/^scripts\//, '')}';`).join('\n');
      bpZip.file('scripts/Stonebyte.js', `// AutoBE by StoneByte - combined script entry\n${imports}\n`);
    }
    const minEngine = highestVersion(groupPacks.map(p => p.minEngineVersion || '1.20.0'));
    const label = type === 'behavior_data' ? 'Behavior (Data)' : major && major > 0 ? `Behavior (Script API v${major})` : 'Behavior (Scripts)';
    const fileName = type === 'behavior_data' ? 'behavior_pack_data.mcpack' : major && major > 0 ? `behavior_pack_v${major}.mcpack` : 'behavior_pack_scripts.mcpack';

    // Dependencies: every BP depends on the shared RP
    const dependencies: any[] = [];
    if (rpHeaderUUID) dependencies.push({
      uuid: rpHeaderUUID,
      version: [1, 0, 0]
    });
    const modules: any[] = [{
      type: 'data',
      uuid: dataModuleUUID,
      version: [1, 0, 0]
    }];
    const manifest: any = {
      format_version: 2,
      header: {
        name: `AutoBE Behavior (${type === 'behavior_data' ? 'Data' : `Script API v${major}`})`,
        description: description || `Merged with AutoBE by StoneByte (${groupPacks.length} behavior packs combined)`,
        uuid: headerUUID,
        version: versionNums,
        min_engine_version: parseVersion(minEngine).nums
      },
      modules,
      dependencies
    };
    if (type === 'behavior_script') {
      modules.push({
        type: 'script',
        language: 'javascript',
        uuid: scriptModuleUUID,
        version: [1, 0, 0],
        entry: 'scripts/Stonebyte.js'
      });
      manifest.capabilities = ['script_eval'];
      const cleanVersions = (versions: Array<string | undefined>) => versions.map(value => value?.match(/\d+(?:\.\d+){0,3}(?:-[\w.-]+)?/)?.[0] || (value?.toLowerCase() === 'beta' ? '2.7.0-beta' : '')).filter((value): value is string => Boolean(value));
      const serverVersion = highestFullScriptVersion(cleanVersions(groupPacks.map(pack => pack.scriptVersion))) ?? '1.0.0';
      const serverUiVersion = highestFullScriptVersion(cleanVersions(groupPacks.map(pack => pack.scriptUiVersion))) ?? '1.2.0';
      manifest.dependencies.push({
        module_name: '@minecraft/server',
        version: serverVersion
      }, {
        module_name: '@minecraft/server-ui',
        version: serverUiVersion
      });
      const gameTestVersion = highestFullScriptVersion(cleanVersions(groupPacks.map(pack => pack.gameTestVersion)));
      if (gameTestVersion) manifest.dependencies.push({
        module_name: '@minecraft/server-gametest',
        version: gameTestVersion
      });
    }
    bpZip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const achievementsDisabled = type === 'behavior_script' || groupPacks.some(p => p.hasExperimental);

    // Blob generation is deferred until cross-group unification has run.
    builtBps.push({
      zip: bpZip,
      label,
      fileName,
      type,
      scriptMajor: major,
      packCount: groupPacks.length,
      achievementsDisabled
    });
  };
  if (plan.dataBp.length > 0) {
    await buildBehaviorPack(plan.dataBp, 'behavior_data', undefined);
  }
  for (const g of plan.scriptGroups) {
    await buildBehaviorPack(g.packs, 'behavior_script', g.major);
  }

  // Port of AutoBE._unify_cross_group_*: when several script-version outputs
  // exist, union their items/entities/loot tables/blocks, functions, scripts
  // (and player.json) so every group can reference content defined in any
  // other group.
  if (builtBps.length > 1) {
    onProgress?.('Unifying cross-group content', 62);
    await yieldToUI();
    await unifyCrossGroupBps(builtBps.map(b => b.zip));
  }
  for (const b of builtBps) {
    const blobData = await b.zip.generateAsync({
      type: 'uint8array'
    });
    // Release this pack's in-memory zip as soon as its bytes are generated (lowers peak memory
    // on phones, where the webview is killed if memory gets too high).
    (b as { zip: unknown }).zip = null;
    outputs.push({
      id: generateUUID(),
      label: b.label,
      fileName: b.fileName,
      type: b.type,
      scriptMajor: b.scriptMajor,
      packCount: b.packCount,
      size: blobData.byteLength,
      achievementsDisabled: b.achievementsDisabled,
      blob: new Blob([Uint8Array.from(blobData).buffer])
    });
  }

  // --- Package everything into one .mcaddon ---
  onProgress?.('Resolving conflicts', 70);
  const mergeMeta = {
    tool: 'AutoBE Mobile Modpack Tool by StoneByte',
    mergedAt: new Date().toISOString(),
    mergeId: mergeIdentity,
    modpackName,
    version,
    plan: formatPlanSummary(plan),
    sourcePacks: packs.map(p => ({
      name: p.name,
      type: p.type,
      version: p.version,
      uuid: p.uuid,
      sourceFileName: p.sourceFileName
    }))
  };
  onProgress?.('Building final pack', 85);
  await yieldToUI();

  // Compact merge summary embedded in the final .mcaddon for post-merge debugging.
  const conflictEntries = scriptConflicts ? Object.keys(scriptConflicts) : [];
  const report = {
    tool: 'AutoBE Mobile Modpack Tool by StoneByte',
    generatedAt: new Date().toISOString(),
    mergeId: mergeIdentity,
    modpackName,
    checks: [{
      name: 'Source packs',
      status: 'ok',
      detail: `${packs.length} addon pack(s) parsed and merged`
    }, {
      name: 'Outputs',
      status: outputs.length > 0 ? 'ok' : 'warning',
      detail: outputs.map(o => o.fileName).join(', ') || 'No outputs produced — check source pack manifests'
    }, {
      name: 'Player animation references',
      status: playerEntityDiagnostics.some(d => d.severity === 'error') ? 'error' : playerEntityDiagnostics.length > 0 ? 'warning' : 'ok',
      detail: playerEntityDiagnostics.length > 0
        ? playerEntityDiagnostics.map(d => `[${d.severity.toUpperCase()} ${d.code}] ${d.message}`).join(' | ')
        : 'No missing animate aliases or uninitialized player Molang variables were detected by this preflight'
    }, {
      name: 'Animation/controller identifier repairs',
      status: animationIdRepairs.length > 0 ? 'warning' : 'ok',
      detail: animationIdRepairs.length > 0
        ? animationIdRepairs.slice(0, 30).map(r => `${r.pack}: ${r.originalId} -> ${r.renamedId} (${r.file})`).join(' | ') + (animationIdRepairs.length > 30 ? ` | +${animationIdRepairs.length - 30} more` : '')
        : 'No conflicting animation/controller identifiers required renaming'
    }, {
      name: 'Same-path file collisions',
      status: fileCollisions.length > 0 ? 'warning' : 'ok',
      detail: fileCollisions.length > 0
        ? `${fileCollisions.length} repeated file path(s): ${fileCollisions.slice(0, 20).map(c => `${c.output}: ${c.path} (${c.firstPack} -> ${c.laterPack}; ${c.handling})`).join(' | ')}${fileCollisions.length > 20 ? ` | +${fileCollisions.length - 20} more` : ''}. This is diagnostic only; no source files were renamed or removed.`
        : 'No repeated file paths were detected across source packs'
    }, {
      name: 'Identifier conflicts',
      status: conflicts.length > 0 ? 'resolved' : 'ok',
      detail: conflicts.length > 0 ? `${conflicts.length} collision(s) detected and resolved` : 'No identifier collisions detected'
    }, {
      name: 'Script runtime property conflicts',
      status: conflictEntries.length > 0 ? 'warning' : 'ok',
      detail: conflictEntries.length > 0 ? `${conflictEntries.length} shared property write(s); last pack wins` : 'No runtime property write collisions detected'
    }, {
      name: 'Subpack variants',
      status: 'ok',
      detail: subpackSelections && subpackSelections.length > 0 ? subpackSelections.map(s => `${s.pack} -> ${s.variant}`).join('; ') : 'No subpack variants selected'
    }]
  };
  const combinedExtras = {
    manifestJson: JSON.stringify(mergeMeta, null, 2),
    reportJson: JSON.stringify(report, null, 2),
  };
  onProgress?.('Finalizing...', 100);
  // NOTE: the combined .mcaddon is NOT built here any more. Building it right after the outputs
  // needed a second full copy of the modpack in memory and got the app killed on phones.
  // It is built on demand by ensureCombinedBlob() when the user downloads / publishes it.
  const totalCalculatedSize = packs.reduce((sum, p) => sum + (p.fileSize || 10_000_000), 0);
  const outputsTotal = outputs.reduce((sum, o) => sum + (o.size || 0), 0);
  const finalSize = outputsTotal > 0 ? outputsTotal : totalCalculatedSize;
  const result: MergedModpack = {
    id: mergeIdentity,
    name: modpackName,
    totalPacks: packs.length,
    size: finalSize,
    version,
    createdAt: Date.now(),
    description: description || `All-in-one Bedrock Modpack created with AutoBE. Combines ${packs.length} addons.`,
    outputs,
    combinedExtras,
    // Unique filename avoids mobile/OS handlers reusing a previous import with the same name.
    outputFileName: `${modpackName.replace(/\s+/g, '_')}_${mergeIdentity.slice(0, 8)}.mcaddon`,
    includedPacks: packs.map(p => ({
      name: p.name,
      type: p.type,
      version: p.version,
      iconDataUrl: p.iconDataUrl,
      uuid: p.uuid
    }))
  };
  return result;
}

/**
 * Returns the combined .mcaddon for a modpack, building it from the individual output
 * packs if it hasn't been built yet. Call this only when the file is actually needed.
 */
export async function ensureCombinedBlob(
  modpack: MergedModpack,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  if (modpack.outputBlob) return modpack.outputBlob;
  const entries: StoreZipEntry[] = [];
  for (const o of modpack.outputs ?? []) {
    if (o.blob) entries.push({ name: o.fileName, data: o.blob });
  }
  if (entries.length === 0) throw new Error('The merged files are no longer in memory. Please merge again.');
  if (modpack.combinedExtras) {
    entries.push({ name: '_autobe_merge_manifest.json', data: modpack.combinedExtras.manifestJson });
    entries.push({ name: '_autobe_merge_report.json', data: modpack.combinedExtras.reportJson });
  }
  // The packs are already compressed, so a "stored" zip is equivalent — and it is built from Blob
  // references with a streaming checksum, so memory stays flat even for 300+ MB modpacks.
  return buildStoreZip(entries, onProgress);
}
