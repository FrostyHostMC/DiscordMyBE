import assetsData from "@/config/assets";
import JSZip from 'jszip';
import { buildStoreZip, type StoreZipEntry } from '@/utils/storeZip';
import { AddonPack, ConflictItem, MergedModpack, MergedOutput } from '@/types/modpack';
import { generateUUID, deepMerge, mergeLangFiles, sanitizeJsonString } from './addonParser';
import { highestFullScriptVersion } from './scriptApiVersion';
import { mergeSubpackHudFiles } from './subpackHudMerge';
import { scriptModuleOutputPath } from './scriptNamespacing';
import { mergeJsonForFile } from './smartJsonMerge';
import { stableUUID } from '@/utils/stableUuid';
import { expandBrarchiveFiles } from './brarchive';
import { validateMergedArchive } from './mergedArchiveValidation';
import { planBinaryAssetCollisions, rewriteAssetReferences, isVanillaOverridePath, applyVanillaAssetResolutions } from './assetCollision';
export interface MergeProgressCallback {
  (step: string, percent: number): void;
}
export interface MergePlanScriptGroup {
  major: number;
  track: 'stable' | 'beta' | 'unknown';
  fileName: string;
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
const isDeepMergeFile = (path: string) => DEEP_MERGE_FILES.has(path) ||
  (path.startsWith('materials/') && path.endsWith('.material')) ||
  ((path.startsWith('animation_controllers/') || path.startsWith('render_controllers/')) && path.endsWith('.json'));

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
  if (pack.scriptVersion?.toLowerCase() === 'beta') return 2;
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
  const groupMap = new Map<string, { major: number; track: 'stable' | 'beta' | 'unknown'; packs: AddonPack[] }>();
  const unassigned: AddonPack[] = [];
  for (const p of bps) {
    const major = getScriptMajor(p);
    if (major === null) {
      if (p.hasScripts) unassigned.push(p);else dataBp.push(p);
    } else {
      const track = /beta|alpha|preview|rc/i.test(p.scriptVersion || '') ? 'beta' : 'stable';
      const key = `${major}:${track}`;
      const group = groupMap.get(key) || { major, track, packs: [] };
      group.packs.push(p);
      groupMap.set(key, group);
    }
  }
  const scriptGroups: MergePlanScriptGroup[] = [...groupMap.values()].sort((a, b) => a.major - b.major || a.track.localeCompare(b.track)).map(group => ({
    ...group,
    fileName: `behavior_pack_v${group.major}${group.track === 'beta' ? '_beta' : ''}.mcpack`
  }));

