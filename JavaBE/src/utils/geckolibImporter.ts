import type { ExtractedZipEntry } from '@/utils/zip';
import type { MobAnimationAliases } from '@/utils/mobAnimationTemplates';
import { translateJavaMathToMolang } from '@/utils/advancedMolangTranslator';
import { isPlainObject } from '@/utils/animationChannelMath';
import { parseRelaxedJson } from '@/utils/relaxedJson';
import {
  remapAnimationBones,
  translateJavaAnimationSet,
  type BedrockAnimationClip,
} from '@/utils/animationTranslator';

/**
 * GeckoLib importer.
 *
 * GeckoLib ships its clips as `assets/<mod>/animations/<name>.animation.json` with the same
 * shape Bedrock uses, but the *identity* of a clip is carried in the clip id
 * (`animation.<entity>.<state>`) rather than the file name, and one file can hold the clips
 * of many entities (`all_animations.json`). The previous pipeline keyed clips by file name
 * only, so most GeckoLib source animations were never attached to the creature they belong
 * to and never reached the exported pack.
 *
 * This module is generic data-driven discovery: it detects the GeckoLib dependency from the
 * archive's own metadata/bytecode, discovers every animation document, parses it, attributes
 * each clip to its source entity from the clip id (with the file as the fallback), translates
 * the channels through the Java→Bedrock translator, resolves bone names against the recovered
 * skeleton, and emits Bedrock animation + controller files for owners that no entity loop
 * claimed. Nothing is hardcoded to a specific mod, entity, file or clip name.
 */

const decoder = new TextDecoder();

/** File stems that identify a container of many entities' clips, never one entity. */
const GENERIC_STEMS = new Set([
  'all',
  'every',
  'everything',
  'all_animation',
  'all_animations',
  'every_animation',
  'every_animations',
  'animation',
  'animations',
  'anim',
  'anims',
  'clip',
  'clips',
  'common',
  'shared',
  'main',
  'master',
  'misc',
  'extra',
  'extras',
  'general',
  'combined',
  'merged',
  'entity',
  'entities',
  'entity_animation',
  'entity_animations',
  'model',
  'models',
  'rig',
]);

/** Segments that describe the model, not the entity, so they never name an owner. */
const OWNER_NOISE = new Set(['model', 'main', 'entity', 'root', 'armature', 'default', 'rig', 'body', 'base', 'bone']);

/** Words that describe the file or rig, never the creature, so they are ignored when matching. */
const MATCH_NOISE = new Set([
  'animation',
  'animations',
  'entity',
  'entities',
  'model',
  'models',
  'texture',
  'textures',
  'render',
  'client',
  'server',
  'geo',
  'main',
  'base',
  'body',
  'default',
  'layer',
]);

/** Compact identity used to compare a clip owner with a mob id (`obsidian_wraith` -> `obsidianwraith`). */
export function identityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Distinctive name words of an owner, used for token-level matching only. */
export function identityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !MATCH_NOISE.has(token));
}

/**
 * Resolves which imported clip owner belongs to a mob. Clip ids and file names drift
 * (`obsidianwraith` vs `obsidian_wraith`, `wraith_entity`), so an owner only binds when the
 * identity is unambiguous: identical compact key, or every distinctive word of one side is
 * present in the other and exactly one owner qualifies. An ambiguous result never binds,
 * because handing a mob another creature's clips is worse than reporting none.
 */
