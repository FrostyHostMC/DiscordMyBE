/**
 * Post-processing validation pass — the reusable, in-engine version of the content-log
 * repairs observed on real broken ports. It runs on the FINAL packs, right before the
 * archive is written, and is idempotent:
 *
 *   1. sound_definitions.json — paths must be pack-root-relative, extensionless, and
 *      every entry must resolve to a file the pack actually ships. Entries pointing at
 *      vanilla sounds the pack does not ship are dropped (reported), never faked.
 *   2. items — `minecraft:icon` must use the modern `{"textures":{"default":...}}` form
 *      under format_version >= 1.21.30; the legacy form is migrated and version bumped.
 *   3. Molang — Java mob-AI queries that do not exist in the target context are stripped
 *      from `||` alternatives; an expression left empty falls back to `0`. The deny set
 *      grows from content-log learning (see learnFromContentLog).
 *   4. manifests — `min_engine_version` is raised, `@minecraft/*` script-module versions
 *      are aligned/fixed from learned data, modules imported by scripts are declared, and
 *      declared-but-unused optional modules are removed.
 *   5. Reference integrity — duplicate animation/controller ids are collapsed (identical
 *      copies removed, conflicting definitions reported), controller states referencing
 *      missing animations are reported, and a pack that ships animations without any
 *      client entity file registering them raises an explicit wiring warning.
 *
 * Content-log learning (`learnFromContentLog`) parses the game's content log text and
 * grows the deny-query set and module version fixes, so error types from NEW mods are
 * repaired without hand-writing a rule per mod.
 */

import {
  repairBlockSoundTypes,
  repairParticleDocuments,
  repairTextureSetVersions,
} from '@/utils/contentLogRepairs';
import { resolveScriptDependencySet } from '@/utils/scriptDependencySet';
import { enforceItemIconsAndBlockGeometry } from '@/utils/itemIconAtlas';
import { generateMissingClientEntities } from '@/utils/clientEntityGenerator';
import type { ItemModelBehavior } from '@/utils/itemModelNormalizer';

export interface PostProcessReport {
  soundEntriesFixed: number;
  soundDefinitionsDropped: number;
  iconsFixed: number;
  molangExpressionsRepaired: number;
  molangFilesTouched: string[];
  manifestsAdjusted: number;
  /** Learned query names that are now stripped from generated expressions. */
  learnedQueriesApplied: string[];
  /** Script-module version repairs applied from learned content-log data. */
  moduleFixesApplied: string[];
  /** Script modules imported by shipped scripts but missing from the manifest (now declared). */
  modulesDeclared: string[];
  /** Declared-but-unused optional script modules removed from the manifest. */
  modulesRemoved: string[];
  /** Identical duplicate animation/controller ids collapsed across files. */
  duplicateIdsRemoved: number;
  /** Controller states that reference an animation the pack does not define. */
  danglingAnimationRefs: string[];
  /** Packs that ship animations no client entity file registers. */
  wiringWarnings: string[];
  /** textures/item_texture.json entries pointing at texture files the pack does not ship. */
  missingAtlasTextures: string[];
  /** Item icons referencing a shortname the atlas never registers. */
  unregisteredItemIcons: string[];
  /** Geometry shipped but referenced by no client entity or attachable. */
  unusedGeometry: string[];
  /** Geometry texture_width/height conflicting with the shipped texture size (UV breakage). */
  uvMismatchWarnings: string[];
  /** Behavior entities with no client entity counterpart (invisible models). */
  missingClientEntities: string[];
  /** Client entities with no matching behavior entity. */
  orphanClientEntities: string[];
  /** Spawnable mobs whose client entity defines no spawn_egg. */
  missingSpawnEggs: string[];
  /** Both textures/item and textures/items shipped — Bedrock only reads textures/items. */
  duplicateTextureFolders: string[];
  /** Legacy textures/item files automatically migrated to textures/items. */
  textureFolderMigrations: string[];
  /** References rewritten from textures/item/… to textures/items/… (atlas + JSON). */
  textureReferencesUpdated: number;
  /** Migrations blocked because a different file already occupies the destination path. */
  textureFolderConflicts: string[];
  /** Armor layer sheets shipped under textures/models/armor/. */
  armorSheetsShipped: string[];
  /** Attachable definitions verified as correctly bound to an armor layer sheet. */
  armorAttachablesBound: number;
  /** Armor attachable/texture binding defects: missing textures, bad geometry, invalid layer names. */
  armorAttachableIssues: string[];
  /** Armor sheets that ship with no attachable or client entity referencing them (never render). */
  orphanArmorSheets: string[];
  /** `particles/*.json` documents re-rooted under minecraft:particle_effect. */
  particleDocumentsRepaired?: number;
  /** Particle documents dropped because no Bedrock effect could be expressed from them. */
  particleDocumentsDropped?: string[];
  /** Java sprite declarations removed from particles/ (they declare textures, not effects). */
  particleTextureDeclarationsRemoved?: string[];
  /** Particle effects whose render texture was bound to a sprite this pack really ships. */
  particleTexturesBound?: string[];
  /** Particle effects still naming a sprite the pack does not ship (reported, never invented). */
  particleTexturesUnresolved?: string[];
  /** texture-set documents whose format_version was set to a version the texture schema reads. */
  textureSetVersionsFixed?: number;
  /** blocks.json sound entries remapped onto a Bedrock block-sound name. */
  blockSoundTypesFixed?: number;
  /** Item icons that still resolve to no shipped sheet after reconciliation (never invented). */
  itemIconsUnresolved?: string[];
  /** Atlas registrations, carried sheets and phantom entries reconciled by the icon pass. */
  atlasReconciled?: number;
  /** Behavior entities that gained the client entity file binding a shipped model + skin. */
  clientEntitiesGenerated?: number;
  /** Behavior entities left without a client entity because no model or skin ships for them. */
  clientEntitiesUnresolved?: string[];
  /** Block-backed Java item models that ship no block definition, so the cube cannot render. */
  blockBackedItemsWithoutBlock?: string[];
}

export interface ContentLogLearning {
  /** New deny-queries learned from this log text (not previously known). */
  queries: string[];
  /** Script modules whose invalid versions were learned from this log text. */
  modules: string[];
}

export interface PostProcessOptions {
  modId: string;
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles: Record<string, string | Uint8Array>;
  /** Item models classified from the Java source's own parent pointers, when available. */
  itemModels?: Map<string, ItemModelBehavior> | null;
  onLog?: (line: string) => void;
}