  // Unknown versions cannot be proven compatible with one another.
  for (const [index, pack] of unassigned.entries()) {
    scriptGroups.push({
      major: 0,
      track: 'unknown',
      fileName: `behavior_pack_scripts_${index + 1}.mcpack`,
      packs: [pack]
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
  for (const g of plan.scriptGroups) parts.push(g.major > 0 ? `BP v${g.major}${g.track === 'beta' ? ' beta' : ''}: ${g.packs.length} packs` : `BP scripts: ${g.packs.length} packs`);
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
}
function newAccum(): MergeAccum {
  return {
    jsonFiles: new Map(),
    jsonLists: new Map(),
    langFiles: new Map(),
    binaryPaths: [],
    textPaths: [],
    writtenBinaryPaths: new Set()
  };
}
/** Keep definitions from different addons when their archive paths collide.
 * Bedrock resolves behavior definitions by identifier, not by filename, so a
 * deterministic alternate filename lets the later identifier pass merge equal
 * IDs while retaining different IDs. Non-definition JSON keeps existing policy.
 */
function definitionOutputPath(targetZip: JSZip, path: string, sourceLabel: string): string {
  if (!targetZip.file(path)) return path;
  const lower = path.toLowerCase();
  if (!lower.endsWith('.json') || !/(^|\/)(items|entities|blocks|entity|attachables)\//.test(lower)) return path;
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const slug = sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'addon';
  let candidate = `${dir}${stem}__${slug}${ext}`;
  let suffix = 2;
  while (targetZip.file(candidate)) {
    candidate = `${dir}${stem}__${slug}_${suffix}${ext}`;
    suffix++;
  }
  return candidate;
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
async function accumulatePack(zip: JSZip, targetZip: JSZip, accum: MergeAccum, renameMap: Map<string, string> | undefined, pathTransform?: (p: string) => string, onPackFile?: () => Promise<void>, sourceLabel = 'addon', diagnostics?: string[], sourcePackId?: string, vanillaAssetWinners?: Map<string, string>): Promise<void> {
  await expandBrarchiveFiles(zip, diagnostics);
  const assetPathMap = await planBinaryAssetCollisions(zip, targetZip, sourceLabel, pathTransform, diagnostics);
  let batchCount = 0;
  for (const [path, fileObj] of Object.entries(zip.files)) {
    const lower = path.toLowerCase();
    if (fileObj.dir) continue;
    if (sourcePackId && vanillaAssetWinners && isVanillaOverridePath(path) && vanillaAssetWinners.has(path) && vanillaAssetWinners.get(path) !== sourcePackId) continue;
    // Skip every manifest (root AND nested copies from subfolders) and macOS junk.
    const base = lower.substring(lower.lastIndexOf('/') + 1);
    if (base === 'manifest.json' || lower.includes('__macosx')) continue;
    // Safety net: subpack variant folders must never leak into the merged output.
    // The user-selected variant is extracted to the archive root beforehand
    // (applySubpackSelection), so anything left under subpacks/ is an unselected
    // variant and is excluded to avoid duplicate/merged variant content.
    if (lower.startsWith('subpacks/')) continue;
    const transformedPath = pathTransform ? pathTransform(path) : path;
    const outPath = assetPathMap.get(path) || assetPathMap.get(transformedPath) || transformedPath;
    if (['entity/player.entity.json', 'entity/player.json', 'entities/player.json'].includes(lower) && targetZip.file(outPath)) {
      const [previous, incoming] = await Promise.all([targetZip.file(outPath)!.async('uint8array'), fileObj.async('uint8array')]);
      if (previous.length !== incoming.length || previous.some((byte, i) => byte !== incoming[i])) {
        throw new Error(`Multiple different player definitions use ${path}. Merge these add-ons separately or reconcile the player files manually.`);
      }
      continue;
    }
    const targetPath = definitionOutputPath(targetZip, outPath, sourceLabel);
    if (ARRAY_MERGE_FILES.has(lower)) {
      try {
        let text = rewriteAssetReferences(await fileObj.async('text'), assetPathMap);
        // Filter out comment lines (AutoBE.py behavior)
        const lines = text.split('\n');
        const filtered = lines.filter(line => !line.trim().startsWith('//'));
        text = filtered.join('\n');
        
        const parsed = JSON.parse(sanitizeJsonString(text));
        if (Array.isArray(parsed)) {
          const list = accum.jsonLists.get(outPath) || [];
          list.push(...parsed);
          accum.jsonLists.set(outPath, list);
        } else {
          writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
        }
      } catch {
        writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
      }
    } else if (isStrategyMergeFile(lower)) {
      try {
        const txt = rewriteAssetReferences(await fileObj.async('text'), assetPathMap);
        const parsed = JSON.parse(sanitizeJsonString(txt));
        const list = accum.jsonLists.get(outPath) || [];
        list.push(parsed);
        accum.jsonLists.set(outPath, list);
      } catch {
        writeBinaryIfFirst(targetZip, accum, outPath, await fileObj.async('uint8array'));
      }
    } else if (isDeepMergeFile(lower)) {
      try {
        const txt = rewriteAssetReferences(await fileObj.async('text'), assetPathMap);
        const parsed = JSON.parse(sanitizeJsonString(txt));
        const existing = accum.jsonFiles.get(outPath) || {};
        accum.jsonFiles.set(outPath, deepMerge(existing, parsed));
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
      txt = rewriteAssetReferences(txt, assetPathMap);
      for (const [oldId, newId] of renameMap.entries()) {
        txt = txt.split(oldId).join(newId);
      }
      targetZip.file(targetPath, txt);
    } else if (lower.endsWith('.json') || lower.endsWith('.mcfunction')) {
      const txt = rewriteAssetReferences(await fileObj.async('text'), assetPathMap);
      targetZip.file(targetPath, txt);
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
    if (ARRAY_MERGE_FILES.has(p.toLowerCase())) {
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
      zip.file(p, JSON.stringify(mergeJsonForFile(p.toLowerCase(), list), null, 2));
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
/** Apply explicit, potentially lossy keep decisions without rewriting scripts. */
async function applyDefinitionChoices(zip: JSZip, pack: AddonPack, conflicts: ConflictItem[], diagnostics: string[]): Promise<void> {
  const losers = conflicts.filter(c => c.type !== 'vanilla_asset' &&
    (c.resolution === 'keep_a' ? c.packB.id : c.packA.id) === pack.id);
  if (!losers.length) return;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || !path.toLowerCase().endsWith('.json')) continue;
    let data: any;
    try { data = JSON.parse(sanitizeJsonString(await file.async('text'))); }
    catch { continue; }
    let changed = false;
    let drop = false;
    for (const conflict of losers) {
      const lower = path.toLowerCase();
      if ((conflict.type === 'animation_controller' || conflict.type === 'render_controller') &&
          lower.includes(conflict.type === 'animation_controller' ? 'animation_controllers/' : 'render_controllers/')) {
        const key = conflict.type === 'animation_controller' ? 'animation_controllers' : 'render_controllers';
        if (data[key] && Object.prototype.hasOwnProperty.call(data[key], conflict.identifier)) {
          delete data[key][conflict.identifier];
          changed = true;
        }
      } else {
        const folder = conflict.type === 'entity' ? 'entities/' : conflict.type === 'item' ? 'items/' : conflict.type === 'block' ? 'blocks/' : conflict.type === 'recipe' ? 'recipes/' : '';
        if (!folder || !lower.includes(folder)) continue;
        const root = conflict.type === 'recipe'
          ? Object.entries(data).find(([key]) => key.startsWith('minecraft:recipe_'))?.[1] as any
          : data[`minecraft:${conflict.type}`];
        if (root?.description?.identifier === conflict.identifier) drop = true;
      }
    }
    if (drop) zip.remove(path);
    else if (changed) zip.file(path, JSON.stringify(data, null, 2));
    if (drop || changed) diagnostics.push(`WARNING DEFINITION_CHOICE [${path}]: Removed a definition from ${pack.name} to honor the selected conflict choice; its scripts may still expect the removed version.`);
  }
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

async function collectManifestExtras(members: AddonPack[], allPacks: AddonPack[]): Promise<{ capabilities: string[]; dependencies: any[] }> {
  const capabilities = new Set<string>();
  const selected = new Set(allPacks.map(pack => pack.uuid.toLowerCase()));
  const dependencies = new Map<string, any>();
  for (const pack of members) {
    if (!pack.fileBlob) continue;
    const zip = await JSZip.loadAsync(pack.fileBlob);
    const file = zip.file('manifest.json');
    if (!file) throw new Error(`Missing manifest in ${pack.name}`);
    const manifest = JSON.parse(sanitizeJsonString(await file.async('text')));
    for (const cap of manifest.capabilities || []) if (typeof cap === 'string') capabilities.add(cap);
    for (const dep of manifest.dependencies || []) {
      // Selected source pack IDs are replaced by the newly generated packs.
      if (dep.uuid && selected.has(String(dep.uuid).toLowerCase())) continue;
      if (['@minecraft/server', '@minecraft/server-ui', '@minecraft/server-gametest'].includes(dep.module_name)) continue;
      const key = dep.uuid ? `uuid:${String(dep.uuid).toLowerCase()}` : dep.module_name ? `module:${dep.module_name}` : '';
      if (!key) throw new Error(`Unrecognized dependency in ${pack.name}; merge this add-on separately.`);
      const existing = dependencies.get(key);
      if (existing && JSON.stringify(existing.version) !== JSON.stringify(dep.version)) {
        throw new Error(`Incompatible external dependency ${key} in ${pack.name}; merge these add-ons separately.`);
      }
      dependencies.set(key, dep);
    }
  }
  return { capabilities: [...capabilities], dependencies: [...dependencies.values()] };
}

// --- Main merge --------------------------------------------------------

export async function executeMergePacks(packs: AddonPack[], options: {
  modpackName: string;
  description?: string;
  version?: string;
  conflicts?: ConflictItem[];
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
    onProgress,
    scriptConflicts,
    subpackSelections
  } = options;
  onProgress?.('Reading addons', 10);
  const plan = buildMergePlan(packs);
  const mergeDiagnostics: string[] = [];
  const choiceWinners = new Map<string, string>();
  for (const c of conflicts) {
    if (c.type === 'vanilla_asset') continue;
    if (c.resolution === 'prefix_all') throw new Error(`Cannot safely auto-prefix ${c.identifier}. Choose which definition to keep or merge the add-ons separately.`);
    const key = `${c.type}:${c.identifier}`;
    const winner = c.resolution === 'keep_b' ? c.packB.id : c.packA.id;
    const previous = choiceWinners.get(key);
    if (previous && previous !== winner) throw new Error(`Choose the same winning add-on for every conflict involving ${c.identifier}.`);
    choiceWinners.set(key, winner);
  }
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
      await expandBrarchiveFiles(zip, mergeDiagnostics);
      await applyDefinitionChoices(zip, pack, conflicts, mergeDiagnostics);
      const sourceIssues = await validateMergedArchive(zip, `Source Resource Pack: ${pack.name}`);
      mergeDiagnostics.push(...sourceIssues.map(issue => `SOURCE BASELINE ${issue.severity.toUpperCase()} ${issue.code} [${pack.name}:${issue.path}]: ${issue.message}`));
      await accumulatePack(zip, rpZip, accum, undefined, undefined, undefined, pack.name, mergeDiagnostics, pack.id, vanillaAssetWinners);
      // Release the loaded archive so its memory can be reclaimed now.
      zip.files = {} as typeof zip.files;
    }
    writeAccum(rpZip, accum);
    await applyVanillaAssetResolutions(rpZip, packs, conflicts, 'Resource Pack', mergeDiagnostics);
    // Do not inject player variables: they can override an add-on's camera logic.
    await mergeSubpackHudFiles(rpZip);
    const rpValidationIssues = await validateMergedArchive(rpZip, 'Resource Pack');
    mergeDiagnostics.push(...rpValidationIssues.map(issue => `${issue.severity.toUpperCase()} ${issue.code} [${issue.path}]: ${issue.message}`));
    const minEngine = highestVersion(plan.rp.map(p => p.minEngineVersion || '1.20.0'));
    
    const rpExtras = await collectManifestExtras(plan.rp, packs);
    
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
    if (rpExtras.capabilities.length) rpManifest.capabilities = rpExtras.capabilities;
    if (rpExtras.dependencies.length) rpManifest.dependencies = rpExtras.dependencies;
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
  const buildBehaviorPack = async (groupPacks: AddonPack[], type: 'behavior_data' | 'behavior_script', major: number | undefined, outputFileName?: string, track?: 'stable' | 'beta' | 'unknown'): Promise<void> => {
    onProgress?.(type === 'behavior_data' ? 'Processing behavior packs' : `Splitting by script API version (v${major})`, type === 'behavior_data' ? 45 : 55);
    const bpZip = new JSZip();
    const groupKey = `${type}-${major ?? 'data'}-${track ?? 'data'}`;
    const headerUUID = stablePackId(`${groupKey}-header`, groupPacks);
    const dataModuleUUID = stablePackId(`${groupKey}-data-module`, groupPacks);
    const scriptModuleUUID = stablePackId(`${groupKey}-script-module`, groupPacks);
    const accum = newAccum();
    if (iconBytes) {
      bpZip.file(assetsData.IMAGE_FFEH, iconBytes);
      accum.writtenBinaryPaths.add(assetsData.IMAGE_FFEH);
    }
    const scriptEntries: string[] = [];
    for (let pi = 0; pi < groupPacks.length; pi++) {
      const pack = groupPacks[pi];
      if (!pack.fileBlob) continue;
      onProgress?.(`Merging behavior pack ${pi + 1}/${groupPacks.length}`, type === 'behavior_data' ? 40 + 20 * ((pi + 1) / groupPacks.length) : 50 + 15 * ((pi + 1) / groupPacks.length));
      await yieldToUI();
      const zip = await JSZip.loadAsync(pack.fileBlob);
      await expandBrarchiveFiles(zip, mergeDiagnostics);
      await applyDefinitionChoices(zip, pack, conflicts, mergeDiagnostics);
      // The index also distinguishes add-ons whose display names are identical.
      const slug = `${slugify(pack.name, pack.id)}_${pi + 1}`;
      const isScriptGroup = type === 'behavior_script';

      // Find the script entry declared in the pack manifest
      let entries: string[] = [];
      if (isScriptGroup) {
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) throw new Error(`Missing manifest in ${pack.name}`);
        const manifest = JSON.parse(sanitizeJsonString(await manifestFile.async('text')));
        entries = (manifest.modules || []).filter((m: any) => m.type === 'script' || m.type === 'javascript').map((m: any) => {
          const entry = String(m.entry || '').replace(/\\+/g, '/').replace(/^\.\//, '');
          if (!entry || entry.startsWith('/') || entry.split('/').some(part => part === '..' || part === '.')) {
            throw new Error(`Invalid script entry in ${pack.name}: ${entry}`);
          }
          if (!zip.file(entry)) throw new Error(`Missing script entry in ${pack.name}: ${entry}`);
          return entry;
        });
        if (!entries.length) {
          mergeDiagnostics.push(`WARNING NO_SCRIPT_ENTRY [${pack.name}]: Script dependencies were declared but no script module was found.`);
        }
      }
      const sourceIssues = await validateMergedArchive(zip, `Source Behavior Pack: ${pack.name}`);
      mergeDiagnostics.push(...sourceIssues.map(issue => `SOURCE BASELINE ${issue.severity.toUpperCase()} ${issue.code} [${pack.name}:${issue.path}]: ${issue.message}`));
      await accumulatePack(zip, bpZip, accum, undefined, isScriptGroup ? p => p.toLowerCase().startsWith('scripts/') || /\.(?:[cm]?js)$/i.test(p) ? scriptModuleOutputPath(slug, p) : p : undefined, undefined, pack.name, mergeDiagnostics, pack.id, vanillaAssetWinners);
      // Release the loaded archive so its memory can be reclaimed now.
      zip.files = {} as typeof zip.files;
      if (isScriptGroup) {
        for (const entry of entries) {
          const entryPath = scriptModuleOutputPath(slug, entry);
          if (!bpZip.file(entryPath)) throw new Error(`Could not copy script entry from ${pack.name}: ${entry}`);
          scriptEntries.push(entryPath);
        }
      }
    }
    writeAccum(bpZip, accum);
    await applyVanillaAssetResolutions(bpZip, packs, conflicts, 'Behavior Pack', mergeDiagnostics);
    // Keep source definitions intact; reviewed conflicts are handled before copying.

    // Scripted BP: one entry file importing every pack's entry
    if (type === 'behavior_script') {
      const specs = scriptEntries.map(entry => `./${entry.replace(/^scripts\//, '')}`);
      const imports = specs.length === 1
        ? `import ${JSON.stringify(specs[0])};`
        : ['const report = (entry, error) => { try { console.error(`[AutoBE] ${entry} failed to load: ${error && error.stack ? error.stack : error}`); } catch (_) {} };',
          'let chain = Promise.resolve();',
          ...specs.map(spec => `chain = chain.then(() => import(${JSON.stringify(spec)})).catch(error => report(${JSON.stringify(spec)}, error));`)].join('\n');
      bpZip.file('scripts/Stonebyte.js', `// AutoBE combined script entry\n${imports}\n`);
      if (specs.length > 1) mergeDiagnostics.push('WARNING SCRIPT_LOADER [scripts/Stonebyte.js]: Each add-on loads through a guarded dynamic import. Test startup events and all add-ons in Minecraft.');
    }
    const minEngine = highestVersion(groupPacks.map(p => p.minEngineVersion || '1.20.0'));
    const label = type === 'behavior_data' ? 'Behavior (Data)' : major && major > 0 ? `Behavior (Script API v${major}${track === 'beta' ? ' beta' : ''})` : 'Behavior (Scripts)';
    const fileName = outputFileName || 'behavior_pack_data.mcpack';

    // Dependencies: every BP depends on the shared RP
    const bpExtras = await collectManifestExtras(groupPacks, packs);
    const dependencies: any[] = [...bpExtras.dependencies];
    if (rpHeaderUUID) dependencies.push({
      uuid: rpHeaderUUID,
      version: versionNums
    });
    const modules: any[] = [{
      type: 'data',
      uuid: dataModuleUUID,
      version: [1, 0, 0]
    }];
    const manifest: any = {
      format_version: 2,
      header: {
        name: `AutoBE ${label}`,
        description: description || `Merged with AutoBE by StoneByte (${groupPacks.length} behavior packs combined)`,
        uuid: headerUUID,
        version: versionNums,
        min_engine_version: parseVersion(minEngine).nums
      },
      modules,
      dependencies
    };
    if (bpExtras.capabilities.length) manifest.capabilities = bpExtras.capabilities;
    if (type === 'behavior_script') {
      modules.push({
        type: 'script',
        language: 'javascript',
        uuid: scriptModuleUUID,
        version: [1, 0, 0],
        entry: 'scripts/Stonebyte.js'
      });
      manifest.capabilities = [...new Set([...(manifest.capabilities || []), 'script_eval'])];
      const addScriptDependency = (name: string, input: Array<string | undefined>) => {
        const versions = input.filter((value): value is string => Boolean(value));
        if (!versions.length) return;
        const keys = new Set(versions.map(value => value.toLowerCase() === 'beta' ? '2:beta' : `${parseVersion(value).nums[0]}:${parseVersion(value).beta ? 'beta' : 'stable'}`));
        if (keys.size > 1) throw new Error(`Incompatible ${name} versions in one group: ${versions.join(', ')}. Merge these add-ons separately.`);
        const selected = versions.some(value => value.toLowerCase() === 'beta') ? 'beta' : highestFullScriptVersion(versions);
        if (selected) manifest.dependencies.push({ module_name: name, version: selected });
      };
      addScriptDependency('@minecraft/server', groupPacks.map(pack => pack.scriptVersion));
      addScriptDependency('@minecraft/server-ui', groupPacks.map(pack => pack.scriptUiVersion));
      addScriptDependency('@minecraft/server-gametest', groupPacks.map(pack => pack.gameTestVersion));
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
    await buildBehaviorPack(g.packs, 'behavior_script', g.major, g.fileName, g.track);
  }

  // Keep incompatible behavior groups separate instead of copying definitions
  // across their pack boundaries.
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
      status: conflicts.length > 0 ? 'resolved' : 'ok',
      detail: conflicts.length > 0 ? `${conflicts.length} collision(s) detected and resolved` : 'No identifier collisions detected'
    }, {
      name: 'Merge diagnostics',
      status: mergeDiagnostics.length > 0 ? 'warning' : 'ok',
      detail: mergeDiagnostics.length > 0 ? mergeDiagnostics.join(' | ') : 'No archive or definition merge warnings detected'
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
  ].join('\\n');
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
