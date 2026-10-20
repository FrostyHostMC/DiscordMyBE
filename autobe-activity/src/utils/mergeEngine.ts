import JSZip from 'jszip';
import { AddonPack, ConflictItem, MergedModpack, MergedOutput } from '@/types/modpack';
import {
  generateUUID,
  deepMerge,
  mergeLangFiles,
  sanitizeJsonString,
  safeParseJson,
  normalizeEngineVersion
} from './addonParser';

export interface MergeProgressCallback {
  (step: string, percent: number): void;
}

export interface MergePlanScriptGroup {
  /** Major version of `@minecraft/server`, or `0` when the pack declares no version. */
  major: number;
  /** Resolved version string, e.g. "2.5.0" or "" when unknown. */
  scriptVersion: string;
  packs: AddonPack[];
  /** True when these scripted packs declare no recognisable @minecraft/server version. */
  unknownVersion: boolean;
}

export interface MergePlan {
  rp: AddonPack[];
  dataBp: AddonPack[];
  scriptGroups: MergePlanScriptGroup[];
  /** Back-compat alias: scripted packs that could not be grouped by version. */
  unassigned: AddonPack[];
}

/**
 * JSON files that must be deep-merged instead of overwritten.
 *
 * Ported from the Python `_mergeable_files` set. The previous web list was
 * missing `textures_list.json` (which silently broke every merged texture) and
 * all of the UI/splash/player definition files.
 */
const DEEP_MERGE_FILES = new Set(
  [
    'item_texture.json',
    'terrain_texture.json',
    'tick.json',
    'sounds.json',
    'blocks.json',
    'biomes_client.json',
    'sound_definitions.json',
    'music_definitions.json',
    'flipbook_textures.json',
    'textures_list.json',
    '_ui_defs.json',
    'hud_screen.json',
    'npc_interact_screen.json',
    '_global_variables.json',
    'ui_common.json',
    'splashes.json',
    'player.animation_controllers.json',
    'player.animation.json',
    'player.render_controllers.json'
  ].map((f) => `textures/${f}`)
);
// Python lists bare filenames; match on the basename too.
const DEEP_MERGE_BASENAMES = new Set([
  'item_texture.json',
  'terrain_texture.json',
  'tick.json',
  'sounds.json',
  'blocks.json',
  'biomes_client.json',
  'sound_definitions.json',
  'music_definitions.json',
  'flipbook_textures.json',
  'textures_list.json',
  '_ui_defs.json',
  'hud_screen.json',
  'npc_interact_screen.json',
  '_global_variables.json',
  'ui_common.json',
  'splashes.json',
  'player.animation_controllers.json',
  'player.animation.json',
  'player.render_controllers.json'
]);

// Folders whose files are grouped by identifier and merged instead of overwritten.
const ENTITY_DIRS = new Set(['entities', 'entity']);
const ITEM_DIR = 'items';
const BLOCK_DIR = 'blocks';

// ---------------------------------------------------------------------------
// Version utilities
// ---------------------------------------------------------------------------

/** Parse "1.10.0" / "1.9.0-beta" into a comparable tuple. */
export function parseVersion(v: string): { nums: number[]; beta: boolean } {
  const clean = (v || '0.0.0').trim().replace(/^v/i, '');
  const beta = /-beta|-rc|-preview/i.test(clean);
  const nums = clean
    .split('-')[0]
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return { nums, beta };
}

/** Numeric compare: 1.10.0 > 1.9.0. A release beats its own beta. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va.nums[i] !== vb.nums[i]) return va.nums[i] - vb.nums[i];
  }
  if (va.beta !== vb.beta) return va.beta ? -1 : 1;
  return 0;
}

export function highestVersion(versions: string[]): string {
  const valid = versions.filter((v) => !!v && parseVersion(v).nums[0] > 0);
  if (valid.length === 0) return '';
  return valid.reduce((acc, v) => (compareVersions(v, acc) >= 0 ? v : acc), valid[0]);
}

/**
 * Major version of `@minecraft/server`.
 *
 * Fixed: previously this parsed the *display label* `"@minecraft/server 1.13.0"`,
 * whose first segment is not numeric, so it always resolved to `null` and every
 * scripted pack silently landed in `unassigned` (and was then dropped).
 */
export function getScriptMajor(pack: AddonPack): number | null {
  if (!pack.hasScripts) return null;
  const raw = pack.scriptApiVersion || '';
  if (!raw) return null;
  const { nums } = parseVersion(raw);
  if (nums[0] <= 0) return null;
  return nums[0];
}

