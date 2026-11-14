import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { resolvePlayerBone } from '@/utils/playerBoneAliases';
import { isControlBone } from '@/utils/boneAnatomy';
import { composeTracks } from '@/utils/animationTrackMath';
import { auditPlayerRigBones, isBedrockPlayerBone, type PlayerRigBoneAudit } from '@/utils/playerSkeletonProfiles';
import {
  recordUnmappedPlayerBones,
  type UnmappedBoneSuggestion,
} from '@/utils/playerBoneUnmappedMonitor';

/**
 * Granular Java-native → Bedrock player-skeleton mapping layer.
 *
 * Animation JSON keyframes are already expressed in Bedrock's degree-based rotation units.
 * Their magnitude cannot prove they came from radians: a small authored angle such as 2° is just
 * as valid as a large one. The bridge therefore preserves every translated rotation value
 * verbatim and only remaps bone identities.
 */
export interface PlayerBoneMapping {
  source: string;
  bone: string;
  approximated: boolean;
  /** How the mapping was resolved (canonical / alias / compound / suffix / learned). */
  via: string;
}

export interface PlayerRigMappingResult {
  /** Clips keyed by their ORIGINAL id, with bones renamed and rotations preserved. */
  clips: Record<string, BedrockAnimationClip>;
  mappings: PlayerBoneMapping[];
  unmapped: string[];
  rotationChannelsPreserved: number;
  /** Source bones composed onto a joint another source bone already drives (FK accumulation). */
  composedBones: string[];
  /** Control nodes (mechanical / IK / socket parents) withheld because the joint is already driven. */
  auxiliaryBones: string[];
  /** Unmapped names seen for the first time, with the alias outcome for each. */
  aliasSuggestions: UnmappedBoneSuggestion[];
  /** Conventions this clip set contributed to the shared alias table. */
  learnedAliases: number;
  rigAudit: PlayerRigBoneAudit[];
}

/**
 * Maps one Java humanoid bone name onto the exact Bedrock player skeleton bone set.
 *
 * A custom sub-bone (`left_wrist_twist`, `finger_joint`, `right_ear_tip`) is deliberately
 * refused. Approximating it onto the whole arm or head makes that limb follow two tracks at
 * once, which is exactly what "my character stretches out" looks like in game. Those names stay
 * unresolved and reported rather than approximated onto a skeleton bone.
 */
export function mapJavaPlayerBone(rawName: string): PlayerBoneMapping | null {
  const hit = resolvePlayerBone(rawName);
  if (!hit || !isBedrockPlayerBone(hit.bone, 'classic')) return null;
  // The native player rig has no separate wrist/finger/twist joints. When a source bone
  // contains a recognized anatomical part plus a sub-joint token, retain its transform by
  // composing it onto the corresponding Bedrock limb instead of silently dropping the track.
  // This is explicitly marked as an approximation; exact sub-joint motion requires a custom
  // player geometry and cannot be represented by the vanilla skin skeleton.
  const customSubJoint = hit.via === 'compound' && /upper|lower|fore|wrist|finger|thumb|twist|roll|elbow|shoulder|knee|ankle|toe|joint|segment/i.test(rawName);
  return {
    source: rawName,
    bone: hit.bone,
    approximated: hit.approximated || customSubJoint,
    via: customSubJoint ? 'compound-subjoint-composed' : hit.via,
  };
}

interface MappingPass {
  clips: Record<string, BedrockAnimationClip>;
  mappings: Map<string, PlayerBoneMapping>;
  unmapped: string[];
  composed: string[];
  auxiliary: string[];
  rotationChannelsPreserved: number;
}

/**
 * Applies the alias table to a clip set.
 *
 * Two source tracks that land on one skeleton bone are composed (FK accumulation), never
 * overwritten and never both discarded: a forearm and an upper arm both belong to the single
 * Bedrock arm bone, and dropping either of them deletes authored motion. Control nodes are placed
 * only when the joint they address is otherwise undriven, because a mechanical parent that drives
 * a hand the hand track already drives would rotate that hand twice.
 */
function applyMapping(clips: Record<string, BedrockAnimationClip>): MappingPass {
  const mappings = new Map<string, PlayerBoneMapping>();
  const unmapped = new Set<string>();
  const composed = new Set<string>();
  const auxiliary = new Set<string>();
  const out: Record<string, BedrockAnimationClip> = {};
  let rotationChannelsPreserved = 0;

  for (const [clipId, clip] of Object.entries(clips)) {
    const bones = clip.bones;
    if (!bones) continue;
    const mappedBones: Record<string, Record<string, unknown>> = {};
    const deform = Object.entries(bones).filter(([rawBone]) => !isControlBone(rawBone));
    const controls = Object.entries(bones).filter(([rawBone]) => isControlBone(rawBone));

    const place = (rawBone: string, track: Record<string, unknown>, control: boolean): void => {
      const mapping = mapJavaPlayerBone(rawBone);
      if (!mapping) {
        unmapped.add(rawBone);
        return;
      }
      if (track.rotation !== undefined) rotationChannelsPreserved += 1;
      const existing = mappedBones[mapping.bone];
      if (existing) {
        if (control) {
          auxiliary.add(rawBone);
          return;
        }
        const merged = composeTracks(existing, track);
        mappedBones[mapping.bone] = merged.track;
        composed.add(`${rawBone} → ${mapping.bone}`);
        mappings.set(rawBone, mapping);
        return;
      }
      mappings.set(rawBone, mapping);
      mappedBones[mapping.bone] = { ...track };
    };

    for (const [rawBone, track] of deform) {
      place(rawBone, track as Record<string, unknown>, false);
    }
    for (const [rawBone, track] of controls) {
      place(rawBone, track as Record<string, unknown>, true);
    }
    out[clipId] = { ...clip, bones: mappedBones };
  }

  return {
    clips: out,
    mappings,
    unmapped: [...unmapped],
    composed: [...composed],
    auxiliary: [...auxiliary],
    rotationChannelsPreserved,
  };
}

/**
 * Maps a whole clip set onto the Bedrock player skeleton. Returns null when the bone evidence
 * does not describe a player rig (fewer than the required number of mapped skeleton bones),
 * so entity clips are never force-renamed onto player bones.
 *
 * Unmapped names are fed to the monitor; when that report yields a new structural convention,
 * the clip set is re-mapped once against the extended alias table instead of reporting a bone
 * that is now resolvable.
 */
export function mapClipsToPlayerSkeleton(
  clips: Record<string, BedrockAnimationClip>,
  scope = 'player-animation-bridge',
  minimumMappedBones = 2,
): PlayerRigMappingResult | null {
  let pass = applyMapping(clips);
  let aliasSuggestions: UnmappedBoneSuggestion[] = [];
  let learnedAliases = 0;

  if (pass.unmapped.length > 0) {
    aliasSuggestions = recordUnmappedPlayerBones(pass.unmapped, scope);
    learnedAliases = aliasSuggestions.filter((entry) => entry.learned).length;
    if (learnedAliases > 0) pass = applyMapping(clips);
  }

  if (pass.mappings.size < minimumMappedBones) return null;
  return {
    clips: pass.clips,
    mappings: [...pass.mappings.values()],
    unmapped: pass.unmapped,
    rotationChannelsPreserved: pass.rotationChannelsPreserved,
    composedBones: pass.composed,
    auxiliaryBones: pass.auxiliary,
    aliasSuggestions,
    learnedAliases,
    rigAudit: auditPlayerRigBones(Object.keys(clips).flatMap((clipId) => Object.keys(clips[clipId].bones ?? {}))),
  };
}