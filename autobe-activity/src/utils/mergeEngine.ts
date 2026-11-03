import assetsData from "@/config/assets";
import JSZip from 'jszip';
import { buildStoreZip, type StoreZipEntry } from '@/utils/storeZip';
import { AddonPack, ConflictItem, MergedModpack, MergedOutput } from '@/types/modpack';
import { generateUUID, sanitizeJsonString } from './addonParser';
import { highestFullScriptVersion } from './scriptApiVersion';
import { unifyCrossGroupBps } from './crossGroupUnify';
import { mergeDefinitionsByIdentifier } from './definitionMerger';
import { mergeSubpackHudFiles } from './subpackHudMerge';
import { scriptModuleOutputPath } from './scriptNamespacing';
import { stableUUID } from '@/utils/stableUuid';
import { validateMergedArchive } from './mergedArchiveValidation';
import { planBinaryAssetCollisions, rewriteAssetReferences, isVanillaOverridePath, applyVanillaAssetResolutions } from './assetCollision';
import { mergeAdditions, preserveConflict, sameBytes } from './conservativeMerge';
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

// Per-file strategy merge files (Part 18 _merge_json special branches):
// collected as lists and merged with mergeJsonForFile at write time.
const STRATEGY_MERGE_FILES = new Set(['ui/hud_screen.json', 'ui/_ui_defs.json', 'ui/_global_variables.json', 'crafting_item_catalog.json']);

/** Every UI JSON file and the shared player animation/controller JSON files
 * participate in the strategy merge. Without collecting these files first,
 * accumulatePack writes them directly to the ZIP and later packs overwrite
 * earlier player animation definitions before mergeJsonForFile can run.
 */
function isStrategyMergeFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const base = normalized.substring(normalized.lastIndexOf('/') + 1);
  const isPlayerAnimationFile = new Set([
    'player.animation.json',
    'player.animation_controllers.json',
    'player.render_controllers.json'
  ]).has(base);
  return STRATEGY_MERGE_FILES.has(normalized) ||
    (normalized.startsWith('ui/') && normalized.endsWith('.json')) ||
    isPlayerAnimationFile;
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

type SharedKind = 'array' | 'strategy' | 'deep' | 'lang';
interface SharedEntry { data: Uint8Array; original: Uint8Array; source: string; }
interface MergeAccum {
  shared: Map<string, { kind: SharedKind; entries: SharedEntry[] }>;
  writtenBinaryPaths: Set<string>;
}
function newAccum(): MergeAccum {
  return { shared: new Map(), writtenBinaryPaths: new Set() };
}

/** Alternative paths are only safe for definitions which Bedrock loads by ID. */
function definitionOutputPath(targetZip: JSZip, path: string, sourceLabel: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const slug = sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'addon';
  let candidate = `${dir}${stem}__${slug}${ext}`;
  let suffix = 2;
  while (targetZip.file(candidate)) candidate = `${dir}${stem}__${slug}_${suffix++}${ext}`;
  return candidate;
}