/** Builds the Script API output plan: one RP, one data-only BP, one BP per script major. */
export function buildMergePlan(packs: AddonPack[]): MergePlan {
  const rp = packs.filter((p) => p.type === 'Resource Pack');
  const bps = packs.filter((p) => p.type === 'Behavior Pack');
  const dataBp: AddonPack[] = [];
  const groupMap = new Map<number, AddonPack[]>();
  const versionMap = new Map<number, string>();

  for (const p of bps) {
    const major = getScriptMajor(p);
    if (major === null) {
      if (p.hasScripts) groupMap.set(0, [...(groupMap.get(0) || []), p]);
      else dataBp.push(p);
    } else {
      groupMap.set(major, [...(groupMap.get(major) || []), p]);
      const cur = versionMap.get(major);
      if (p.scriptApiVersion && (!cur || compareVersions(p.scriptApiVersion, cur) >= 0)) {
        versionMap.set(major, p.scriptApiVersion);
      }
    }
  }

  const scriptGroups = [...groupMap.entries()]
    .sort((a, b) => {
      // unknown-version group (0) sorts last
      if (a[0] === 0) return 1;
      if (b[0] === 0) return -1;
      return a[0] - b[0];
    })
    .map(([major, gPacks]) => ({
      major,
      packs: gPacks,
      scriptVersion: versionMap.get(major) || '',
      unknownVersion: major === 0
    }));

  return { rp, dataBp, scriptGroups, unassigned: groupMap.get(0) || [] };
}

export function formatPlanSummary(plan: MergePlan): string {
  const parts: string[] = [];
  if (plan.rp.length > 0) parts.push(`Resource pack: ${plan.rp.length} packs`);
  if (plan.dataBp.length > 0) parts.push(`BP data-only: ${plan.dataBp.length} packs`);
  for (const g of plan.scriptGroups) {
    parts.push(
      g.unknownVersion
        ? `BP scripted (version unknown): ${g.packs.length} packs`
        : `BP v${g.major}: ${g.packs.length} packs`
    );
  }
  return parts.join(' · ') || 'No packs selected';
}

// ---------------------------------------------------------------------------
// Identifier conflict resolution
// ---------------------------------------------------------------------------

const RESERVED_NAMESPACES = new Set(['minecraft', 'minecraft_vanilla']);

/** Mirrors the Python `IdentifierManager.generate_identifier_mappings`. */
export function buildPrefixedIdentifier(identifier: string, packSlug: string): string {
  const ns = `${packSlug}_merge`;
  if (identifier.includes(':')) {
    const [namespacePart, namePart] = identifier.split(':', 2);
    if (!RESERVED_NAMESPACES.has(namespacePart)) return `${ns}:${namePart}`;
    return `${namespacePart}:${ns}_${namePart}`;
  }
  return `${ns}:${identifier}`;
}

export interface IdentifierPlan {
  /** packId -> (oldIdentifier -> newIdentifier) */
  renames: Map<string, Map<string, string>>;
  /** `${type}::${identifier}` values that must be excluded from the merge entirely. */
  dropped: Set<string>;
}

/**
 * Turns user conflict resolutions into concrete rename + exclusion plans.
 *
 * Resolutions are collapsed **per identifier**, not per pair. Picking "keep A"
 * for one row of a 3-way conflict and "keep B" for another would otherwise
 * drop every definition; instead a single explicit decision wins and everything
 * else is dropped or namespaced:
 *
 *   keep_a / keep_b -> the chosen pack keeps the id, all other packs are dropped
 *                      (their references already point at the unchanged id)
 *   prefix_all      -> the first pack keeps the id, every other pack is moved
 *                      into its own namespace so nothing is lost
 */