/** Base allow-list work-list: Java mob-AI queries with no Bedrock equivalent in the
 *  contexts this engine writes. Extend only with confirmed content-log evidence. */
const BASE_UNSUPPORTED_QUERIES = [
  'query.target_distance',
  'query.has_target',
  'query.has_line_of_sight',
];

/** Learned deny-queries, grown from real content logs (session-persistent). */
const learnedDenyQueries = new Set<string>();
/** Learned script-module version fixes: module → requested bad version + available list. */
const learnedModuleFixes = new Map<string, { requested: string; available: string[] }>();

const SOUND_EXTS = ['.ogg', '.wav', '.fsb', '.mp3'];
const MIN_ENGINE_VERSION = [1, 21, 50];
const MODULE_IMPORT_RE = /from\s+['"](@minecraft\/[\w-]+)['"]/g;
const MODULE_INVALID_VERSION_RE =
  /requested invalid version \[([^\]]+)\] of \[(@minecraft\/[\w-]+)\]\.?\s*Available versions:\s*([\w.\-\s]+)/g;

// Module versions come from the shared per-module authority (scriptModuleVersions): a module
// with no verified version list is reported, never guessed at.

/** Optional modules safe to drop from the manifest when no shipped script imports them. */
const REMOVABLE_MODULES = new Set(['@minecraft/server-ui']);

function parseJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function compareVersionTriples(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareVersionStrings(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  return compareVersionTriples(pa, pb);
}

function versionKey(version: string): number[] {
  return version.split('-')[0].match(/\d+/g)?.map((n) => parseInt(n, 10)) ?? [0];
}

/** Pick the highest stable available version sharing the requested major, else the highest available. */
function pickVersion(requested: string, available: string[]): string {
  const stable = available.filter((v) => !v.includes('-'));
  const pool = stable.length > 0 ? stable : available;
  const requestedMajor = versionKey(requested)[0];
  const sameMajor = pool.filter((v) => versionKey(v)[0] === requestedMajor);
  const candidates = sameMajor.length > 0 ? sameMajor : pool;
  return [...candidates].sort(compareVersionStrings)[candidates.length - 1];
}

/** All queries currently denied: the base list plus everything learned from content logs. */
function unsupportedQueries(): string[] {
  return [...BASE_UNSUPPORTED_QUERIES, ...learnedDenyQueries];
}

/**
 * Learn from a Bedrock content log: failed Molang queries are added to the deny set and
 * invalid script-module version requests record the versions the engine actually accepts.
 * Returns only what was NEW in this log, so callers can report it.
 */
export function learnFromContentLog(text: string): ContentLogLearning {
  const queries: string[] = [];
  for (const match of text.matchAll(/Failed to resolve query (query\.\w+)/g)) {
    if (!learnedDenyQueries.has(match[1])) {
      learnedDenyQueries.add(match[1]);
      queries.push(match[1]);
    }
  }
  const modules: string[] = [];
  for (const match of text.matchAll(MODULE_INVALID_VERSION_RE)) {
    const available = match[3].trim().split(/\s+/).filter((v) => /^[\w.-]+$/.test(v));
    if (available.length === 0) continue;
    learnedModuleFixes.set(match[2], { requested: match[1], available });
    if (!modules.includes(match[2])) modules.push(match[2]);
  }
  return { queries, modules };
}

/** Queries the engine currently strips (base list + learned), for display. */
export function getLearnedDenyQueries(): string[] {
  return [...learnedDenyQueries];
}

/** 1. Sound definitions: normalise paths, then drop entries whose audio is absent. */
function fixSoundDefinitions(
  rp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
  log: (line: string) => void,
): void {
  const key = 'sounds/sound_definitions.json';
  const doc = parseJson(rp[key] as string | undefined) as
    | { sound_definitions?: Record<string, { sounds?: Array<string | { name?: string }> }> }
    | null;
  if (!doc?.sound_definitions) return;

  const shipped = new Set(
    Object.keys(rp)
      .map((path) => path.replace(/\\/g, '/').toLowerCase())
      .filter((path) => SOUND_EXTS.some((ext) => path.endsWith(ext))),
  );

  for (const name of Object.keys(doc.sound_definitions)) {
    const definition = doc.sound_definitions[name];
    const fixed: Array<string | { name?: string }> = [];
    for (const entry of definition.sounds ?? []) {
      const isDict = typeof entry === 'object' && entry !== null;
      let path = (isDict ? (entry as { name?: string }).name : (entry as string)) ?? '';
      if (!path) continue;
      if (!path.startsWith('sounds/')) path = `sounds/${path}`;
      path = path.replace(/\.(ogg|wav|fsb|mp3)$/i, '');
      const exists = SOUND_EXTS.some((ext) => shipped.has(`${path}${ext}`));
      if (!exists) {
        report.soundDefinitionsDropped += 1;
        log(`[POSTFIX] Dropped sound "${name}" reference "${path}" — the audio file is not shipped in this pack (Java mods often point at vanilla sounds; vanilla Bedrock sound IDs are not invented here).`);
        continue;
      }
      report.soundEntriesFixed += 1;
      fixed.push(isDict ? { ...(entry as { name?: string }), name: path } : path);
    }
    if (fixed.length > 0) {
      definition.sounds = fixed;
    } else {
      delete doc.sound_definitions[name];
    }
  }
  rp[key] = JSON.stringify({ format_version: '1.14.0', sound_definitions: doc.sound_definitions }, null, 2);
}

/** 2. Item icons: migrate the legacy icon form to the 1.21.30+ schema. */
function fixItemIcons(
  bp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
): void {
  for (const key of Object.keys(bp)) {
    if (!key.startsWith('items/') || !key.endsWith('.json')) continue;
    const doc = parseJson(bp[key] as string | undefined) as
      | { format_version?: string; 'minecraft:item'?: { components?: Record<string, unknown> } }
      | null;
    const components = doc?.['minecraft:item']?.components;
    const icon = components?.['minecraft:icon'];
    if (!components || icon == null) continue;

    let textureName: string | undefined;
    let needsModernForm = false;
    if (typeof icon === 'string') {
      textureName = icon;
      needsModernForm = true;
    } else if (typeof icon === 'object' && 'texture' in (icon as Record<string, unknown>)) {
      textureName = (icon as { texture?: string }).texture;
      needsModernForm = true;
    } else if (typeof icon === 'object') {
      // Already in the modern form: only the format_version may still be too old for it.
      const modern = (icon as { textures?: { default?: unknown } }).textures?.default;
      if (typeof modern === 'string') textureName = modern;
    }
    if (!textureName) continue;
    let changed = false;
    if (needsModernForm) {
      components['minecraft:icon'] = { textures: { default: textureName } };
      changed = true;
    }
    const version = (doc?.format_version ?? '1.20.80').split('.').map((n) => parseInt(n, 10));
    if (compareVersionTriples(version, [1, 21, 30]) < 0) {
      doc!.format_version = '1.21.50';
      changed = true;
    }
    if (!changed) continue;
    bp[key] = JSON.stringify(doc, null, 2);
    report.iconsFixed += 1;
  }
}

/** 3. Molang: strip alternatives that use queries unsupported in this context. */
function stripUnsupportedQueries(expression: string, queries: string[]): string | null {
  if (!queries.some((query) => expression.includes(query))) return null;
  const kept = expression
    .split(/\s*\|\|\s*/)
    .filter((term) => !queries.some((query) => term.includes(query)));
  return kept.length > 0 ? kept.join(' || ').trim() : '0';
}

function walkMolang(node: unknown, report: PostProcessReport, queries: string[]): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const value = node[i];
      if (typeof value === 'string') {
        const repaired = stripUnsupportedQueries(value, queries);
        if (repaired !== null) {
          node[i] = repaired;
          report.molangExpressionsRepaired += 1;
        }
      } else walkMolang(value, report, queries);
    }
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const repaired = stripUnsupportedQueries(value, queries);
        if (repaired !== null) {
          (node as Record<string, unknown>)[key] = repaired;
          report.molangExpressionsRepaired += 1;
        }
      } else walkMolang(value, report, queries);
    }
  }
}