const yieldToUI = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Replace a whole identifier only, not a longer unrelated identifier. */
function rewriteIdentifierReferences(text: string, renameMap?: Map<string, string>): string {
  let out = text;
  for (const [oldId, newId] of renameMap || []) {
    const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^A-Za-z0-9_.:-])${escaped}(?![A-Za-z0-9_.:-])`, 'g'), (_m, before) => before + newId);
  }
  return out;
}

async function accumulatePack(zip: JSZip, targetZip: JSZip, accum: MergeAccum, renameMap: Map<string, string> | undefined, pathTransform?: (p: string) => string, onPackFile?: () => Promise<void>, sourceLabel = 'addon', diagnostics: string[] = [], sourcePackId?: string, vanillaAssetWinners?: Map<string, string>): Promise<void> {
  const assetPathMap = await planBinaryAssetCollisions(zip, targetZip, sourceLabel, pathTransform, diagnostics);
  let batchCount = 0;
  for (const [path, fileObj] of Object.entries(zip.files)) {
    const lower = path.toLowerCase();
    if (fileObj.dir) continue;
    if (sourcePackId && vanillaAssetWinners && isVanillaOverridePath(path) && vanillaAssetWinners.has(path) && vanillaAssetWinners.get(path) !== sourcePackId) continue;
    const base = lower.substring(lower.lastIndexOf('/') + 1);
    if (base === 'manifest.json' || lower === 'pack_icon.png' || lower.includes('__macosx') || lower.startsWith('subpacks/')) continue;
    const transformedPath = pathTransform ? pathTransform(path) : path;
    const outPath = assetPathMap.get(path) || assetPathMap.get(transformedPath) || transformedPath;
    const original = await fileObj.async('uint8array');
    let bytes = original;
    if ((assetPathMap.size || renameMap?.size) && (lower.endsWith('.json') || lower.endsWith('.mcfunction'))) {
      const originalText = await fileObj.async('text');
      const updated = rewriteIdentifierReferences(rewriteAssetReferences(originalText, assetPathMap), renameMap);
      if (updated !== originalText) bytes = new TextEncoder().encode(updated);
    }
    const sharedKind: SharedKind | undefined = ARRAY_MERGE_FILES.has(lower) ? 'array'
      : isStrategyMergeFile(lower) ? 'strategy' : DEEP_MERGE_FILES.has(lower) ? 'deep'
      : lower.endsWith('.lang') ? 'lang' : undefined;
    if (sharedKind) {
      const group = accum.shared.get(outPath) || { kind: sharedKind, entries: [] };
      group.entries.push({ data: bytes, original, source: sourceLabel });
      accum.shared.set(outPath, group);
    } else {
      const existing = targetZip.file(outPath);
      if (!existing) targetZip.file(outPath, bytes);
      else if (!sameBytes(await existing.async('uint8array'), bytes)) {
        const definition = lower.endsWith('.json') && /^(items|entities|blocks|entity|attachables)\//.test(lower);
        let validDefinitions = definition;
        if (definition) {
          try {
            JSON.parse(sanitizeJsonString(await existing.async('text')));
            JSON.parse(sanitizeJsonString(new TextDecoder().decode(bytes)));
          } catch { validDefinitions = false; }
        }
        if (validDefinitions) {
          targetZip.file(definitionOutputPath(targetZip, outPath, sourceLabel), bytes);
        } else {
          const backup = preserveConflict(targetZip, outPath, original, sourceLabel);
          diagnostics.push(`WARNING FILE_PATH_CONFLICT [${outPath}]: Kept the first file active; the different file from ${sourceLabel} was saved as ${backup} for manual review.`);
        }
      }
    }
    if (++batchCount % 40 === 0) {
      if (onPackFile) await onPackFile(); else await yieldToUI();
    }
  }
}

function writeAccum(zip: JSZip, accum: MergeAccum, diagnostics: string[]): void {
  const decoder = new TextDecoder();
  for (const [path, group] of accum.shared) {
    const first = group.entries[0];
    let resultBytes = first.data;
    let parsed: any;
    let parsedReady = false;
    let changed = false;
    let lang = decoder.decode(first.data);
    for (const entry of group.entries.slice(1)) {
      if (sameBytes(first.data, entry.data)) continue;
      try {
        if (group.kind === 'lang') {
          const values = new Map<string, string>();
          const lines = (text: string) => text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('='));
          for (const line of lines(lang)) { const i = line.indexOf('='); values.set(line.slice(0, i).trim(), line.slice(i + 1)); }
          const additions: string[] = [];
          let conflict = false;
          for (const line of lines(decoder.decode(entry.data))) {
            const i = line.indexOf('='); const key = line.slice(0, i).trim(), value = line.slice(i + 1);
            if (values.has(key) && values.get(key) !== value) conflict = true;
            else if (!values.has(key)) { additions.push(line); values.set(key, value); }
          }
          if (conflict) throw new Error('different translation values');
          if (additions.length) { lang += `${lang.endsWith('\n') ? '' : '\n'}${additions.join('\n')}\n`; changed = true; }
        } else {
          if (!parsedReady) { parsed = JSON.parse(sanitizeJsonString(decoder.decode(first.data))); parsedReady = true; }
          const other = JSON.parse(sanitizeJsonString(decoder.decode(entry.data)));
          if (group.kind === 'array' && Array.isArray(parsed) && Array.isArray(other)) {
            const fingerprints = new Set(parsed.map((value: any) => JSON.stringify(value)));
            for (const value of other) if (!fingerprints.has(JSON.stringify(value))) { parsed.push(value); fingerprints.add(JSON.stringify(value)); changed = true; }
          } else {
            const merged = mergeAdditions(parsed, other);
            if (merged.conflicts.length) throw new Error(`different values at ${merged.conflicts.slice(0, 4).join(', ')}`);
            parsed = merged.value;
            changed ||= merged.changed;
          }
        }
      } catch (error) {
        const backup = preserveConflict(zip, path, entry.original, entry.source);
        diagnostics.push(`WARNING SHARED_FILE_CONFLICT [${path}]: Kept the first version active; ${entry.source}'s version was saved as ${backup} for manual review (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    if (changed) resultBytes = new TextEncoder().encode(group.kind === 'lang' ? lang : JSON.stringify(parsed, null, 2));
    zip.file(path, resultBytes);
  }
}
function buildRenameMaps(conflicts: ConflictItem[], autoPrefix: boolean): Map<string, Map<string, string>> {
  const renameMaps = new Map<string, Map<string, string>>();
  for (const c of conflicts) {
    if (c.type === 'vanilla_asset' || c.identifier === 'minecraft:player') continue;
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
  const mergeDiagnostics: string[] = [];
  const renameMaps = buildRenameMaps(conflicts, autoPrefix);
  const vanillaAssetWinners = new Map<string, string>();
  for (const conflict of conflicts) {
    if (conflict.type !== 'vanilla_asset') continue;
    const winner = conflict.resolution === 'keep_b' ? conflict.packB.id : conflict.packA.id;
    vanillaAssetWinners.set(conflict.identifier, winner);
  }
  const versionNums = version.split('.').map(x => parseInt(x, 10) || 0) as [number, number, number];
  const iconBytes = await findFirstPackIcon(packs);
  const stablePackId = (role: string, members: AddonPack[]) => stableUUID([modpackName, role, ...members.map(pack => pack.uuid).sort()].join('|'));
  const outputs: MergedOutput[] = [];
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
      if (plan.rp.length > 1 && Object.keys(zip.files).some(path => path.toLowerCase().endsWith('.brarchive'))) mergeDiagnostics.push(`WARNING PACKED_ARCHIVE_NOT_SCANNED [${pack.name}]: Packed .brarchive files were preserved, but their internal definitions were not checked for collisions with other add-ons.`);
      const sourceIssues = await validateMergedArchive(zip, `Source Resource Pack: ${pack.name}`);
      mergeDiagnostics.push(...sourceIssues.map(issue => `SOURCE BASELINE ${issue.severity.toUpperCase()} ${issue.code} [${pack.name}:${issue.path}]: ${issue.message}`));
      await accumulatePack(zip, rpZip, accum, renameMaps.get(pack.id), undefined, undefined, pack.name, mergeDiagnostics, pack.id, vanillaAssetWinners);
      // Release the loaded archive so its memory can be reclaimed now.
      zip.files = {} as typeof zip.files;
    }
    writeAccum(rpZip, accum, mergeDiagnostics);
    await applyVanillaAssetResolutions(rpZip, packs, conflicts, 'Resource Pack', mergeDiagnostics);
    // Merge only compatible duplicate definitions; preserve a lone player as-is.
    await mergeDefinitionsByIdentifier(rpZip, mergeDiagnostics, 'resource');
    await mergeSubpackHudFiles(rpZip);
    const rpValidationIssues = await validateMergedArchive(rpZip, 'Resource Pack');
    mergeDiagnostics.push(...rpValidationIssues.map(issue => `${issue.severity.toUpperCase()} ${issue.code} [${issue.path}]: ${issue.message}`));
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
    const scriptEntries: string[] = [];
    const sourceCapabilities = new Set<string>();
    const sourceModuleDeps = new Map<string, any>();
    const externalUuidDeps = new Map<string, any>();
    const selectedUuids = new Set(packs.map(p => p.uuid));
    const relocateScripts = type === 'behavior_script' && groupPacks.length > 1;
    for (let pi = 0; pi < groupPacks.length; pi++) {
      const pack = groupPacks[pi];
      if (!pack.fileBlob) continue;
      onProgress?.(`Merging behavior pack ${pi + 1}/${groupPacks.length}`, type === 'behavior_data' ? 40 + 20 * ((pi + 1) / groupPacks.length) : 50 + 15 * ((pi + 1) / groupPacks.length));
      await yieldToUI();
      const zip = await JSZip.loadAsync(pack.fileBlob);
      if (packs.filter(p => p.type === 'Behavior Pack').length > 1 && Object.keys(zip.files).some(path => path.toLowerCase().endsWith('.brarchive'))) mergeDiagnostics.push(`WARNING PACKED_ARCHIVE_NOT_SCANNED [${pack.name}]: Packed .brarchive files were preserved, but their internal definitions were not checked for collisions with other add-ons.`);
      const slug = `${slugify(pack.name, pack.id)}_${pi + 1}`;
      const isScriptGroup = type === 'behavior_script';

      // Preserve declared capabilities and external dependencies, and use the
      // original script entry. Do not invent API dependencies or capabilities.
      let entry: string | null = null;
      try {
        const manifestFile = zip.file('manifest.json') || zip.file(/manifest\.json$/i)[0];
        if (manifestFile) {
          const manifest = JSON.parse(sanitizeJsonString(await manifestFile.async('text')));
          for (const capability of Array.isArray(manifest.capabilities) ? manifest.capabilities : []) if (typeof capability === 'string') sourceCapabilities.add(capability);
          for (const dep of Array.isArray(manifest.dependencies) ? manifest.dependencies : []) {
            if (typeof dep?.module_name === 'string') {
              const old = sourceModuleDeps.get(dep.module_name);
              if (!old) sourceModuleDeps.set(dep.module_name, dep);
              else if (JSON.stringify(old.version) !== JSON.stringify(dep.version)) {
                const selectedVersion = typeof old.version === 'string' && typeof dep.version === 'string'
                  ? highestFullScriptVersion([old.version, dep.version]) : undefined;
                if (selectedVersion) sourceModuleDeps.set(dep.module_name, { ...old, version: selectedVersion });
                mergeDiagnostics.push(`WARNING SCRIPT_DEPENDENCY_CONFLICT [${dep.module_name}]: Source packs requested different versions; review the generated manifest.`);
              }
            } else if (typeof dep?.uuid === 'string' && !selectedUuids.has(dep.uuid)) {
              externalUuidDeps.set(dep.uuid, dep);
            }
          }
          const scriptModule = (manifest.modules || []).find((m: any) => m.type === 'script');
          if (scriptModule?.entry) entry = String(scriptModule.entry).replace(/^\.\//, '');
        }
      } catch {
        mergeDiagnostics.push(`WARNING SOURCE_MANIFEST [${pack.name}]: Could not read the original manifest; review output dependencies.`);
      }
      if (isScriptGroup && !entry) entry = 'scripts/main.js';
      const sourceIssues = await validateMergedArchive(zip, `Source Behavior Pack: ${pack.name}`);
      mergeDiagnostics.push(...sourceIssues.map(issue => `SOURCE BASELINE ${issue.severity.toUpperCase()} ${issue.code} [${pack.name}:${issue.path}]: ${issue.message}`));
      if (isScriptGroup && (!entry || !zip.file(entry))) {
        throw new Error(`Script entry ${entry || '(missing)'} was not found in ${pack.name}. The source pack was left unchanged.`);
      }
      const transform = relocateScripts
        ? (p: string) => /^(?:scripts\/)/i.test(p) || /\.(?:[cm]?js)$/i.test(p) ? scriptModuleOutputPath(slug, p) : p
        : undefined;
      await accumulatePack(zip, bpZip, accum, renameMaps.get(pack.id), transform, undefined, pack.name, mergeDiagnostics, pack.id, vanillaAssetWinners);
      zip.files = {} as typeof zip.files;
      if (isScriptGroup && entry) scriptEntries.push(relocateScripts ? scriptModuleOutputPath(slug, entry) : entry);
    }
    writeAccum(bpZip, accum, mergeDiagnostics);
    await applyVanillaAssetResolutions(bpZip, packs, conflicts, 'Behavior Pack', mergeDiagnostics);
    // Port of AutoBE Part 16: merge duplicate-identifier entity/item/block
    // definitions instead of letting later packs silently overwrite earlier ones.
    await mergeDefinitionsByIdentifier(bpZip, mergeDiagnostics, 'behavior');

    // A lone script keeps its original path and contents. Multiple scripts need
    // one entry point, so preserve their relative trees under separate folders.
    let scriptEntry = scriptEntries[0];
    if (type === 'behavior_script' && relocateScripts) {
      const imports = scriptEntries.map(entry => `import './${entry.replace(/^scripts\//, '')}';`).join('\n');
      scriptEntry = 'scripts/Stonebyte.js';
      bpZip.file(scriptEntry, `// AutoBE combined script entry\n${imports}\n`);
      mergeDiagnostics.push('INFO SCRIPT_PATHS_RELOCATED: Multiple script packs share an output; their script folders were separated while script contents were preserved. Review script references to resources outside those folders.');
    }
    const minEngine = highestVersion(groupPacks.map(p => p.minEngineVersion || '1.20.0'));
    const label = type === 'behavior_data' ? 'Behavior (Data)' : major && major > 0 ? `Behavior (Script API v${major})` : 'Behavior (Scripts)';
    const fileName = type === 'behavior_data' ? 'behavior_pack_data.mcpack' : major && major > 0 ? `behavior_pack_v${major}.mcpack` : 'behavior_pack_scripts.mcpack';

    // Dependencies: every BP depends on the shared RP
    const dependencies: any[] = [];
    if (rpHeaderUUID) dependencies.push({ uuid: rpHeaderUUID, version: versionNums });
    dependencies.push(...externalUuidDeps.values());
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
        entry: scriptEntry
      });
      if (!sourceModuleDeps.has('@minecraft/server')) {
        const versions = groupPacks.map(pack => pack.scriptVersion).filter((value): value is string => !!value);
        const fallback = highestFullScriptVersion(versions);
        if (fallback) sourceModuleDeps.set('@minecraft/server', { module_name: '@minecraft/server', version: fallback });
      }
      dependencies.push(...sourceModuleDeps.values());
    }
    if (sourceCapabilities.size) manifest.capabilities = [...sourceCapabilities];
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

  // Check player conflicts across behavior outputs without copying definitions.
  if (builtBps.length > 1) {
    onProgress?.('Unifying cross-group content', 62);
    await yieldToUI();
    await unifyCrossGroupBps(builtBps.map(b => b.zip), mergeDiagnostics);
  }
  for (const b of builtBps) {
    const bpValidationIssues = await validateMergedArchive(b.zip, b.label);
    mergeDiagnostics.push(...bpValidationIssues.map(issue => `${issue.severity.toUpperCase()} ${issue.code} [${issue.path}]: ${issue.message}`));
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
  const supportId = `AUTOBE-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${packs.length}-${outputs.length}`;
  const structuredFindings = mergeDiagnostics.map((message, index) => {
    const match = message.match(/^(SOURCE BASELINE )?(ERROR|WARNING|WARN|INFO)\s+([A-Z0-9_]+)\s+\[(.+?)\]:\s*(.*)$/i);
    return match
      ? { id: index + 1, origin: match[1] ? 'source' : 'merged', severity: match[2].toLowerCase(), code: match[3], path: match[4], message: match[5] }
      : { id: index + 1, origin: 'merged', severity: /error|failed|invalid|crash/i.test(message) ? 'error' : 'warning', code: 'MERGE_DIAGNOSTIC', path: '', message };
  });
  const report = {
    tool: 'AutoBE Mobile Modpack Tool by StoneByte',
    reportVersion: 2,
    supportId,
    generatedAt: new Date().toISOString(),
    modpackName,
    sourcePacks: packs.map(pack => ({
      name: pack.name,
      type: pack.type,
      version: pack.version,
      sourceFileName: pack.sourceFileName || '',
      minEngineVersion: pack.minEngineVersion || '',
      scriptVersion: pack.scriptVersion || ''
    })),
    outputs: outputs.map(output => ({
      fileName: output.fileName,
      label: output.label,
      type: output.type,
      sizeBytes: output.size,
      sourcePackCount: output.packCount,
      achievementsDisabled: output.achievementsDisabled
    })),
    findings: structuredFindings,
    checks: [{
      name: 'Source packs',
      status: 'ok',
      detail: `${packs.length} addon pack(s) parsed and merged`
    }, {
      name: 'Outputs',
      status: outputs.length > 0 ? 'ok' : 'warning',
      detail: outputs.map(o => o.fileName).join(', ') || 'No outputs produced — check source pack manifests'
    }, {
      name: 'Identifier conflicts',
      status: conflicts.length > 0 ? 'warning' : 'ok',
      detail: conflicts.length > 0 ? `${conflicts.length} collision(s) detected; review conflict choices and the findings below` : 'No identifier collisions detected'
    }, {
      name: 'Merge diagnostics',
      status: mergeDiagnostics.length > 0 ? 'warning' : 'ok',
      detail: mergeDiagnostics.length > 0 ? mergeDiagnostics.join(' | ') : 'No archive or definition merge warnings detected'
    }, {
      name: 'Script runtime property conflicts',
      status: conflictEntries.length > 0 ? 'warning' : 'ok',
      detail: conflictEntries.length > 0 ? `${conflictEntries.length} shared property write(s); behavior may conflict` : 'No runtime property write collisions detected'
    }, {
      name: 'Subpack variants',
      status: 'ok',
      detail: subpackSelections && subpackSelections.length > 0 ? subpackSelections.map(s => `${s.pack} -> ${s.variant}`).join('; ') : 'No subpack variants selected'
    }]
  };
  const sourceFindingLines = structuredFindings.filter(issue => issue.origin === 'source').map(issue => `${issue.id}. [${issue.severity.toUpperCase()} ${issue.code}] ${issue.path}: ${issue.message}`);
  const mergeFindingLines = structuredFindings.filter(issue => issue.origin !== 'source').map(issue => `${issue.id}. [${issue.severity.toUpperCase()} ${issue.code}] ${issue.path || 'Merge pipeline'}: ${issue.message}`);
  const issueLines = [
    'SOURCE ADD-ON FINDINGS (present before merging)',
    ...(sourceFindingLines.length ? sourceFindingLines : ['None detected by current checks.']),
    '',
    'MERGE / OUTPUT FINDINGS',
    ...(mergeFindingLines.length ? mergeFindingLines : ['None detected by current checks.'])
  ];
  const diagnosticsText = [
    'AUTOBE MERGE DIAGNOSTICS',
    '=======================',
    `Support ID: ${supportId}`,
    `Modpack: ${modpackName}`,
    `Created: ${mergeMeta.mergedAt}`,
    `Report version: 2`,
    `Source add-on packs: ${packs.length}`,
    `Output packs: ${outputs.length}`,
    '',
    'WHAT THIS MEANS',
    '---------------',
    mergeDiagnostics.length
      ? `AutoBE recorded ${mergeDiagnostics.length} finding(s). Some may be warnings from the original add-ons rather than problems caused by merging. This report cannot confirm that the pack works in Minecraft; use the findings below to investigate.`
      : 'AutoBE did not detect a problem in the checks it currently runs. This does not guarantee every add-on feature works in Minecraft.',
    '',
    'SOURCE ADD-ONS',
    '--------------',
    ...packs.map((pack, index) => `${index + 1}. ${pack.name} (${pack.type})${pack.sourceFileName ? ` — ${pack.sourceFileName}` : ''}`),
    '',
    'GENERATED PACKS',
    '---------------',
    ...(outputs.length ? outputs.map((output, index) => `${index + 1}. ${output.fileName} — ${output.label}`) : ['No output packs were generated.']),
    '',
    'FINDINGS',
    '--------',
    ...issueLines,
    '',
    'SUPPORT BUNDLE DETAILS',
    '----------------------',
    'The companion _autobe_merge_report.json contains structured findings, pack versions, generated output sizes, and issue paths for deeper analysis.',
    '',
    'HOW TO SEND THIS LOG',
    '--------------------',
    'Send this file together with the Minecraft Content Log and a short note describing what does not work. Include the original add-ons if possible. Do not include passwords, access tokens, or private account information.',
    '',
    'AutoBE reports only issues detectable by its current checks. Creator-side problems and Minecraft runtime behavior may require additional evidence.'
  ].join('\n');
  const combinedExtras = {
    manifestJson: JSON.stringify(mergeMeta, null, 2),
    reportJson: JSON.stringify(report, null, 2),
    diagnosticsText,
  };
  onProgress?.('Finalizing...', 100);
  // NOTE: the combined .mcaddon is NOT built here any more. Building it right after the outputs
  // needed a second full copy of the modpack in memory and got the app killed on phones.
  // It is built on demand by ensureCombinedBlob() when the user downloads / publishes it.
  const totalCalculatedSize = packs.reduce((sum, p) => sum + (p.fileSize || 10_000_000), 0);
  const outputsTotal = outputs.reduce((sum, o) => sum + (o.size || 0), 0);
  const finalSize = outputsTotal > 0 ? outputsTotal : totalCalculatedSize;
  const result: MergedModpack = {
    id: generateUUID(),
    name: modpackName,
    totalPacks: packs.length,
    size: finalSize,
    version,
    createdAt: Date.now(),
    description: description || `All-in-one Bedrock Modpack created with AutoBE. Combines ${packs.length} addons.`,
    outputs,
    combinedExtras,
    outputFileName: `${modpackName.replace(/\s+/g, '_')}.mcaddon`,
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
    entries.push({ name: '_autobe_diagnostics.txt', data: modpack.combinedExtras.diagnosticsText || 'AutoBE diagnostics were not recorded for this saved merge. Re-merge the source add-ons to generate a full troubleshooting log.' });
    entries.push({ name: '_autobe_merge_manifest.json', data: modpack.combinedExtras.manifestJson });
    entries.push({ name: '_autobe_merge_report.json', data: modpack.combinedExtras.reportJson });
  }
  // The packs are already compressed, so a "stored" zip is equivalent — and it is built from Blob
  // references with a streaming checksum, so memory stays flat even for 300+ MB modpacks.
  return buildStoreZip(entries, onProgress);
}