export function buildIdentifierPlan(
  conflicts: ConflictItem[],
  autoPrefix: boolean
): IdentifierPlan {
  const renames = new Map<string, Map<string, string>>();
  const dropped = new Set<string>();

  const addRename = (packId: string, from: string, to: string) => {
    if (from === to) return;
    let map = renames.get(packId);
    if (!map) {
      map = new Map();
      renames.set(packId, map);
    }
    map.set(from, to);
  };

  const slugFor = (packId: string, fallback: string) => {
    const base = fallback
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 20)
      .replace(/^_+|_+$/g, '');
    return base || packId.replace(/[^a-z0-9]/g, '').slice(0, 8);
  };

  // Group every row that refers to the same type + identifier.
  const groups = new Map<string, ConflictItem[]>();
  for (const c of conflicts) {
    const key = `${c.type}::${c.identifier}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  for (const [key, rows] of groups) {
    const identifier = rows[0].identifier;

    // Every pack that defines this identifier, in a stable order.
    const owners: Array<{ id: string; name: string }> = [];
    for (const row of rows) {
      for (const p of row.packs?.length ? row.packs : [row.packA, row.packB]) {
        if (p && !owners.some((o) => o.id === p.id)) owners.push({ id: p.id, name: p.name });
      }
    }
    if (owners.length < 2) continue;

    const effective = (row: ConflictItem): ConflictItem['resolution'] =>
      autoPrefix && row.resolution !== 'keep_a' && row.resolution !== 'keep_b'
        ? 'prefix_all'
        : row.resolution;

    // An explicit "combine" decision merges the definitions into one identifier.
    if (rows.some((row) => effective(row) === 'merge')) {
      // No rename, no drop: every definition keeps the identifier and the
      // writer merges them component-wise.
      continue;
    }

    // An explicit "keep" decision anywhere in the group decides for the group.
    let winnerId: string | null = null;
    for (const row of rows) {
      const res = effective(row);
      if (res === 'keep_a') {
        winnerId = row.packA.id;
        break;
      }
      if (res === 'keep_b') {
        winnerId = row.packB.id;
        break;
      }
    }

    if (winnerId) {
      // The winner keeps the original id; the losers are excluded entirely.
      for (const owner of owners) {
        if (owner.id === winnerId) continue;
        dropped.add(`${key}::${owner.id}`);
      }
      continue;
    }

    // Namespacing: first owner keeps the id, the rest get unique namespaces.
    for (let i = 1; i < owners.length; i++) {
      const owner = owners[i];
      addRename(owner.id, identifier, buildPrefixedIdentifier(identifier, slugFor(owner.id, owner.name)));
    }
  }

  return { renames, dropped };
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

interface GroupEntry {
  packId: string;
  filePath: string;
  data: any;
}

interface Accum {
  /** Explicitly written single files (first pack wins). */
  singles: Map<string, { path: string; data: Uint8Array | string }>;
  /** Deep-merged JSON, keyed by lowercased path. */
  mergedJson: Map<string, any>;
  /** Actual output path for each deep-merged JSON key. */
  mergedJsonPaths: Map<string, string>;
  /** Merged lang files, keyed by output path. */
  lang: Map<string, string>;
  /** Identifier-grouped JSON (entities / items / blocks / player). */
  groups: Map<string, GroupEntry[]>;
  /**
   * Output paths already claimed in this build.
   *
   * Two packs almost always ship `blocks/stone.json`. When only one of them is
   * renamed the surviving file paths still collide, and writing the same zip
   * entry name twice silently loses one of the definitions.
   */
  claimedPaths: Set<string>;
  /** Pack icons – only the first one is kept. */
  iconTaken: boolean;
}

function newAccum(): Accum {
  return {
    singles: new Map(),
    mergedJson: new Map(),
    mergedJsonPaths: new Map(),
    lang: new Map(),
    groups: new Map(),
    claimedPaths: new Set<string>(),
    iconTaken: false
  };
}

/** Returns `desired` when free, otherwise a de-duplicated sibling path. */
function claimPath(accum: Accum, desired: string): string {
  if (!accum.claimedPaths.has(desired)) {
    accum.claimedPaths.add(desired);
    return desired;
  }
  const slash = desired.lastIndexOf('/');
  const dir = slash >= 0 ? desired.slice(0, slash + 1) : '';
  const base = slash >= 0 ? desired.slice(slash + 1) : desired;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 2;
  let candidate = `${dir}${stem}_${i}${ext}`;
  while (accum.claimedPaths.has(candidate)) {
    i++;
    candidate = `${dir}${stem}_${i}${ext}`;
  }
  accum.claimedPaths.add(candidate);
  return candidate;
}

function pathIs(path: string, suffix: string): boolean {
  return path.toLowerCase().endsWith(suffix);
}

/**
 * Rewrites identifier references inside JSON, mirroring the Python
 * `update_json_identifiers`.
 */
export function rewriteJsonIdentifiers(json: any, renames: Map<string, string>): any {
  if (!renames || renames.size === 0) return json;
  const DIRECT_KEYS = new Set(['identifier', 'entity', 'item', 'block', 'loot_table', 'recipe']);

  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(node)) {
        if (DIRECT_KEYS.has(key) && typeof value === 'string') {
          out[key] = renames.get(value) ?? value;
        } else {
          out[key] = walk(value);
        }
      }
      return out;
    }
    if (typeof node === 'string' && node.includes(':') && !node.startsWith('http')) {
      return renames.get(node) ?? node;
    }
    return node;
  };

  return walk(json);
}

/**
 * Rewrites identifiers inside text (scripts, .lang, .mcfunction).
 * Word boundaries prevent partial matches (`ns:a` must not rewrite `ns:abc`).
 */
export function rewriteTextIdentifiers(text: string, renames: Map<string, string>): string {
  if (!renames || renames.size === 0) return text;
  let out = text;
  for (const [oldId, newId] of renames.entries()) {
    if (oldId === newId) continue;
    // Escape for regex and anchor both ends with a boundary so `ns:a` never
    // matches inside `ns:abc` or `other:ns:a`.
    const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g');
    out = out.replace(re, newId);
  }
  return out;
}

function readIdentifier(json: any, rootKeys: string[]): string {
  for (const key of rootKeys) {
    const node = json?.[key];
    if (node?.description?.identifier) return String(node.description.identifier);
  }
  return '';
}

/**
 * Reads every file of a pack into the accumulator.
 *
 * @param scriptTransform optional path rewriter used for scripted BP groups.
 * @param entryPath normalized path of the pack's script entry inside the output.
 */
async function accumulatePack(
  zip: JSZip,
  accum: Accum,
  packId: string,
  renames: Map<string, string> | undefined,
  options: {
    dropped: Set<string>;
    scriptTransform?: (p: string) => string;
    /** Normalized entry path; used to guarantee the entry file exists. */
    entryPath?: string;
  }
): Promise<void> {
  const { dropped, scriptTransform } = options;
  const renameMap = renames || new Map<string, string>();

  const putSingle = (outPath: string, data: Uint8Array | string) => {
    if (!accum.singles.has(outPath)) {
      const claimed = claimPath(accum, outPath);
      accum.singles.set(claimed, { path: claimed, data });
    }
  };

  const groupKey = (type: string, identifier: string) => `${type}::${identifier}`;

  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (rawPath.toLowerCase().includes('__macosx')) continue;

    const outPath = scriptTransform ? scriptTransform(rawPath) : rawPath;
    const lower = outPath.toLowerCase();
    const base = lower.split('/').pop() || '';

    // manifest.json is regenerated by us
    if (base === 'manifest.json') continue;

    // Only the first pack's icon survives
    if (/^pack_icon\.(png|jpe?g)$/.test(base)) {
      if (accum.iconTaken) continue;
      accum.iconTaken = true;
      putSingle(outPath, await entry.async('uint8array'));
      continue;
    }

    const isJson = pathIs(base, '.json');
    const isLang = pathIs(base, '.lang');
    const isMaterial = pathIs(base, '.material');
    const isText = pathIs(base, '.mcfunction') || pathIs(base, '.js') || pathIs(base, '.ts');

    if (isJson) {
      let json: any;
      try {
        json = safeParseJson(await entry.async('text'));
      } catch {
        json = null;
      }

      if (json) {
        json = rewriteJsonIdentifiers(json, renameMap);

        const dir = outPath.split('/')[0].toLowerCase();

        // Identifier-grouped definitions get merged, never overwritten.
        let groupType: string | null = null;
        let identifier = '';
        if (ENTITY_DIRS.has(dir)) {
          groupType = 'entity';
          identifier = readIdentifier(json, ['minecraft:entity', 'minecraft:client_entity']);
          if (!identifier && json.description?.identifier) identifier = String(json.description.identifier);
        } else if (dir === ITEM_DIR) {
          groupType = 'item';
          identifier = readIdentifier(json, ['minecraft:item']);
        } else if (dir === BLOCK_DIR) {
          groupType = 'block';
          identifier = readIdentifier(json, ['minecraft:block']);
        }

        if (groupType && identifier) {
          const isPlayer = identifier === 'minecraft:player';
          if (dropped.has(groupKey(groupType, identifier) + `::${packId}`)) continue;
          // player.json always lands in one bucket so all packs combine into it
          const key = isPlayer ? 'player' : groupKey(groupType, identifier);
          const bucket = accum.groups.get(key);
          // Same identifier as an earlier pack: share its output path so the two
          // definitions get merged instead of overwriting each other.
          const entryPath = bucket && bucket.length > 0 ? bucket[0].filePath : claimPath(accum, outPath);
          accum.groups.set(key, [...(bucket || []), { packId, filePath: entryPath, data: json }]);
          continue;
        }
      }

      // Deep-mergeable files
      if (DEEP_MERGE_FILES.has(lower) || DEEP_MERGE_BASENAMES.has(base)) {
        if (json) {
          const existing = accum.mergedJson.get(lower);
          if (existing) {
            accum.mergedJson.set(lower, deepMerge(existing, json));
          } else {
            const claimed = claimPath(accum, outPath);
            accum.mergedJson.set(lower, json);
            accum.mergedJsonPaths.set(lower, claimed);
          }
          continue;
        }
      }

      if (json) {
        const text = JSON.stringify(json, null, 2);
        putSingle(outPath, rewriteTextIdentifiers(text, renameMap));
        continue;
      }

      // Unparseable JSON -> copy raw bytes so nothing silently disappears
      putSingle(outPath, await entry.async('uint8array'));
      continue;
    }

    if (isLang) {
      const raw = await entry.async('text').catch(() => '');
      accum.lang.set(outPath, mergeLangFiles(accum.lang.get(outPath) || '', raw));
      continue;
    }

    if (isMaterial) {
      const raw = await entry.async('text').catch(() => '');
      const json = safeParseJson(raw);
      if (json) {
        accum.mergedJson.set(lower, deepMerge(accum.mergedJson.get(lower) || {}, json));
      } else {
        putSingle(outPath, raw);
      }
      continue;
    }

    if (isText) {
      const raw = await entry.async('text').catch(() => '');
      putSingle(outPath, rewriteTextIdentifiers(raw, renameMap));
      continue;
    }

    putSingle(outPath, await entry.async('uint8array'));
  }

  // Guarantee the script entry exists even when the pack declared a path we
  // cannot find (previous versions silently produced an import of nothing).
  if (options.entryPath && !accum.singles.has(options.entryPath)) {
    accum.singles.set(options.entryPath, {
      path: options.entryPath,
      data: '// AutoBE: original entry file was missing from this pack.\n'
    });
  }
}

function writeAccum(zip: JSZip, accum: Accum, extra: Array<{ path: string; data: string }> = []): void {
  for (const [key, obj] of accum.mergedJson.entries()) {
    zip.file(accum.mergedJsonPaths.get(key) || key, JSON.stringify(obj, null, 2));
  }
  for (const [p, str] of accum.lang.entries()) zip.file(p, str);

  // Identifier groups: two packs that ended up with the same final identifier
  // (either because they always shared it, or because the user chose "combine")
  // are merged component-wise, exactly like the desktop build does.
  for (const entries of accum.groups.values()) {
    if (entries.length === 0) continue;
    let merged = entries[0].data;
    for (let i = 1; i < entries.length; i++) merged = deepMerge(merged, entries[i].data);
    zip.file(entries[0].filePath, JSON.stringify(merged, null, 2));
  }

  for (const s of accum.singles.values()) {
    // Never write zero-byte files (Bedrock loads them as broken definitions)
    if (typeof s.data === 'string' && s.data.length === 0) continue;
    if (typeof s.data !== 'string' && s.data.byteLength === 0) continue;
    zip.file(s.path, s.data);
  }
  for (const e of extra) zip.file(e.path, e.data);
}

function slugify(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const cleaned = base || id.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'pack';
  return cleaned === 'scripts' ? `${cleaned}_pack` : cleaned;
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  const slug = `${base}_${i}`;
  used.add(slug);
  return slug;
}

/**
 * JSZip returns `Uint8Array<ArrayBufferLike>`, which TS 5.9 refuses to accept as
 * a `BlobPart`. Copying into a fresh `ArrayBuffer` satisfies the DOM types and
 * also detaches the view from JSZip's internal buffer, which JSZip explicitly
 * warns about for `Uint8Array` results.
 */
function toZipBlob(data: Uint8Array, type = 'application/zip'): Blob {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer], { type });
}

// ---------------------------------------------------------------------------
// Main merge
// ---------------------------------------------------------------------------

export interface ExecuteMergeOptions {
  modpackName: string;
  description?: string;
  author?: string;
  version?: string;
  conflicts?: ConflictItem[];
  autoPrefix?: boolean;
  onProgress?: MergeProgressCallback;
}

export async function executeMergePacks(
  packs: AddonPack[],
  options: ExecuteMergeOptions
): Promise<MergedModpack> {
  const {
    modpackName,
    description,
    author = 'StoneByte',
    version = '1.0.0',
    conflicts = [],
    autoPrefix = false,
    onProgress
  } = options;

  if (packs.length === 0) throw new Error('No packs selected to merge.');

  onProgress?.('Reading addons', 10);

  const plan = buildMergePlan(packs);
  const identifierPlan = buildIdentifierPlan(conflicts, autoPrefix);
  const versionNums = [0, 1, 2].map((i) => parseInt(String(version.split('.')[i]), 10) || 0) as [
    number,
    number,
    number
  ];

  // Load every pack zip once and reuse it across outputs.
  const zips = new Map<string, JSZip>();
  await Promise.all(
    packs.map(async (pack) => {
      if (!pack.fileBlob) return;
      try {
        zips.set(pack.id, await JSZip.loadAsync(pack.fileBlob));
      } catch {
        // A corrupt blob simply contributes nothing.
      }
    })
  );

  const loadedPacks = packs.filter((p) => zips.has(p.id));
  if (loadedPacks.length === 0) {
    throw new Error('None of the selected packs could be read.');
  }

  const outputs: MergedOutput[] = [];
  const rpHeaderUUID = generateUUID();
  const bpHeaderUUIDs: string[] = [];
  let producedRP = false;

  // --- Resource Pack -------------------------------------------------------
  const rpFunctions: Record<string, string | Uint8Array> = {};
  let rpTickJson: any = null;
  let rpPlayerEntity: any = null;

  if (plan.rp.length > 0) {
    onProgress?.('Processing resource packs', 30);
    const rpZip = new JSZip();
    const rpModuleUUID = generateUUID();
    const accum = newAccum();

    for (const pack of plan.rp) {
      const zip = zips.get(pack.id);
      if (!zip) continue;
      await accumulatePack(zip, accum, pack.id, identifierPlan.renames.get(pack.id), {
        dropped: identifierPlan.dropped
      });

      // Python's `_move_tick_and_delete_functions` relocates these to the BP.
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const norm = path.replace(/\\/g, '/');
        if (/^functions\/tick\.json$/i.test(norm)) {
          const json = safeParseJson(await entry.async('text').catch(() => ''));
          if (json) rpTickJson = deepMerge(rpTickJson || {}, rewriteJsonIdentifiers(json, identifierPlan.renames.get(pack.id) || new Map()));
        } else if (/^functions\//i.test(norm)) {
          rpFunctions[norm.slice('functions/'.length)] = await entry.async('uint8array');
        } else if (/^entity\/player\.json$/i.test(norm)) {
          const json = safeParseJson(await entry.async('text').catch(() => ''));
          if (json) {
            rpPlayerEntity = deepMerge(
              rpPlayerEntity || {},
              rewriteJsonIdentifiers(json, identifierPlan.renames.get(pack.id) || new Map())
            );
          }
        }
      }
    }

    // functions/ and entities/ belong in the behavior pack, not the resource pack.
    for (const key of [...accum.singles.keys()]) {
      if (/^functions\//i.test(key) || /^entities\//i.test(key)) accum.singles.delete(key);
    }
    for (const key of [...accum.mergedJson.keys()]) {
      if (/^functions\//i.test(key) || /^entities\//i.test(key)) accum.mergedJson.delete(key);
    }
    for (const key of [...accum.groups.keys()]) {
      if (key.startsWith('entity::')) accum.groups.delete(key);
    }

    writeAccum(rpZip, accum);

    const minEngine = highestVersion(plan.rp.map((p) => p.minEngineVersion || '')) || '1.20.0';
    const rpManifest: any = {
      format_version: 2,
      header: {
        name: `${modpackName} [RP]`,
        description:
          description || `Merged with AutoBE by StoneByte (${plan.rp.length} resource packs combined)`,
        uuid: rpHeaderUUID,
        version: versionNums,
        min_engine_version: parseVersion(minEngine).nums
      },
      modules: [{ type: 'resources', uuid: rpModuleUUID, version: [1, 0, 0] }],
      metadata: { authors: [author] }
    };
    // Minecraft links RP <-> BP through these cross-references; the BP side is
    // patched in once every behavior pack header uuid is known.
    rpZip.file('manifest.json', JSON.stringify(rpManifest, null, 2));

    const rpBlobData = await rpZip.generateAsync({ type: 'uint8array' });
    outputs.push({
      id: generateUUID(),
      label: 'Resource Pack',
      fileName: 'resource_pack.mcpack',
      type: 'resource',
      packCount: plan.rp.length,
      size: rpBlobData.byteLength,
      achievementsDisabled: plan.rp.some((p) => p.hasExperimental),
      blob: toZipBlob(rpBlobData)
    });
    producedRP = true;
  }

  // --- Behavior Packs -----------------------------------------------------
  const bpManifests: any[] = [];

  const buildBehaviorPack = async (
    groupPacks: AddonPack[],
    type: 'behavior_data' | 'behavior_script',
    major: number | undefined,
    declaredScriptVersion: string
  ): Promise<void> => {
    onProgress?.(
      type === 'behavior_data'
        ? 'Processing behavior packs'
        : major === 0
        ? 'Processing scripted packs (version unknown)'
        : `Splitting by script API version (v${major})`,
      type === 'behavior_data' ? 45 : 55
    );

    const bpZip = new JSZip();
    const headerUUID = generateUUID();
    const dataModuleUUID = generateUUID();
    const scriptModuleUUID = generateUUID();
    const accum = newAccum();
    const usedSlugs = new Set<string>();
    const imports: string[] = [];
    const capabilities = new Set<string>();
    let gametestVersion = '';
    let uiVersion = '';

    for (const pack of groupPacks) {
      const zip = zips.get(pack.id);
      if (!zip) continue;

      const renames = identifierPlan.renames.get(pack.id);
      const isScriptGroup = type === 'behavior_script';
      let entry: string | null = null;
      let scriptRoot = 'scripts';

      if (isScriptGroup) {
        try {
          const manifestFile = zip.file(/manifest\.json$/i)[0];
          if (manifestFile) {
            const manifest = safeParseJson(await manifestFile.async('text'));
            const scriptModule = (manifest?.modules || []).find(
              (m: any) => String(m?.type || '').toLowerCase() === 'script'
            );
            if (scriptModule?.entry) {
              entry = String(scriptModule.entry).replace(/^\.\//, '').replace(/^\/+/, '');
              const top = entry.split('/')[0];
              if (top.includes('.')) scriptRoot = ''; // entry sits at the archive root
              else scriptRoot = top;
            }
          }
        } catch {
          entry = null;
        }
        if (!entry) entry = 'scripts/main.js';
      }

      const slug = uniqueSlug(slugify(pack.name, pack.id), usedSlugs);

      let entryPath: string | undefined;
      let transform: ((p: string) => string) | undefined;
      if (isScriptGroup) {
        // Namespace the whole script tree so two packs can both ship
        // "scripts/main.js" without one overwriting the other.
        const relocate = (p: string) => {
          const norm = p.replace(/\\/g, '/');
          if (!scriptRoot) return norm;
          if (norm === scriptRoot) return `scripts/${slug}`;
          if (norm.startsWith(`${scriptRoot}/`)) return `scripts/${slug}/${norm.slice(scriptRoot.length + 1)}`;
          return norm;
        };
        transform = relocate;
        const relocated = relocate(entry!.replace(/\\/g, '/'));
        entryPath = relocated.startsWith('scripts/')
          ? relocated
          : `scripts/${slug}/${relocated.replace(/^scripts\//, '')}`;
        imports.push(`import './${entryPath.replace(/^scripts\//, '')}';`);
      }

      await accumulatePack(zip, accum, pack.id, renames, {
        dropped: identifierPlan.dropped,
        scriptTransform: transform,
        entryPath
      });

      for (const cap of pack.capabilities || []) capabilities.add(cap);
      if (pack.scriptGametestApiVersion) {
        if (!gametestVersion || compareVersions(pack.scriptGametestApiVersion, gametestVersion) >= 0) {
          gametestVersion = pack.scriptGametestApiVersion;
        }
      }
      if (pack.scriptUiApiVersion) {
        if (!uiVersion || compareVersions(pack.scriptUiApiVersion, uiVersion) >= 0) {
          uiVersion = pack.scriptUiApiVersion;
        }
      }
    }

    writeAccum(bpZip, accum);

    // Python's script relocation: one combined entry that imports each pack.
    if (type === 'behavior_script') {
      bpZip.file(
        'scripts/Stonebyte.js',
        [
          '// Combined entry generated by AutoBE (StoneByte).',
          '// Each addon keeps its own folder so relative imports keep working.',
          ...imports,
          ''
        ].join('\n')
      );

      // Port the RP's tick.json / player entity over to the behavior pack.
      if (rpTickJson) bpZip.file('functions/tick.json', JSON.stringify(rpTickJson, null, 2));
      for (const [name, data] of Object.entries(rpFunctions)) {
        if (name.toLowerCase() === 'tick.json') continue;
        bpZip.file(`functions/${name}`, data as any);
      }
      if (rpPlayerEntity) {
        bpZip.file('entities/player.json', JSON.stringify(rpPlayerEntity, null, 2));
      }
    }

    const minEngine = highestVersion(groupPacks.map((p) => p.minEngineVersion || '')) || '1.20.0';

    const dependencies: any[] = [];
    if (producedRP && rpHeaderUUID) dependencies.push({ uuid: rpHeaderUUID, version: [1, 0, 0] });

    const modules: any[] = [{ type: 'data', uuid: dataModuleUUID, version: [1, 0, 0] }];
    const resolvedScriptVersion =
      declaredScriptVersion || highestVersion(groupPacks.map((p) => p.scriptApiVersion || ''));

    if (type === 'behavior_script') {
      modules.push({
        type: 'script',
        language: 'javascript',
        uuid: scriptModuleUUID,
        version: [1, 0, 0],
        entry: 'scripts/Stonebyte.js'
      });
      capabilities.add('script_eval');
      if (resolvedScriptVersion) {
        dependencies.push({ module_name: '@minecraft/server', version: resolvedScriptVersion });
      }
      if (uiVersion) dependencies.push({ module_name: '@minecraft/server-ui', version: uiVersion });
      if (gametestVersion) {
        dependencies.push({ module_name: '@minecraft/server-gametest', version: gametestVersion });
      }
    }

    const manifest: any = {
      format_version: 2,
      header: {
        name:
          type === 'behavior_data'
            ? `${modpackName} [BP Data]`
            : major === 0
            ? `${modpackName} [BP Scripted]`
            : `${modpackName} [BP Script API v${major}]`,
        description:
          description || `Merged with AutoBE by StoneByte (${groupPacks.length} behavior packs combined)`,
        uuid: headerUUID,
        version: versionNums,
        min_engine_version: parseVersion(minEngine).nums
      },
      modules,
      dependencies,
      metadata: { authors: [author] }
    };
    if (capabilities.size > 0) manifest.capabilities = [...capabilities];

    bpZip.file('manifest.json', JSON.stringify(manifest, null, 2));
    bpManifests.push(manifest);

    const blobData = await bpZip.generateAsync({ type: 'uint8array' });

    outputs.push({
      id: generateUUID(),
      label:
        type === 'behavior_data'
          ? 'Behavior (Data)'
          : major === 0
          ? 'Behavior (Scripted — version unknown)'
          : `Behavior (Script API v${major})`,
      fileName:
        type === 'behavior_data' ? 'behavior_pack_data.mcpack' : `behavior_pack_v${major || 'unknown'}.mcpack`,
      type,
      scriptMajor: major,
      scriptVersion: resolvedScriptVersion || undefined,
      packCount: groupPacks.length,
      size: blobData.byteLength,
      achievementsDisabled: type === 'behavior_script' || groupPacks.some((p) => p.hasExperimental),
      blob: toZipBlob(blobData)
    });

    bpHeaderUUIDs.push(headerUUID);
  }

  if (plan.dataBp.length > 0) {
    await buildBehaviorPack(plan.dataBp, 'behavior_data', undefined, '');
  }
  for (const g of plan.scriptGroups) {
    await buildBehaviorPack(g.packs, 'behavior_script', g.major, g.scriptVersion);
  }

  if (outputs.length === 0) {
    throw new Error(
      'Nothing could be merged: every selected pack was empty or unreadable. Re-import your .mcpack files.'
    );
  }

  // Link the resource pack back to the first behavior pack (Minecraft uses this
  // to pair a BP with its RP when several BPs share one RP).
  if (producedRP && bpHeaderUUIDs.length > 0) {
    const rpOutput = outputs.find((o) => o.type === 'resource');
    if (rpOutput?.blob) {
      const zip = await JSZip.loadAsync(await rpOutput.blob.arrayBuffer());
      const manifestFile = zip.file('manifest.json');
      if (manifestFile) {
        const manifest = safeParseJson(await manifestFile.async('text'));
        if (manifest) {
          manifest.dependencies = [{ uuid: bpHeaderUUIDs[0], version: [1, 0, 0] }];
          zip.file('manifest.json', JSON.stringify(manifest, null, 2));
          const data = await zip.generateAsync({ type: 'uint8array' });
          rpOutput.blob = toZipBlob(data);
          rpOutput.size = data.byteLength;
        }
      }
    }
  }

  // --- Package everything into one .mcaddon -------------------------------
  onProgress?.('Resolving conflicts', 70);

  const mergeMeta = {
    tool: 'AutoBE Mobile Modpack Tool by StoneByte',
    mergedAt: new Date().toISOString(),
    modpackName,
    version,
    plan: formatPlanSummary(plan),
    identifierResolutions: conflicts.length,
    sourcePacks: loadedPacks.map((p) => ({
      name: p.name,
      type: p.type,
      version: p.version,
      uuid: p.uuid,
      sourceFileName: p.sourceFileName
    }))
  };

  onProgress?.('Building final pack', 85);

  // --- Package every output into ONE .mcaddon -----------------------------
  // Bedrock imports a .mcaddon by reading each .mcpack/.mcaddon entry inside
  // it, so a single file here installs the RP + every BP in one tap.
  // The root holds *only* pack entries; the AutoBE metadata is kept out of the
  // bundle (and mirrored onto the MergedModpack) so the importer never sees an
  // unexpected file.
  const finalZip = new JSZip();
  for (const o of outputs) {
    if (o.blob) finalZip.file(o.fileName, await o.blob.arrayBuffer());
  }

  onProgress?.('Finalizing...', 100);

  const finalBlob = await finalZip.generateAsync({
    type: 'blob',
    // Nested packs are already-compressed zips, but DEFLATE still shrinks the
    // pack containers' own headers/manifests. Keep the outer level cheap.
    compression: 'DEFLATE',
    compressionOptions: { level: 1 }
  });
  const size =
    finalBlob.size > 0 ? finalBlob.size : loadedPacks.reduce((s, p) => s + (p.fileSize || 0), 0);

  return {
    id: generateUUID(),
    name: modpackName,
    totalPacks: loadedPacks.length,
    size,
    version,
    createdAt: Date.now(),
    author,
    description:
      description ||
      `All-in-one Bedrock Modpack created with AutoBE. Combines ${loadedPacks.length} addons.`,
    outputs,
    outputBlob: finalBlob,
    outputFileName: `${modpackName.replace(/\s+/g, '_')}.mcaddon`,
    /** AutoBE metadata, kept outside the .mcaddon so the importer stays clean. */
    mergeManifest: mergeMeta,
    includedPacks: loadedPacks.map((p) => ({
      name: p.name,
      type: p.type,
      version: p.version,
      iconDataUrl: p.iconDataUrl,
      uuid: p.uuid,
      fileSize: p.fileSize,
      dateAdded: p.dateAdded
    }))
  };
}

export { normalizeEngineVersion, sanitizeJsonString };