export function resolveOwnerForMob(owners: string[], mobId: string): string | null {
  const targetKey = identityKey(mobId);
  if (!targetKey) return null;
  const exact = owners.filter((owner) => identityKey(owner) === targetKey);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const targetTokens = identityTokens(mobId);
  if (targetTokens.length === 0) return null;
  const candidates: string[] = [];
  for (const owner of owners) {
    const ownerTokens = identityTokens(owner);
    if (ownerTokens.length === 0) continue;
    const ownerCovered = ownerTokens.every((token) => targetTokens.includes(token));
    const targetCovered = targetTokens.every((token) => ownerTokens.includes(token));
    if (ownerCovered || targetCovered) candidates.push(owner);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/** Normalises an id into the lowercase file-safe form used for owner keys. */
export function normaliseOwnerKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.animation\.json5?$/, '')
    .replace(/\.json5?$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

/** True for archive paths that hold GeckoLib / Java animation clips (never geometry). */
export function isAnimationJsonPath(path: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase();
  if (!/\.json5?$/i.test(p)) return false;
  if (/\.geo\.json5?$/i.test(p) || p.includes('/geo/') || p.includes('/models/')) return false;
  if (p.includes('_lighting.animation.json') || p.includes('biome_lighting')) return false;
  if (p.includes('/animations/') || p.includes('/animation/') || p.includes('/anim/') || p.includes('/geckolib/')) {
    return true;
  }
  if (p.endsWith('.animation.json') || p.endsWith('.animation.json5')) return true;
  return /(?:^|\/)animations?\.json5?$/.test(p);
}

export interface GeckolibDependencyEvidence {
  detected: boolean;
  evidence: string[];
}

/**
 * Detects the GeckoLib dependency from the archive itself: declared dependencies in loader
 * metadata, GeckoLib package strings in bytecode, GeckoLib paths, and the presence of the
 * GeckoLib file formats (`.geo.json` + `*.animation.json`).
 */
export function detectGeckolibDependency(archiveEntries: ExtractedZipEntry[]): GeckolibDependencyEvidence {
  const evidence: string[] = [];
  let geckolibFormats = 0;
  let classesScanned = 0;

  for (const entry of archiveEntries) {
    const path = entry.path.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (lower.includes('geckolib')) {
      if (evidence.length < 6) evidence.push(path);
      continue;
    }
    if (lower.endsWith('.geo.json') || lower.endsWith('.animation.json')) {
      geckolibFormats += 1;
      continue;
    }
    const isMetadata =
      lower.endsWith('mods.toml') ||
      lower.endsWith('fabric.mod.json') ||
      lower.endsWith('.mod.json') ||
      lower.endsWith('manifest.mf');
    if (isMetadata) {
      const text = decoderText(entry.data).toLowerCase();
      if (text.includes('geckolib')) evidence.push(path);
      continue;
    }
    // Constant-pool scan: GeckoLib classes reference the library's own package.
    if (lower.endsWith('.class') && classesScanned < 60 && entry.data.length < 600_000) {
      classesScanned += 1;
      if (decoderText(entry.data).toLowerCase().includes('geckolib')) {
        if (evidence.length < 12) evidence.push(path);
      }
    }
  }

  if (geckolibFormats >= 2 && evidence.length === 0) {
    evidence.push(`${geckolibFormats} GeckoLib-format animation/geometry files`);
  }
  return { detected: evidence.length > 0, evidence };
}

function decoderText(data: Uint8Array): string {
  try {
    return decoder.decode(data);
  } catch {
    return '';
  }
}

/** Translates Java math inside expression strings only — clip ids and keys stay untouched. */
function molangizeDocument(value: unknown, counter: { count: number }): unknown {
  if (typeof value === 'string') {
    if (/Math\.|MathHelper\.|Mth\.|this\.|getX\(|getY\(|getZ\(|isHurt\(|tickCount/.test(value)) {
      counter.count += 1;
      return translateJavaMathToMolang(value, 'animation');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => molangizeDocument(item, counter));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = molangizeDocument(item, counter);
    return out;
  }
  return value;
}

/** Owner of one entity the animation files describe. */
export interface GeckolibOwnerClips {
  owner: string;
  clipIds: string[];
  animations: Record<string, BedrockAnimationClip>;
  sourcePaths: string[];
}

export interface GeckolibSourceFile {
  path: string;
  fileName: string;
  /** Entity the file itself is named after (empty for a shared container file). */
  owner: string;
  clipIds: string[];
  /** Clips whose id did not resolve to any owner — carried verbatim from the file. */
  unattributedClipIds: string[];
  /** Bedrock document for the whole file ('' when nothing could be translated). */
  json: string;
  /** Bedrock document holding only the clips no owner claimed ('' when none). */
  unattributedJson: string;
}

export interface GeckolibImportStats {
  detected: boolean;
  filesDiscovered: number;
  filesParsed: number;
  filesUnreadable: number;
  clipsImported: number;
  clipsAttributed: number;
  clipsUnattributed: number;
  channels: number;
  keyframes: number;
  normalised: number;
  unsupported: number;
  durationsDerived: number;
  molangValuesTranslated: number;
}

export interface GeckolibImportResult {
  dependency: GeckolibDependencyEvidence;
  stats: GeckolibImportStats;
  files: GeckolibSourceFile[];
  /** Owner key → translated Bedrock clips. */
  clipsByOwner: Record<string, Record<string, BedrockAnimationClip>>;
  /** Translated clip id -> exact key from the source animation document, grouped by owner. */
  sourceClipIdsByOwner?: Record<string, Record<string, string>>;
  owners: string[];
  sourcePathsByOwner: Record<string, string[]>;
  /** Files carrying clips that no owner claimed. */
  unattributedFiles: Record<string, string>;
  log: string[];
}

/** Resolves which entity a clip belongs to, from the clip id first and the file name second. */
export function ownerFromClipId(clipId: string, fileOwner: string, modId?: string): string {
  const segments = clipId
    .split(/[.:/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  let parts = segments[0] === 'animation' ? segments.slice(1) : segments;
  // A clip id namespaced with the mod id (`animation.<mod>.<entity>.<state>`) describes the
  // mod first; the entity is the next segment. Without this the mod id became the owner and
  // every clip of that mod piled onto one phantom "entity".
  const modKey = modId ? identityKey(modId) : '';
  if (modKey && parts.length > 1 && identityKey(parts[0]) === modKey) parts = parts.slice(1);
  if (parts.length === 0) return fileOwner;
  const candidate = normaliseOwnerKey(parts[0]);
  if (fileOwner && (candidate === fileOwner || OWNER_NOISE.has(candidate))) return fileOwner;
  if (parts.length < 2) return fileOwner;
  if (OWNER_NOISE.has(candidate) || GENERIC_STEMS.has(candidate)) return fileOwner;
  return candidate;
}

function fileOwnerFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? '';
  const stem = normaliseOwnerKey(fileName);
  if (!stem || GENERIC_STEMS.has(stem)) return '';
  return stem;
}

function bedrockDocument(animations: Record<string, BedrockAnimationClip>): string {
  return JSON.stringify({ format_version: '1.8.0', animations }, null, 2);
}

/**
 * Discovers, parses, attributes and translates every GeckoLib / Java animation document in
 * the archive. A file that cannot be parsed or holds no readable clip is reported, never
 * silently dropped.
 */
export function importGeckolibAnimations(
  archiveEntries: ExtractedZipEntry[],
  modId: string,
  onLog?: (line: string) => void,
): GeckolibImportResult {
  const log: string[] = [];
  const logLine = (line: string) => {
    log.push(line);
    onLog?.(line);
  };

  const dependency = detectGeckolibDependency(archiveEntries);
  const stats: GeckolibImportStats = {
    detected: dependency.detected,
    filesDiscovered: 0,
    filesParsed: 0,
    filesUnreadable: 0,
    clipsImported: 0,
    clipsAttributed: 0,
    clipsUnattributed: 0,
    channels: 0,
    keyframes: 0,
    normalised: 0,
    unsupported: 0,
    durationsDerived: 0,
    molangValuesTranslated: 0,
  };
  const files: GeckolibSourceFile[] = [];
  const clipsByOwner: Record<string, Record<string, BedrockAnimationClip>> = {};
  const sourceClipIdsByOwner: Record<string, Record<string, string>> = {};
  const owners: string[] = [];
  const sourcePathsByOwner: Record<string, string[]> = {};
  const unattributedFiles: Record<string, string> = {};
  const registeredSourceClipFingerprints = new Set<string>();
  const modKey = normaliseOwnerKey(modId);

  if (dependency.detected) {
    logLine(
      `[GECKOLIB] Dependency detected — evidence: ${dependency.evidence.slice(0, 4).join(', ') || 'archive contents'}. Animation clips will be imported and re-bound to their source entities.`,
    );
  } else {
    logLine('[GECKOLIB] No GeckoLib dependency signature in this archive — scanning for generic Java animation documents only.');
  }

  for (const entry of archiveEntries) {
    if (!isAnimationJsonPath(entry.path)) continue;
    stats.filesDiscovered += 1;
    const path = entry.path.replace(/\\/g, '/');
    const fileName = path.split('/').pop() ?? path;
    const bedrockFileName = fileName.replace(/\.json5$/i, '.json');
    const fileOwner = fileOwnerFromPath(path);

    const parsed = parseRelaxedJson(decoderText(entry.data));
    if (parsed === null) {
      stats.filesUnreadable += 1;
      files.push({
        path,
        fileName,
        owner: fileOwner,
        clipIds: [],
        unattributedClipIds: [],
        json: '',
        unattributedJson: '',
      });
      logLine(`[GECKOLIB] "${fileName}" is not readable animation JSON — recorded as NOT CARRIED (malformed source).`);
      continue;
    }

    const molangCounter = { count: 0 };
    const prepared = molangizeDocument(parsed, molangCounter);
    stats.molangValuesTranslated += molangCounter.count;

    const translation = translateJavaAnimationSet(prepared, { fileHint: fileOwner || modKey });
    const sourceIdByTranslatedId = new Map(
      Object.entries(translation.idMap).map(([sourceId, translatedId]) => [translatedId, sourceId]),
    );
    stats.filesParsed += 1;
    stats.channels += translation.stats.channels;
    stats.keyframes += translation.stats.keyframes;
    stats.normalised += translation.stats.normalised;
    stats.unsupported += translation.stats.unsupported;
    stats.durationsDerived += translation.stats.durationsDerived;
    stats.clipsImported += translation.stats.clips;

    const attributed = new Map<string, Record<string, BedrockAnimationClip>>();
    const unattributed: Record<string, BedrockAnimationClip> = {};
    for (const [clipId, clip] of Object.entries(translation.animations)) {
      const inferredOwner = ownerFromClipId(clipId, fileOwner, modId);
      const lowerPath = path.toLowerCase();
      const isPlayerAnimationPath = lowerPath.includes('/player_animation/') || lowerPath.includes('/player-animations/') || lowerPath.includes('/player_animations/');
      const owner = isPlayerAnimationPath ? 'player' : inferredOwner;
      if (!owner) {
        unattributed[clipId] = clip;
        stats.clipsUnattributed += 1;
        continue;
      }
      const sourceIdentity = (clipId.split(/[.:/]+/).pop() ?? clipId).trim().toLowerCase();
      const fingerprint = `${owner}::${sourceIdentity}::${JSON.stringify(clip)}`;
      if (registeredSourceClipFingerprints.has(fingerprint)) continue;
      registeredSourceClipFingerprints.add(fingerprint);
      const bucket: Record<string, BedrockAnimationClip> = attributed.get(owner) ?? {};
      bucket[clipId] = clip;
      attributed.set(owner, bucket);
      stats.clipsAttributed += 1;
      if (!clipsByOwner[owner]) {
        clipsByOwner[owner] = {};
        owners.push(owner);
      }
      clipsByOwner[owner][clipId] = clip;
      const ownerSourceIds = sourceClipIdsByOwner[owner] ?? {};
      ownerSourceIds[clipId] = sourceIdByTranslatedId.get(clipId) ?? clipId;
      sourceClipIdsByOwner[owner] = ownerSourceIds;
      const ownerPaths = sourcePathsByOwner[owner] ?? [];
      if (!ownerPaths.includes(path)) ownerPaths.push(path);
      sourcePathsByOwner[owner] = ownerPaths;
    }

    const fileJson = Object.keys(translation.animations).length > 0 ? bedrockDocument(translation.animations) : '';
    const unattributedJson = Object.keys(unattributed).length > 0 ? bedrockDocument(unattributed) : '';
    files.push({
      path,
      fileName,
      owner: fileOwner,
      clipIds: Object.keys(translation.animations),
      unattributedClipIds: Object.keys(unattributed),
      json: fileJson,
      unattributedJson,
    });
    if (unattributedJson) unattributedFiles[`animations/${bedrockFileName}`] = unattributedJson;

    if (Object.keys(translation.animations).length === 0) {
      logLine(
        `[GECKOLIB] "${fileName}": ${translation.stats.clipsSkipped} clip(s) could not be mapped onto Bedrock bone channels — recorded as NOT CARRIED.`,
      );
    } else {
      const ownerList = [...attributed.keys()];
      logLine(
        `[GECKOLIB] "${fileName}" -> ${Object.keys(translation.animations).length} clip(s)${ownerList.length > 0 ? ` for ${ownerList.slice(0, 6).join(', ')}` : ''}${Object.keys(unattributed).length > 0 ? `, ${Object.keys(unattributed).length} unattributed` : ''}; ${translation.stats.channels} channel(s), ${translation.stats.keyframes} keyframe(s) translated.`,
      );
    }
    if (translation.stats.unsupported > 0) {
      logLine(
        `[GECKOLIB] "${fileName}": ${translation.stats.unsupported} source expression(s) have no Bedrock equivalent and are reported for review — no vector data was dropped.`,
      );
    }
  }

  if (stats.filesDiscovered === 0) {
    logLine('[GECKOLIB] No GeckoLib / Java animation documents found in the archive — nothing to import (reported, not invented).');
  }

  return { dependency, stats, files, clipsByOwner, sourceClipIdsByOwner, owners, sourcePathsByOwner, unattributedFiles, log };
}

/** Re-binds imported clips onto the bones the shipped geometry actually declares. */
export function resolveGeckolibBones(
  clips: Record<string, BedrockAnimationClip>,
  boneNames: string[],
): { clips: Record<string, BedrockAnimationClip>; remapped: number; unmapped: string[] } {
  if (boneNames.length === 0 || Object.keys(clips).length === 0) {
    return { clips, remapped: 0, unmapped: [] };
  }
  const fit = remapAnimationBones(clips, boneNames);
  return {
    clips: fit.animations as Record<string, BedrockAnimationClip>,
    remapped: fit.remapped,
    unmapped: fit.unmapped,
  };
}

/** Classifies imported clip ids into the semantic states an animation controller needs. */
export function classifyClipRoles(clipIds: string[]): MobAnimationAliases {
  const aliases: MobAnimationAliases = {};
  for (const animationId of clipIds) {
    const tail = (animationId.split(/[.:/]+/).pop() ?? '').toLowerCase();
    if (!aliases.idle && /idle|stand|ambient|breath|rest/.test(tail)) aliases.idle = animationId;
    if (!aliases.walk && /walk|run|move|locomotion|step|stride/.test(tail)) aliases.walk = animationId;
    if (!aliases.fly && /fly|flight|wing|flap|hover/.test(tail)) aliases.fly = animationId;
    if (!aliases.attack && /attack|strike|swing|slash|cast|shoot|bite|claw|combo|hit|punch|thrust|stab/.test(tail)) aliases.attack = animationId;
    if (!aliases.hurt && /hurt|damage|flinch|hit/.test(tail)) aliases.hurt = animationId;
    if (!aliases.death && /death|die|dead|defeat/.test(tail)) aliases.death = animationId;
  }
  return aliases;
}

/**
 * Builds a Bedrock animation controller for one imported clip set. Every transition targets a
 * state that really exists and every state references only a clip that shipped, so the
 * controller can never point at missing keyframes.
 */
export function buildGeckolibController(
  owner: string,
  clipIds: string[],
  context: 'mob' | 'player' = 'mob',
): string {
  if (clipIds.length === 0) return '';
  const aliases = classifyClipRoles(clipIds);
  const ship = (id?: string): string | undefined => (id && clipIds.includes(id) ? id : undefined);
  const idle = ship(aliases.idle);
  const moveCandidate = ship(aliases.walk) ?? ship(aliases.fly);
  // A single source clip can be classified as both rest and locomotion; it never gets two
  // states, because one state toggling into itself would freeze the state machine.
  const move = moveCandidate && moveCandidate !== idle ? moveCandidate : undefined;
  const attack = ship(aliases.attack);
  const hurt = ship(aliases.hurt);
  const death = ship(aliases.death);
  if (!idle && !move && !attack && !hurt && !death) return '';

  const enteringMove = 'query.modified_move_speed > 0.1 || query.is_moving';
  const leavingMove = 'query.modified_move_speed <= 0.1 && !query.is_moving';
  // `query.has_target` / `query.target_distance` only exist on a mob. Emitting them for the
  // player produced the reported "Failed to resolve query query.target_distance" content-log
  // error, so the player branch uses queries the player client entity really declares.
  const attacking = context === 'player'
    ? 'query.is_delayed_attacking || query.is_using_item'
    : 'query.is_delayed_attacking || (query.has_target && query.target_distance < 2.5 && !query.is_moving)';
  const hurtTrigger = 'query.hurt_time > 0 && query.hurt_time < 0.35';
  const deathTransition = death ? [{ death: 'query.health <= 0' }] : [];

  type ControllerState = { animations?: string[]; transitions?: Array<Record<string, string>> };
  const defaultState: ControllerState = {
    transitions: [
      ...deathTransition,
      ...(move ? [{ move: enteringMove }] : []),
      ...(attack ? [{ attack: attacking }] : []),
      ...(hurt ? [{ hurt: hurtTrigger }] : []),
    ],
  };
  if (idle) defaultState.animations = [idle];
  const states: Record<string, ControllerState> = { default: defaultState };
  if (move) {
    states.move = {
      animations: [move],
      transitions: [
        ...deathTransition,
        { default: leavingMove },
        ...(attack ? [{ attack: attacking }] : []),
        ...(hurt ? [{ hurt: hurtTrigger }] : []),
      ],
    };
  }
  if (attack) {
    states.attack = {
      animations: [attack],
      transitions: [...deathTransition, { default: 'query.anim_time > 0.6' }],
    };
  }
  if (hurt) {
    states.hurt = {
      animations: [hurt],
      transitions: [...deathTransition, { default: 'query.anim_time > 0.45' }],
    };
  }
  if (death) states.death = { animations: [death] };

  return JSON.stringify(
    {
      format_version: '1.10.0',
      animation_controllers: {
        [`controller.animation.${owner}.general`]: {
          initial_state: 'default',
          states,
        },
      },
    },
    null,
    2,
  );
}