function fixMolangInDirectory(
  files: Record<string, string | Uint8Array>,
  directory: string,
  report: PostProcessReport,
  queries: string[],
): void {
  for (const key of Object.keys(files)) {
    if (!key.startsWith(`${directory}/`) || !key.endsWith('.json')) continue;
    const doc = parseJson(files[key] as string | undefined);
    if (!doc) continue;
    const before = report.molangExpressionsRepaired;
    walkMolang(doc, report, queries);
    if (report.molangExpressionsRepaired > before) {
      files[key] = JSON.stringify(doc, null, 2);
      report.molangFilesTouched.push(key);
    }
  }
}

/** Script modules imported by shipped behavior-pack scripts. */
function importedScriptModules(bp: Record<string, string | Uint8Array>): Set<string> {
  const imported = new Set<string>();
  for (const key of Object.keys(bp)) {
    if (!key.startsWith('scripts/') || !/\.(js|mjs|ts)$/.test(key)) continue;
    const text = typeof bp[key] === 'string' ? (bp[key] as string) : '';
    for (const match of text.matchAll(MODULE_IMPORT_RE)) imported.add(match[1]);
  }
  return imported;
}

/** 4. Manifests: engine version, module versions, and module declaration hygiene. */
function fixManifests(
  bp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
  log: (line: string) => void,
): void {
  const doc = parseJson(bp['manifest.json'] as string | undefined) as
    | {
        header?: { min_engine_version?: number[] };
        dependencies?: Array<{ module_name?: string; version?: string }>;
      }
    | null;
  if (!doc?.header) return;
  let changed = false;
  const current = doc.header.min_engine_version ?? [1, 20, 0];
  if (compareVersionTriples(current, MIN_ENGINE_VERSION) < 0) {
    doc.header.min_engine_version = [...MIN_ENGINE_VERSION];
    changed = true;
  }
  const deps = doc.dependencies ?? [];

  // Learned fixes: the engine itself reported these module versions as invalid.
  for (const [moduleName, fix] of learnedModuleFixes) {
    const dep = deps.find((d) => d.module_name === moduleName);
    if (dep && dep.version === fix.requested) {
      const next = pickVersion(fix.requested, fix.available);
      dep.version = next;
      report.moduleFixesApplied.push(`${moduleName} ${fix.requested} -> ${next}`);
      log(`[POSTFIX] Manifest module "${moduleName}" version ${fix.requested} was rejected by the engine — set to accepted version ${next} (learned from content log).`);
      changed = true;
    }
  }

  // One coherent script-module set for the WHOLE behavior pack. Each module is pinned to a
  // version IT publishes, a derived module mirrors the module it belongs to, a module whose
  // major needs a newer engine than this pack's floor is walked back, and a module this engine
  // has no verified list for is reported instead of guessed at or silently deleted.
  const resolvedSet = resolveScriptDependencySet({
    dependencies: deps,
    importedModules: [...importedScriptModules(bp)],
    minEngineVersion: doc.header.min_engine_version ?? MIN_ENGINE_VERSION,
    removableModules: [...REMOVABLE_MODULES],
  });
  for (const fix of resolvedSet.fixes) {
    report.moduleFixesApplied.push(fix);
    log(`[POSTFIX] Manifest: ${fix}`);
  }
  for (const note of resolvedSet.reports) log(`[POSTFIX:WARN] Manifest: ${note}`);
  for (const moduleName of resolvedSet.declared) {
    report.modulesDeclared.push(moduleName);
    log(`[POSTFIX] Manifest: shipped scripts import "${moduleName}" but the manifest never declared it — added at the version that module publishes.`);
  }
  for (const moduleName of resolvedSet.removed) {
    report.modulesRemoved.push(moduleName);
    log(`[POSTFIX] Manifest: removed declared but unused optional module "${moduleName}".`);
  }
  if (resolvedSet.changed) {
    doc.dependencies = resolvedSet.dependencies;
    changed = true;
  }

  if (changed) {
    bp['manifest.json'] = JSON.stringify(doc, null, 2);
    report.manifestsAdjusted += 1;
  }
}

