import type { ExtractedZipEntry } from '@/utils/zip';
import { scanClassResources } from '@/utils/mobClassScanner';

/**
 * Player-mod evidence scanner.
 *
 * A player animation mod does not have to call its clip owner "player": Punchy-style mods ship
 * clips as `animation.<modid>.<state>`, first-person mods animate an `ItemInHandRenderer`, and
 * dual-wield mods touch `InteractionHand.OFF_HAND`. This module reads the archive's own
 * bytecode, sources and asset paths and records which of those concepts are really present, so
 * the rig classifier can recognise player-owned content from evidence instead of from a mod
 * name or a folder guess.
 */

export interface PlayerModEvidence {
  classesScanned: number;
  /** Java player model / renderer / animation classes found by name or superclass. */
  playerModelClasses: string[];
  /** Player-only API tokens found in the archive bytecode (`PlayerAnimator`, …). */
  playerApiTokens: string[];
  /** Archive paths or classes that prove the mod works on the first-person view. */
  firstPersonEvidence: string[];
  /** Archive paths that prove the mod touches the off hand / dual wielding. */
  offhandEvidence: string[];
  dualWieldDetected: boolean;
  summary: string;
}

const decoder = new TextDecoder();
const MAX_CLASSES = 400;
const MAX_BYTES = 600_000;
const MAX_SAMPLES = 8;

/** APIs only a player-side class references — a mob mod never calls these. */
const PLAYER_ONLY_TOKENS: Array<[string, RegExp]> = [
  ['PlayerModel', /PlayerModel/],
  ['PlayerRenderer', /PlayerRenderer/],
  ['PlayerAnimator', /PlayerAnimator/],
  ['AbstractClientPlayer', /AbstractClientPlayer/],
  ['FirstPersonModel', /FirstPersonModel/],
  ['ItemInHandRenderer', /ItemInHandRenderer/],
  ['HeldItemRenderer', /HeldItemRenderer/],
  ['PlayerArmRenderer', /(?:Arm|Hand)Renderer/],
];

/** Classes that model the humanoid player body. */
const PLAYER_RIG_CLASS = /(?:Player|Humanoid|Biped)(?:Model|ModelPart|EntityModel)|PlayerRenderer/;

/** Path / source tokens that only appear in first-person work. */
const FIRST_PERSON_TOKEN =
  /first[_-]?person|firstperson|view[_-]?model|item[_-]?in[_-]?hand|held[_-]?item|arm[_-]?renderer|hand[_-]?renderer/i;

/** Tokens that only appear when the mod handles the off hand. */
const OFFHAND_TOKEN = /OFF_HAND|OffHand|offhand|off_hand|dual[_-]?wield|OffhandLayer|leftItem|secondHand/i;
const OFFHAND_PATH_TOKEN = /off[_-]?hand|dual[_-]?wield|second[_-]?hand/i;
const PLAYER_ARTIFACT_PATH = /animation|player|render|model|config/i;

function decode(data: Uint8Array): string {
  try {
    return decoder.decode(data);
  } catch {
    return '';
  }
}

function pushSample(list: string[], value: string): void {
  if (list.length >= MAX_SAMPLES) return;
  if (!list.includes(value)) list.push(value);
}

export function scanPlayerModEvidence(
  entries: ExtractedZipEntry[],
  onLog?: (line: string) => void,
): PlayerModEvidence {
  const playerModelClasses: string[] = [];
  const playerApiTokens: string[] = [];
  const firstPersonEvidence: string[] = [];
  const offhandEvidence: string[] = [];
  let classesScanned = 0;

  for (const entry of entries) {
    if (entry.data.length === 0) continue;
    const path = entry.path.replace(/\\/g, '/');
    const lower = path.toLowerCase();
    const isClass = lower.endsWith('.class');
    const isSource = lower.endsWith('.java');

    if (!isClass && !isSource) {
      if (FIRST_PERSON_TOKEN.test(path) && !lower.includes('/textures/')) {
        pushSample(firstPersonEvidence, path);
      }
      if (OFFHAND_PATH_TOKEN.test(path) && PLAYER_ARTIFACT_PATH.test(path) && !lower.includes('/textures/')) {
        pushSample(offhandEvidence, path);
      }
      continue;
    }
    if (entry.data.length > MAX_BYTES || classesScanned >= MAX_CLASSES) continue;

    classesScanned += 1;
    const text = decode(entry.data);
    if (!text) continue;

    if (isClass) {
      const info = scanClassResources(entry.data);
      if (info && (PLAYER_RIG_CLASS.test(info.className) || PLAYER_RIG_CLASS.test(info.superName))) {
        pushSample(playerModelClasses, `${info.className} (${path})`);
      }
    } else if (PLAYER_RIG_CLASS.test(path)) {
      pushSample(playerModelClasses, path.split('/').pop() ?? path);
    }

    for (const [token, pattern] of PLAYER_ONLY_TOKENS) {
      if (playerApiTokens.length >= 10) break;
      if (playerApiTokens.includes(token)) continue;
      if (pattern.test(text)) playerApiTokens.push(token);
    }
    if (FIRST_PERSON_TOKEN.test(text)) pushSample(firstPersonEvidence, path);
    if (OFFHAND_TOKEN.test(text)) pushSample(offhandEvidence, path);
  }

  const dualWieldDetected = offhandEvidence.length > 0;
  const evidenceParts = [
    playerModelClasses.length > 0 ? `${playerModelClasses.length} player model class(es)` : '',
    playerApiTokens.length > 0 ? `player APIs: ${playerApiTokens.join(', ')}` : '',
    firstPersonEvidence.length > 0 ? `${firstPersonEvidence.length} first-person reference(s)` : '',
    offhandEvidence.length > 0 ? `${offhandEvidence.length} off-hand reference(s)` : '',
  ].filter(Boolean);
  const summary =
    evidenceParts.length > 0
      ? `Player-side evidence from ${classesScanned} scanned class(es): ${evidenceParts.join('; ')}.`
      : `No player-side evidence in ${classesScanned} scanned class(es); ownership will only be inferred from an explicit player source identity plus matching rig evidence.`;

  if (evidenceParts.length > 0) onLog?.(`[PLAYER-EVIDENCE] ${summary}`);

  return {
    classesScanned,
    playerModelClasses,
    playerApiTokens,
    firstPersonEvidence,
    offhandEvidence,
    dualWieldDetected,
    summary,
  };
}