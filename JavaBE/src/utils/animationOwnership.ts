import type { ExtractedZipEntry } from '@/utils/zip';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { scanClassResources } from '@/utils/mobClassScanner';

/**
 * Animation ownership protocol.
 *
 * A clip belongs to the entity whose model or animation class loads it — not to whatever
 * entity a clip id, a file name or an item behaviour happens to suggest. This module reads
 * the mod's own classes, keeps the ones that really are a model / animation / renderer class,
 * and decides which clip owner each of them loads. Player mapping is then restricted to the
 * owners that a **player model or player animation class** loads; every other owner stays
 * with its own entity, and an owner with no class evidence is reported instead of guessed.
 */

const decoder = new TextDecoder();
const MAX_CLASSES = 400;
const PLAYER_TOKENS = new Set(['player', 'players', 'humanoid']);
const ROLE_TOKENS = new Set([
  'model',
  'models',
  'animation',
  'animations',
  'renderer',
  'renderers',
  'animatable',
  'armature',
  'layer',
]);

/** CamelCase / snake_case class name broken into its own words. */
function classTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export interface OwnerAnimationOwnership {
  owner: string;
  clipCount: number;
  isPlayerOwned: boolean;
  owningClass?: string;
  evidence: string[];
  reason: string;
}

export interface PlayerAnimationOwnership {
  playerOwners: string[];
  /** Clips of player-owned owners only — the only set that may reach the player skeleton. */
  playerClipsByOwner: Record<string, Record<string, BedrockAnimationClip>>;
  reports: OwnerAnimationOwnership[];
  classesScanned: number;
  note: string;
}

interface ScannedClass {
  name: string;
  refs: string[];
  path: string;
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Same job as the bytecode scanner, for mods that ship Java sources instead of classes. */
function scanJavaSource(path: string, data: Uint8Array): ScannedClass {
  const text = decoder.decode(data);
  const refs: string[] = [];
  for (const match of text.matchAll(/["']([a-z0-9_./-]{3,})["']/gi)) {
    const ref = match[1];
    if (ref && !refs.includes(ref)) refs.push(ref);
    if (refs.length >= 40) break;
  }
  return { name: (path.split('/').pop() ?? path).replace(/\.java$/i, ''), refs, path };
}

/** Keys an owner can be recognised by: its own identity plus the stems of its clip files. */
function ownerKeys(owner: string, sourcePaths: string[]): string[] {
  const keys = new Set<string>([compactKey(owner)]);
  for (const path of sourcePaths) {
    const stem = (path.split('/').pop() ?? '').replace(/\.animation\.json$/i, '').replace(/\.json$/i, '');
    if (stem) keys.add(compactKey(stem));
    const folder = path.split('/').filter(Boolean).slice(-2, -1)[0];
    if (folder) keys.add(compactKey(folder));
  }
  return [...keys].filter((key) => key.length >= 3);
}

function classLoadsOwner(info: ScannedClass, keys: string[]): boolean {
  const classKey = compactKey(info.name);
  if (keys.some((key) => classKey.includes(key))) return true;
  return info.refs.some((ref) => {
    const refKey = compactKey(ref);
    return keys.some((key) => refKey.includes(key));
  });
}

/**
 * Classifies each clip owner by the class that loads it. `entries` is the archive's own file
 * list; when it carries no class at all, the animation document location is used as the only
 * remaining evidence and is labelled as such — never as a class-declared player clip.
 */
export function classifyPlayerAnimationOwnership(options: {
  owners: string[];
  clipsByOwner: Record<string, Record<string, BedrockAnimationClip>>;
  sourcePathsByOwner?: Record<string, string[]>;
  entries?: ExtractedZipEntry[];
}): PlayerAnimationOwnership {
  const classes: ScannedClass[] = [];
  for (const entry of options.entries ?? []) {
    const path = entry.path.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (classes.length >= MAX_CLASSES) break;
    if (lower.endsWith('.java')) {
      classes.push(scanJavaSource(path, entry.data));
      continue;
    }
    if (lower.endsWith('.class')) {
      const info = scanClassResources(entry.data);
      if (info) classes.push({ name: info.className, refs: info.refs, path });
    }
  }

  const playerClasses = classes.filter((info) => {
    const tokens = classTokens(info.name);
    return (
      tokens.some((token) => PLAYER_TOKENS.has(token)) && tokens.some((token) => ROLE_TOKENS.has(token))
    );
  });

  const playerOwners: string[] = [];
  const playerClipsByOwner: Record<string, Record<string, BedrockAnimationClip>> = {};
  const reports: OwnerAnimationOwnership[] = [];

  for (const owner of options.owners) {
    const clips = options.clipsByOwner[owner] ?? {};
    const clipCount = Object.keys(clips).length;
    const paths = options.sourcePathsByOwner?.[owner] ?? [];
    const keys = ownerKeys(owner, paths);
    const loading = playerClasses.filter((info) => classLoadsOwner(info, keys));
    const evidence = loading.map((info) => `${info.name} (${info.path})`);
    const hasPlayerPath = paths.some((p) => /player[_-]?anim|player|viewmodel|firstperson/i.test(p));
    const isPlayerOwned = loading.length > 0 || hasPlayerPath;
    if (isPlayerOwned) {
      playerOwners.push(owner);
      playerClipsByOwner[owner] = clips;
      if (loading.length === 0 && paths.length > 0) {
        evidence.push(paths[0]);
      }
    }
    reports.push({
      owner,
      clipCount,
      isPlayerOwned,
      owningClass: loading[0]?.name,
      evidence,
      reason: loading.length > 0
        ? `loaded by player model/animation class ${loading.map((info) => info.name).join(', ')}`
        : hasPlayerPath
          ? `source animation path "${paths[0] || owner}" explicitly declares player animation scope`
          : classes.length === 0
            ? 'the archive ships no Java class and animation path does not target player — clips stay with source owner'
            : 'no player model or player animation class loads these clips — they stay with their own entity',
    });
    if (classes.length === 0 && clipCount > 0 && !hasPlayerPath) {
      if (paths.length > 0) {
        reports[reports.length - 1].reason += ` (animation document: ${paths[0]})`;
      }
    }
  }

  const note = playerOwners.length > 0
    ? `${playerOwners.length} clip owner(s) are loaded by a player model/animation class and may be mapped onto the Bedrock player skeleton; ${options.owners.length - playerOwners.length} owner(s) stay with their own entity.`
    : `No clip owner is loaded by a player model/animation class, so no clip is mapped to the player and no player client entity is generated (${classes.length} class file(s) scanned).`;

  return { playerOwners, playerClipsByOwner, reports, classesScanned: classes.length, note };
}