/** 5. Reference integrity: duplicate ids, dangling animation refs, entity wiring. */
function checkReferenceIntegrity(
  rp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
  log: (line: string) => void,
): void {
  const jsonIn = (dir: string) =>
    Object.keys(rp).filter((key) => key.startsWith(`${dir}/`) && key.endsWith('.json')).sort();

  // Collapse IDENTICAL duplicate ids; conflicting definitions are reported, never merged.
  for (const [dir, collection] of [['animation_controllers', 'animation_controllers'], ['animations', 'animations']] as const) {
    const seen = new Map<string, { file: string; body: string }>();
    for (const key of jsonIn(dir)) {
      const doc = parseJson(rp[key] as string | undefined) as Record<string, Record<string, unknown>> | null;
      const group = doc?.[collection];
      if (!group || typeof group !== 'object') continue;
      let changed = false;
      for (const id of Object.keys(group)) {
        const body = JSON.stringify(group[id]);
        const prior = seen.get(id);
        if (!prior) {
          seen.set(id, { file: key, body });
        } else if (prior.body === body) {
          delete group[id];
          report.duplicateIdsRemoved += 1;
          changed = true;
          log(`[POSTFIX] Removed identical duplicate ${collection} id "${id}" from ${key} (already defined in ${prior.file}).`);
        } else {
          log(`[POSTFIX:WARN] ${collection} id "${id}" is defined DIFFERENTLY in ${prior.file} and ${key} — both kept for manual review, no automatic merge.`);
        }
      }
      if (changed) rp[key] = JSON.stringify(doc, null, 2);
    }
  }

  // Collect defined animation ids and check controller state references resolve.
  const definedAnimations = new Set<string>();
  for (const key of jsonIn('animations')) {
    const doc = parseJson(rp[key] as string | undefined) as { animations?: Record<string, unknown> } | null;
    for (const id of Object.keys(doc?.animations ?? {})) definedAnimations.add(id);
  }
  for (const key of jsonIn('animation_controllers')) {
    const doc = parseJson(rp[key] as string | undefined) as
      | { animation_controllers?: Record<string, { states?: Record<string, { animations?: Array<string | Record<string, unknown>> }> }> }
      | null;
    const controllers = doc?.animation_controllers;
    if (!controllers) continue;
    for (const [controllerId, controller] of Object.entries(controllers)) {
      for (const [stateName, state] of Object.entries(controller.states ?? {})) {
        for (const entry of state.animations ?? []) {
          const animId = typeof entry === 'string' ? entry : Object.keys(entry)[0];
          if (animId && !definedAnimations.has(animId)) {
            report.danglingAnimationRefs.push(`${controllerId}/${stateName} -> ${animId}`);
            log(`[POSTFIX:WARN] Controller "${controllerId}" state "${stateName}" references animation "${animId}", which no animation file in the pack defines — it will never play.`);
          }
        }
      }
    }
  }

  // Wiring guard: animations that exist but no client entity file registers never play.
  const entityKeys = jsonIn('entity');
  const wiredText = entityKeys
    .map((key) => (typeof rp[key] === 'string' ? (rp[key] as string) : ''))
    .join('\n');
  const sample = [...definedAnimations].slice(0, 50);
  const anyWired = sample.some((id) => wiredText.includes(id));
  if (definedAnimations.size > 0 && !anyWired) {
    report.wiringWarnings.push(
      `Pack defines ${definedAnimations.size} animation(s) but no entity/*.entity.json file registers them — generate an entity/<target>.entity.json with "animations" + "scripts.animate" or the clips will never play.`,
    );
    log('[POSTFIX:WARN] Animations exist but NO client entity file registers them -> they will never play. Generate entity/<target>.entity.json (e.g. player) with animations + scripts.animate.');
  }
}

/** Read the width/height out of a PNG IHDR header (binary pack files only). */
function pngSize(data: unknown): [number, number] | null {
  if (!(data instanceof Uint8Array) || data.byteLength < 24) return null;
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/**
 * 5.5 Automated Texture Normalization: Bedrock reads item icons only from
 * `textures/items`, and mob skins only from `textures/entity` — but Java mods ship
 * several legacy layouts. Each rule moves one legacy directory tree to its canonical
 * Bedrock location:
 *   a. every file under the legacy prefix is MOVED to the canonical prefix (idempotent,
 *      and non-destructive when a different file already occupies the destination);
 *   b. every JSON reference to the legacy path (item_texture.json / terrain_texture.json
 *      atlas values, entity / attachable / render-controller texture paths, geometry
 *      references) is rewritten to the new location.
 * Conflicting destinations are never overwritten — they are reported instead.
 */
interface TextureFolderRule {
  /** Normalized legacy directory prefix, e.g. "textures/item/" or "textures/entity/mob/". */
  legacy: string;
  /** Canonical Bedrock prefix the files move to, e.g. "textures/items/". */
  canonical: string;
  /** Human-readable reason surfaced in the diagnostic log. */
  reason: string;
  /** Whether atlas JSON values may drop the "textures/" prefix (item/terrain atlases). */
  atlasShort?: { from: string; to: string };
}

const TEXTURE_FOLDER_RULES: TextureFolderRule[] = [
  {
    legacy: 'textures/item/',
    canonical: 'textures/items/',
    reason: 'Bedrock reads item icons only from textures/items',
    atlasShort: { from: 'item/', to: 'items/' },
  },
  {
    legacy: 'textures/entity/mob/',
    canonical: 'textures/entity/',
    reason: 'Bedrock resolves mob skins from textures/entity, not the nested legacy textures/entity/mob layout',
  },
  {
    legacy: 'textures/entity/hostile/',
    canonical: 'textures/entity/',
    reason: 'Bedrock resolves hostile-mob skins from textures/entity, not a legacy hostile subfolder',
  },
  {
    legacy: 'textures/entity/passive/',
    canonical: 'textures/entity/',
    reason: 'Bedrock resolves passive-mob skins from textures/entity, not a legacy passive subfolder',
  },
  {
    legacy: 'textures/models/entity/',
    canonical: 'textures/entity/',
    reason: 'Bedrock resolves entity skins from textures/entity, not the legacy Java textures/models/entity layout',
  },
  {
    legacy: 'textures/models/mob/',
    canonical: 'textures/entity/',
    reason: 'Bedrock resolves mob skins from textures/entity, not the legacy Java textures/models/mob layout',
  },
  {
    legacy: 'textures/gui/containers/',
    canonical: 'textures/gui/',
    reason: 'Bedrock reads GUI textures from the flat textures/gui directory, not nested container subfolders',
  },
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeTextureFolders(
  rp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
  log: (line: string) => void,
): void {
  // Normalize separators once per pass so Windows-style keys are matched too.
  for (const key of Object.keys(rp)) {
    const normalized = key.replace(/\\/g, '/');
    if (normalized !== key) {
      rp[normalized] = rp[key];
      delete rp[key];
    }
  }

  const rpKeysLower = () => new Set(Object.keys(rp).map((path) => path.replace(/\\/g, '/').toLowerCase()));

  // a. Move every legacy file under each rule's legacy prefix to the canonical prefix.
  for (const rule of TEXTURE_FOLDER_RULES) {
    const legacyKeys = Object.keys(rp).filter((key) => key.toLowerCase().startsWith(rule.legacy));
    for (const key of legacyKeys) {
      const target = rule.canonical + key.slice(rule.legacy.length);
      if (rpKeysLower().has(target.toLowerCase())) {
        report.textureFolderConflicts.push(`${key} -> ${target}`);
        log(`[POSTFIX:WARN] Legacy texture "${key}" could not be auto-migrated: "${target}" already ships with different content — both kept, no overwrite. Reconcile manually.`);
        continue;
      }
      rp[target] = rp[key];
      delete rp[key];
      report.textureFolderMigrations.push(target);
      log(`[POSTFIX] Texture normalization: moved "${key}" -> "${target}" (${rule.reason}).`);
    }
  }
  if (report.textureFolderMigrations.length === 0) return;

  // b. Rewrite references in JSON files: item_texture.json atlas values first, then any
  //    other JSON that embeds the legacy path prefix.
  for (const key of Object.keys(rp)) {
    if (!key.endsWith('.json') || typeof rp[key] !== 'string') continue;
    const doc = parseJson(rp[key] as string);
    if (doc == null) continue;
    let updates = 0;
    const isAtlas = key === 'textures/item_texture.json' || key === 'textures/terrain_texture.json';
    const rewrite = (value: string): string => {
      let next = value;
      for (const rule of TEXTURE_FOLDER_RULES) {
        const pattern = new RegExp(`(^|["'\\s(])${escapeRegExp(rule.legacy)}`, 'gi');
        next = next.replace(pattern, `$1${rule.canonical}`);
      }
      if (isAtlas) {
        for (const rule of TEXTURE_FOLDER_RULES) {
          if (!rule.atlasShort) continue;
          const pattern = new RegExp(`(^|["'\\s(])${escapeRegExp(rule.atlasShort.from)}`, 'gi');
          next = next.replace(pattern, `$1${rule.atlasShort.to}`);
        }
      }
      return next;
    };
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
          if (typeof node[i] === 'string') {
            const next = rewrite(node[i] as string);
            if (next !== node[i]) { node[i] = next; updates += 1; }
          } else walk(node[i]);
        }
        return;
      }
      if (typeof node === 'object' && node !== null) {
        for (const [entryKey, value] of Object.entries(node as Record<string, unknown>)) {
          if (typeof value === 'string') {
            const next = rewrite(value);
            if (next !== value) { (node as Record<string, unknown>)[entryKey] = next; updates += 1; }
          } else walk(value);
        }
      }
    };
    walk(doc);
    if (updates > 0) {
      rp[key] = JSON.stringify(doc, null, 2);
      report.textureReferencesUpdated += updates;
      log(`[POSTFIX] Texture normalization: rewrote ${updates} legacy "textures/item/" reference(s) in ${key} to the new textures/items location.`);
    }
  }
}

