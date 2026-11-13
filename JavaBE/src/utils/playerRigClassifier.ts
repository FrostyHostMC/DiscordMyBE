import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { PlayerAnimationOwnership } from '@/utils/animationOwnership';
import type { PlayerModEvidence } from '@/utils/playerModEvidence';
import { resolvePlayerBone } from '@/utils/playerBoneAliases';

/**
 * Player rig discrimination from class ownership, player-only APIs, and source rig evidence.
 * A player-named source owner is accepted only when its clips also address the humanoid rig;
 * custom or unmatched tracks remain visible for repair rather than being silently discarded.
 */
export type PlayerOwnerRoute = 'class' | 'rig-shape' | 'source-identity' | 'not-player';

export interface PlayerOwnerDecision {
  owner: string;
  clipCount: number;
  isPlayer: boolean;
  route: PlayerOwnerRoute;
  reason: string;
  owningClass?: string;
  humanoidRatio: number;
  mappedBones: number;
}

export interface PlayerRigClassification {
  decisions: PlayerOwnerDecision[];
  playerOwners: string[];
  playerClipsByOwner: Record<string, Record<string, BedrockAnimationClip>>;
  note: string;
}

const MIN_MAPPED_BONES = 3;
const MIN_RATIO = 0.5;

function rigShape(clips: Record<string, BedrockAnimationClip>): { mapped: number; total: number; ratio: number } {
  const names = new Set<string>();
  for (const clip of Object.values(clips)) {
    const bones = (clip as { bones?: Record<string, unknown> }).bones;
    if (!bones) continue;
    for (const bone of Object.keys(bones)) names.add(bone);
  }
  let mapped = 0;
  for (const name of names) {
    if (resolvePlayerBone(name)) mapped += 1;
  }
  return { mapped, total: names.size, ratio: names.size > 0 ? mapped / names.size : 0 };
}

function hasExplicitPlayerOwner(owner: string): boolean {
  const key = owner.toLowerCase().replace(/[^a-z0-9]/g, '');
  return key === 'player' || key.startsWith('player') || key.includes('firstperson') || key.includes('viewmodel');
}

export function classifyPlayerRigOwners(options: {
  owners: string[];
  clipsByOwner: Record<string, Record<string, BedrockAnimationClip>>;
  ownership: PlayerAnimationOwnership;
  evidence: PlayerModEvidence;
  modId: string;
  sourcePathsByOwner?: Record<string, string[]>;
}): PlayerRigClassification {
  const classOwners = new Set(options.ownership.playerOwners);
  const playerApiKnown = options.evidence.playerApiTokens.length > 0;
  const apiLabel = options.evidence.playerApiTokens.slice(0, 4).join(', ');
  const hasHandSourceEvidence =
    options.evidence.firstPersonEvidence.length > 0 || options.evidence.offhandEvidence.length > 0;
  const modKey = options.modId.toLowerCase().replace(/[^a-z0-9]/g, '');

  const decisions: PlayerOwnerDecision[] = [];
  const playerOwners: string[] = [];
  const playerClipsByOwner: Record<string, Record<string, BedrockAnimationClip>> = {};

  for (const owner of options.owners) {
    const clips = options.clipsByOwner[owner] ?? {};
    const clipCount = Object.keys(clips).length;
    const shape = rigShape(clips);
    const qualifies = shape.mapped >= MIN_MAPPED_BONES && shape.ratio >= MIN_RATIO;
    const ownerKey = owner.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ownerIsMod = modKey.length > 2 && ownerKey.length > 2 &&
      (ownerKey === modKey || ownerKey.startsWith(modKey) || modKey.startsWith(ownerKey));
    const namedPlayerRig = hasExplicitPlayerOwner(owner) && shape.mapped >= 1;
    const modRigWithHandEvidence = ownerIsMod && hasHandSourceEvidence && qualifies;
    const paths = options.sourcePathsByOwner?.[owner] ?? [];
    const hasPlayerPath = paths.some((p) => /player[_-]?anim|player|viewmodel|firstperson/i.test(p));
    const modMentionsPlayer = modKey.includes('player');

    let route: PlayerOwnerRoute = 'not-player';
    let reason: string;
    let owningClass: string | undefined;

    if (classOwners.has(owner)) {
      route = 'class';
      owningClass = options.ownership.reports.find((report) => report.owner === owner)?.owningClass;
      reason = `loaded by player model/animation class ${owningClass ?? 'declared by the archive'}`;
    } else if (hasPlayerPath && qualifies) {
      route = 'source-identity';
      reason = `source animation path "${paths[0]}" identifies player animation system and ${shape.mapped}/${shape.total} track bone(s) resolve onto Bedrock player skeleton`;
    } else if (playerApiKnown && qualifies) {
      route = 'rig-shape';
      reason =
        `clip set describes a humanoid player rig (${shape.mapped}/${shape.total} bone name(s) resolve onto the Bedrock player skeleton)` +
        ` and the archive calls player-only APIs (${apiLabel})` +
        (ownerIsMod ? '; the owner is the mod itself, as player animation mods commonly name their clip set' : '');
    } else if (namedPlayerRig || modRigWithHandEvidence || (modMentionsPlayer && qualifies)) {
      route = 'source-identity';
      reason = namedPlayerRig
        ? `source animation owner "${owner}" explicitly identifies the player and ${shape.mapped} track bone(s) resolve onto the Bedrock player skeleton`
        : modMentionsPlayer
          ? `mod identity "${options.modId}" declares player animation scope and clip set matches humanoid rig (${shape.mapped}/${shape.total} mapped bones)`
          : `the mod-owned clip set matches the humanoid rig (${shape.mapped}/${shape.total} mapped bones) and the archive contains first-person or off-hand source evidence`;
    } else if (clipCount === 0) {
      reason = 'the owner carries no clip with animatable bones';
    } else if (!qualifies) {
      reason = `only ${shape.mapped}/${shape.total} bone name(s) resolve onto the Bedrock player skeleton (${Math.round(shape.ratio * 100)}%), so this is not a proven humanoid player rig`;
    } else {
      reason = `humanoid-rig clips, but the archive declares no player-only API or matching player source identity (${apiLabel || 'none'}); clips remain with their source owner`;
    }

    const isPlayer = route !== 'not-player';
    if (isPlayer) {
      playerOwners.push(owner);
      playerClipsByOwner[owner] = clips;
    }
    decisions.push({
      owner,
      clipCount,
      isPlayer,
      route,
      reason,
      owningClass,
      humanoidRatio: Math.round(shape.ratio * 100) / 100,
      mappedBones: shape.mapped,
    });
  }

  const classCount = decisions.filter((entry) => entry.route === 'class').length;
  const rigCount = decisions.filter((entry) => entry.route === 'rig-shape').length;
  const identityCount = decisions.filter((entry) => entry.route === 'source-identity').length;
  const note = playerOwners.length > 0
    ? `${playerOwners.length} clip owner(s) bound to the player skeleton (${classCount} from player classes, ${rigCount} from rig/API evidence, ${identityCount} from player-named source identity plus rig evidence); ${options.owners.length - playerOwners.length} owner(s) stay with their own entity.`
    : `No clip owner could be bound to the player: ${options.owners.length} owner(s) inspected, ${options.evidence.playerApiTokens.length} player-only API token(s) found.`;

  return { decisions, playerOwners, playerClipsByOwner, note };
}