/**
 * 5.6 Armor Mapping Validation — `textures/models/armor` binds to Bedrock attachables:
 *   a. every shipped armor layer sheet is inventoried; names not following Bedrock's
 *      `<material>_layer_1/2.png` convention are reported (the armor renderer reads only
 *      layer_1/layer_2 endings);
 *   b. every attachable definition is verified: identifier present, textures.default resolves
 *      to a file the pack actually ships, and a geometry + render controller are declared;
 *   c. any armor sheet referenced by NO attachable and NO client entity is reported as an
 *      orphan — the texture ships but nothing renders it.
 * This pass is diagnostic-only: it never invents attachables or textures here (the
 * generation-time shipArmorAttachables pass is what creates them from source evidence).
 */
const ARMOR_SHEET_RE = /^textures\/models\/armor\/[a-z0-9_.\-]+_layer_(1|2)\.png$/;

function checkArmorAttachables(
  rp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
  log: (line: string) => void,
): void {
  const shipped = new Set(Object.keys(rp).map((path) => path.replace(/\\/g, '/').toLowerCase()));
  const sheetKeys = [...shipped].filter((path) => path.startsWith('textures/models/armor/') && path.endsWith('.png'));
  if (sheetKeys.length === 0) return;

  for (const key of sheetKeys.sort()) {
    report.armorSheetsShipped.push(key);
    if (!ARMOR_SHEET_RE.test(key)) {
      report.armorAttachableIssues.push(`${key}: armor sheet name does not follow Bedrock's <material>_layer_1/2.png convention`);
      log(`[POSTFIX:WARN] Armor texture "${key}" does not end in _layer_1 or _layer_2 — Bedrock's armor renderer only reads those two endings, so the sheet will not render as worn armor.`);
    }
  }

  const referencingText: string[] = [];
  const attachableKeys = Object.keys(rp)
    .filter((key) => key.startsWith('attachables/') && key.endsWith('.json'))
    .sort();
  for (const key of attachableKeys) {
    const doc = parseJson(rp[key] as string | undefined) as
      | { 'minecraft:attachable'?: { description?: { identifier?: string; textures?: { default?: string }; geometry?: { default?: string }; render_controllers?: string[] } } }
      | null;
    const description = doc?.['minecraft:attachable']?.description;
    referencingText.push(typeof rp[key] === 'string' ? (rp[key] as string) : '');
    if (!description) {
      report.armorAttachableIssues.push(`${key}: not a valid minecraft:attachable definition (no description)`);
      log(`[POSTFIX:WARN] ${key} has no minecraft:attachable description — the file is ignored by the engine.`);
      continue;
    }
    if (!description.identifier) {
      report.armorAttachableIssues.push(`${key}: attachable has no identifier`);
      log(`[POSTFIX:WARN] ${key} declares no identifier — no wearable item can bind to it.`);
    }
    const texture = description.textures?.default;
    if (!texture) {
      report.armorAttachableIssues.push(`${key}: textures.default is missing`);
      log(`[POSTFIX:WARN] ${key} declares no default texture — the armor piece renders invisible even if the item works.`);
    } else {
      const normalized = texture.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
      const resolved = ['.png', '.tga'].some((ext) => shipped.has(`${normalized}${ext}`)) || shipped.has(normalized);
      if (!resolved) {
        report.armorAttachableIssues.push(`${key}: textures.default "${texture}" does not resolve to a shipped texture`);
        log(`[POSTFIX:WARN] ${key} points at texture "${texture}" but no such file ships in the pack — the armor renders with the unknown texture.`);
      }
    }
    if (!description.geometry?.default) {
      report.armorAttachableIssues.push(`${key}: geometry.default is missing`);
      log(`[POSTFIX:WARN] ${key} declares no geometry — the armor piece cannot attach to the player skeleton.`);
    }
    if (!description.render_controllers || description.render_controllers.length === 0) {
      report.armorAttachableIssues.push(`${key}: no render controller declared (expected controller.render.armor)`);
      log(`[POSTFIX:WARN] ${key} declares no render controller — the attachable exists but nothing tells the engine to draw it.`);
    }
    if (report.armorAttachableIssues.every((issue) => !issue.startsWith(`${key}:`))) {
      report.armorAttachablesBound += 1;
      log(`[POSTFIX] Armor mapping verified: ${key} binds to ${texture} with ${description.geometry?.default} and a render controller.`);
    }
  }

  const allText = [...referencingText, ...Object.keys(rp)
    .filter((key) => key.startsWith('entity/') && key.endsWith('.json') && typeof rp[key] === 'string')
    .map((key) => rp[key] as string)].join('\n').toLowerCase();
  for (const key of report.armorSheetsShipped) {
    const stem = key.replace(/\.png$/, '');
    if (!allText.includes(stem) && !allText.includes(stem.split('/').pop() ?? '')) {
      report.orphanArmorSheets.push(key);
      log(`[POSTFIX:WARN] Armor sheet "${key}" ships but NO attachable or client entity references it — the texture is dead weight and the armor piece it belongs to will not render. Generate attachables/<item>.attachable.json bindings for it.`);
    }
  }
}

/** 6. Asset integrity: atlas coverage, icon registration, geometry usage, UV sizes, mob pairing. */
function checkAssetIntegrity(
  rp: Record<string, string | Uint8Array>,
  bp: Record<string, string | Uint8Array>,
  report: PostProcessReport,
  log: (line: string) => void,
): void {
  const shipped = new Set(
    Object.keys(rp).map((path) => path.replace(/\\/g, '/').toLowerCase()),
  );
  const existsInRp = (path: string, exts: string[]) =>
    exts.some((ext) => shipped.has(`${path.replace(/\\/g, '/').toLowerCase()}${ext}`));
  const jsonIn = (files: Record<string, string | Uint8Array>, dir: string) =>
    Object.keys(files).filter((key) => key.startsWith(`${dir}/`) && key.endsWith('.json')).sort();

  // Atlas coverage: every texture_data path must resolve to a file the pack ships.
  const atlasKey = 'textures/item_texture.json';
  const atlas = parseJson(rp[atlasKey] as string | undefined) as
    | { texture_data?: Record<string, { textures?: string | string[] }> }
    | null;
  const atlasEntries = atlas?.texture_data ?? {};
  for (const [shortName, entry] of Object.entries(atlasEntries)) {
    const paths = Array.isArray(entry.textures) ? entry.textures : [entry.textures];
    for (const path of paths) {
      if (typeof path === 'string' && !existsInRp(path, ['.png', '.tga'])) {
        report.missingAtlasTextures.push(`${shortName} -> ${path}`);
        log(`[POSTFIX:WARN] item_texture.json entry "${shortName}" points at missing texture "${path}" — the icon will render as the unknown texture in game.`);
      }
    }
  }

  // Item icons must be registered in the atlas or the creative menu shows nothing.
  for (const key of jsonIn(bp, 'items')) {
    const doc = parseJson(bp[key] as string | undefined) as
      | { 'minecraft:item'?: { components?: { 'minecraft:icon'?: { textures?: { default?: string } } } } }
      | null;
    const icon = doc?.['minecraft:item']?.components?.['minecraft:icon']?.textures?.default;
    if (icon && !atlasEntries[icon]) {
      report.unregisteredItemIcons.push(`${key} -> ${icon}`);
      log(`[POSTFIX:WARN] Item ${key} uses icon "${icon}" but textures/item_texture.json never registers that shortname — add a texture_data entry or the icon will be blank.`);
    }
  }

  // Geometry must be referenced by a client entity or attachable, and its declared
  // texture size must match the shipped texture or every UV lands in the wrong place.
  const usedText = [...jsonIn(rp, 'entity'), ...jsonIn(rp, 'attachables')]
    .map((key) => (typeof rp[key] === 'string' ? (rp[key] as string) : ''))
    .join('\n');
  for (const key of jsonIn(rp, 'models')) {
    const doc = parseJson(rp[key] as string | undefined) as
      | { 'minecraft:geometry'?: Array<{ description?: { identifier?: string; texture_width?: number; texture_height?: number } }> }
      | null;
    for (const geometry of doc?.['minecraft:geometry'] ?? []) {
      const description = geometry.description;
      if (!description?.identifier) continue;
      if (!usedText.includes(description.identifier)) {
        report.unusedGeometry.push(description.identifier);
        log(`[POSTFIX:WARN] Geometry "${description.identifier}" (${key}) is not used by any client entity or attachable — the model will never render.`);
      }
      const stem = key.split('/').pop()?.replace(/\.geo\.json$/i, '').replace(/\.json$/i, '') ?? '';
      for (const dir of ['entity', 'items', 'item', 'attachables']) {
        const size = pngSize(rp[`textures/${dir}/${stem}.png`]);
        if (size && dir !== 'items' && dir !== 'item' &&
            (description.texture_width !== size[0] || description.texture_height !== size[1])) {
          report.uvMismatchWarnings.push(
            `${description.identifier}: geo declares ${description.texture_width}x${description.texture_height} but ${dir}/${stem}.png is ${size[0]}x${size[1]}`,
          );
          log(`[POSTFIX:WARN] Geometry "${description.identifier}" declares texture ${description.texture_width}x${description.texture_height} but ${dir}/${stem}.png is ${size[0]}x${size[1]} — UVs will be wrong unless the geometry matches the real sheet.`);
        }
      }
    }
  }

  // Mob pairing: every behavior entity needs a client entity, and vice versa.
  const behaviorIds = new Map<string, { spawnable: boolean }>();
  for (const key of jsonIn(bp, 'entities')) {
    const doc = parseJson(bp[key] as string | undefined) as
      | { 'minecraft:entity'?: { description?: { identifier?: string; is_spawnable?: boolean } } }
      | null;
    const description = doc?.['minecraft:entity']?.description;
    if (description?.identifier) {
      behaviorIds.set(description.identifier, { spawnable: description.is_spawnable === true });
    }
  }
  const clientIds = new Set<string>();
  for (const key of jsonIn(rp, 'entity')) {
    const doc = parseJson(rp[key] as string | undefined) as
      | { 'minecraft:client_entity'?: { description?: { identifier?: string; spawn_egg?: unknown } } }
      | null;
    const description = doc?.['minecraft:client_entity']?.description;
    if (!description?.identifier) continue;
    clientIds.add(description.identifier);
    const behavior = behaviorIds.get(description.identifier);
    if (behavior?.spawnable && !('spawn_egg' in description)) {
      report.missingSpawnEggs.push(description.identifier);
      log(`[POSTFIX:WARN] Mob "${description.identifier}" is spawnable but its client entity defines no spawn_egg — no spawn egg will appear in the creative menu.`);
    }
  }
  for (const id of behaviorIds.keys()) {
    if (!clientIds.has(id)) {
      report.missingClientEntities.push(id);
      log(`[POSTFIX:WARN] Mob "${id}" has behavior but NO client entity — it will render as an invisible/unknown model in game.`);
    }
  }
  for (const id of clientIds) {
    if (!behaviorIds.has(id)) {
      report.orphanClientEntities.push(id);
      log(`[POSTFIX:WARN] Client entity "${id}" has no matching behavior entity — the pairing is incomplete and the mob cannot be summoned.`);
    }
  }

  // Duplicate texture folders: Bedrock reads item icons only from textures/items.
  const hasItemFolder = [...shipped].some((path) => path.startsWith('textures/item/'));
  const hasItemsFolder = [...shipped].some((path) => path.startsWith('textures/items/'));
  if (hasItemFolder && hasItemsFolder) {
    report.duplicateTextureFolders.push('textures/item + textures/items');
    log('[POSTFIX:WARN] Both textures/item and textures/items are shipped; Bedrock only reads textures/items for item icons — move every icon into textures/items.');
  }
}

export function runPostProcessPass(options: PostProcessOptions): PostProcessReport {
  const { resourcePackFiles: rp, behaviorPackFiles: bp } = options;
  const log = (line: string) => options.onLog?.(line);
  const report: PostProcessReport = {
    soundEntriesFixed: 0,
    soundDefinitionsDropped: 0,
    iconsFixed: 0,
    molangExpressionsRepaired: 0,
    molangFilesTouched: [],
    manifestsAdjusted: 0,
    learnedQueriesApplied: getLearnedDenyQueries(),
    moduleFixesApplied: [],
    modulesDeclared: [],
    modulesRemoved: [],
    duplicateIdsRemoved: 0,
    danglingAnimationRefs: [],
    wiringWarnings: [],
    missingAtlasTextures: [],
    unregisteredItemIcons: [],
    unusedGeometry: [],
    uvMismatchWarnings: [],
    missingClientEntities: [],
    orphanClientEntities: [],
    missingSpawnEggs: [],
    duplicateTextureFolders: [],
    textureFolderMigrations: [],
    textureReferencesUpdated: 0,
    textureFolderConflicts: [],
    armorSheetsShipped: [],
    armorAttachablesBound: 0,
    armorAttachableIssues: [],
    orphanArmorSheets: [],
    particleDocumentsRepaired: 0,
    particleDocumentsDropped: [],
    particleTextureDeclarationsRemoved: [],
    particleTexturesBound: [],
    particleTexturesUnresolved: [],
    textureSetVersionsFixed: 0,
    blockSoundTypesFixed: 0,
  };
  const queries = unsupportedQueries();
  try {
    normalizeTextureFolders(rp, report, log);
    fixSoundDefinitions(rp, report, log);
    // Defect classes the Bedrock content log reports verbatim, repaired from each file's own
    // content so the same rule holds for any imported mod.
    const particles = repairParticleDocuments(rp, options.modId, log);
    report.particleDocumentsRepaired = particles.repaired;
    report.particleDocumentsDropped = particles.dropped;
    report.particleTextureDeclarationsRemoved = particles.textureDeclarations;
    report.particleTexturesBound = particles.texturesBound;
    report.particleTexturesUnresolved = particles.unresolvedTextures;
    report.textureSetVersionsFixed = repairTextureSetVersions(rp, log);
    report.blockSoundTypesFixed = repairBlockSoundTypes(rp, log);
    fixItemIcons(bp, report);
    // Icon/atlas reconciliation runs on the pack this pass has just normalised and BEFORE the
    // integrity checks below measure it. A migrated icon whose atlas entry is missing is
    // repaired here, so the report can never list a defect that was already fixed and the
    // shipped pack never carries an icon key the atlas cannot resolve.
    const icons = enforceItemIconsAndBlockGeometry({
      modId: options.modId,
      resourcePackFiles: rp,
      behaviorPackFiles: bp,
      itemModels: options.itemModels ?? null,
      onLog: log,
    });
    report.iconsFixed += icons.iconsRepaired;
    report.atlasReconciled =
      (report.atlasReconciled ?? 0) +
      icons.atlasEntriesAdded +
      icons.atlasPhantomsRemoved +
      icons.texturesCarried;
    report.itemIconsUnresolved = [...(report.itemIconsUnresolved ?? []), ...icons.missingIcons];
    report.blockBackedItemsWithoutBlock = [
      ...(report.blockBackedItemsWithoutBlock ?? []),
      ...icons.blockBackedWithoutBlock,
    ];
    // Client entity linking runs BEFORE the integrity checks below measure the pack: a
    // behavior entity without a client entity renders invisible in game, so the missing file
    // is generated from the model + skin evidence this pack ships, and only an entity with no
    // evidence at all is reported as unresolved.
    const clientLinks = generateMissingClientEntities({
      modId: options.modId,
      resourcePackFiles: rp,
      behaviorPackFiles: bp,
      onLog: log,
    });
    report.clientEntitiesGenerated = (report.clientEntitiesGenerated ?? 0) + clientLinks.created;
    report.clientEntitiesUnresolved = [
      ...(report.clientEntitiesUnresolved ?? []),
      ...clientLinks.unresolved,
    ];
    for (const directory of ['animation_controllers', 'animations', 'render_controllers', 'entity']) {
      fixMolangInDirectory(rp, directory, report, queries);
      fixMolangInDirectory(bp, directory, report, queries);
    }
    fixManifests(bp, report, log);
    checkReferenceIntegrity(rp, report, log);
    checkAssetIntegrity(rp, bp, report, log);
    checkArmorAttachables(rp, report, log);
  } catch (error) {
    log(`[POSTFIX:ERROR] Post-processing pass could not complete — ${error instanceof Error ? error.message : String(error)}. Checks it did not reach are reported as NOT MEASURED; the pack is exported unchanged from that point.`);
    return report;
  }
  if (
    report.soundEntriesFixed > 0 ||
    report.soundDefinitionsDropped > 0 ||
    report.iconsFixed > 0 ||
    report.molangExpressionsRepaired > 0 ||
    report.manifestsAdjusted > 0 ||
    report.duplicateIdsRemoved > 0 ||
    report.modulesDeclared.length > 0 ||
    report.modulesRemoved.length > 0 ||
    report.moduleFixesApplied.length > 0 ||
    report.textureFolderMigrations.length > 0 ||
    report.textureReferencesUpdated > 0
  ) {
    log(
      `[POSTFIX] Post-processing pass: ${report.soundEntriesFixed} sound path(s) normalised, ${report.soundDefinitionsDropped} unshippable sound reference(s) dropped, ${report.iconsFixed} item icon(s) migrated to the 1.21.30+ schema, ${report.molangExpressionsRepaired} Molang expression(s) repaired in ${report.molangFilesTouched.length} file(s), ${report.duplicateIdsRemoved} duplicate id(s) collapsed, ${report.manifestsAdjusted} manifest(s) adjusted, ${report.textureFolderMigrations.length} legacy texture path(s) normalized (textures/item -> textures/items, textures/entity/mob|hostile|passive and textures/models/entity|mob -> textures/entity, textures/gui/containers -> textures/gui) with ${report.textureReferencesUpdated} atlas/JSON reference(s) rewritten.`,
    );
  } else {
    log('[POSTFIX] Post-processing pass: no defects found — sound paths, item icons, Molang queries, manifest modules and animation references already satisfy the export rules.');
  }
  if (
    (report.particleDocumentsRepaired ?? 0) > 0 ||
    (report.textureSetVersionsFixed ?? 0) > 0 ||
    (report.blockSoundTypesFixed ?? 0) > 0 ||
    (report.particleDocumentsDropped?.length ?? 0) > 0 ||
    (report.particleTextureDeclarationsRemoved?.length ?? 0) > 0
  ) {
    log(
      `[POSTFIX] Client schema conformance: ${report.particleDocumentsRepaired ?? 0} particle document(s) re-rooted under minecraft:particle_effect, ${report.particleDocumentsDropped?.length ?? 0} unexpressible particle document(s) dropped and reported, ${report.particleTextureDeclarationsRemoved?.length ?? 0} Java sprite declaration(s) kept out of particles/ and ${report.particleTexturesUnresolved?.length ?? 0} effect(s) still naming an unshipped sprite, ${report.textureSetVersionsFixed ?? 0} texture-set format_version value(s) corrected, ${report.blockSoundTypesFixed ?? 0} block sound type(s) remapped to a name the client recognises.`,
    );
  }
  if ((report.atlasReconciled ?? 0) > 0) {
    log(
      `[POSTFIX] Icon/atlas reconciliation: ${report.atlasReconciled} atlas registration(s), carried icon sheet(s) and phantom reference(s) resolved against the PNGs this pack actually ships; ${report.itemIconsUnresolved?.length ?? 0} item(s) have no source sheet and stay reported without an icon.`,
    );
  }
  if ((report.clientEntitiesGenerated ?? 0) > 0 || (report.clientEntitiesUnresolved?.length ?? 0) > 0) {
    log(
      `[POSTFIX] Client entity linking: ${report.clientEntitiesGenerated ?? 0} behavior entit(ies) gained the entity/<name>.entity.json file that binds a shipped geometry identifier and skin PNG; ${report.clientEntitiesUnresolved?.length ?? 0} entit(ies) stayed unlinked because no model or skin ships for them, so no rig was invented.`,
    );
  }
  if ((report.blockBackedItemsWithoutBlock?.length ?? 0) > 0) {
    log(
      `[POSTFIX:WARN] ${report.blockBackedItemsWithoutBlock?.length ?? 0} item(s) are cube (block-backed) Java models but ship no block definition with that identifier — their cube has nothing to render from and can only appear as a flat sprite: ${report.blockBackedItemsWithoutBlock?.slice(0, 6).join(' | ')}.`,
    );
  }
  if (report.wiringWarnings.length > 0 || report.danglingAnimationRefs.length > 0) {
    log(`[POSTFIX] ${report.danglingAnimationRefs.length} dangling animation reference(s) and ${report.wiringWarnings.length} wiring warning(s) need a real fix — listed in the report, never silently shipped as "passed".`);
  }
  const assetDefectCount =
    report.missingAtlasTextures.length +
    report.unregisteredItemIcons.length +
    report.unusedGeometry.length +
    report.uvMismatchWarnings.length +
    report.missingClientEntities.length +
    report.orphanClientEntities.length +
    report.missingSpawnEggs.length +
    report.duplicateTextureFolders.length +
    report.textureFolderConflicts.length +
    report.armorAttachableIssues.length +
    report.orphanArmorSheets.length;
  if (assetDefectCount > 0) {
    log(`[POSTFIX] Asset integrity: ${assetDefectCount} issue(s) need a real fix — ${report.missingAtlasTextures.length} missing atlas texture(s), ${report.unregisteredItemIcons.length} unregistered item icon(s), ${report.unusedGeometry.length} unused geometry(ies), ${report.uvMismatchWarnings.length} UV size mismatch(es), ${report.missingClientEntities.length} mob(s) without a client entity, ${report.orphanClientEntities.length} orphan client entity(ies), ${report.missingSpawnEggs.length} missing spawn egg(s), ${report.duplicateTextureFolders.length} duplicate texture folder(s), ${report.textureFolderConflicts.length} blocked texture migration(s), ${report.armorAttachableIssues.length} armor attachable binding issue(s), ${report.orphanArmorSheets.length} orphan armor sheet(s). Listed in the report, never silently shipped.`);
  } else {
    log('[POSTFIX] Asset integrity: atlas coverage, icon registration, geometry usage, UV sizes and mob pairing all resolve against the shipped pack.');
  }
  if (report.armorSheetsShipped.length > 0) {
    log(`[POSTFIX] Armor mapping pass: ${report.armorSheetsShipped.length} armor layer sheet(s) under textures/models/armor, ${report.armorAttachablesBound} attachable(s) verified bound to an authentic layer sheet, ${report.armorAttachableIssues.length} binding issue(s) and ${report.orphanArmorSheets.length} orphan sheet(s) reported.`);
  }
  return report;
}