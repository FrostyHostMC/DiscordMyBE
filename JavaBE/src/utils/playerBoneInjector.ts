import { hasCustomBoneTokens, resolvePlayerBone } from '@/utils/playerBoneAliases';

/** A geometry file the archive really shipped. */
export interface GeometryCandidate {
  key: string;
  json: string;
  source?: string;
}

export interface BoneInjectionResult {
  geometryIdentifier: string | null;
  geometryPath: string | null;
  files: Record<string, string>;
  injectedBones: string[];
  approximatedBones: string[];
  unresolvedBones: string[];
  note: string;
}

/**
 * Keep the native Bedrock player geometry intact. A mod's 64×64 animation rig is not proof
 * that its cubes and UV layout match a Bedrock skin; pointing the player entity at it replaces
 * the player's normal mesh and can leave detached or badly textured limbs. Unknown source
 * tracks are reported here and withheld by the mapping stage rather than attached to a guessed
 * parent or rendered through an unverified model.
 */
export function injectPlayerRigBones(options: {
  candidates: GeometryCandidate[];
  clipBones: string[];
  modId: string;
}): BoneInjectionResult {
  const unresolvedBones = [...new Set(options.clipBones.filter((name) =>
    hasCustomBoneTokens(name) || !resolvePlayerBone(name),
  ))];
  const candidateNote = options.candidates.length > 0
    ? `${options.candidates.length} source geometry candidate(s) left untouched`
    : 'no player geometry candidate shipped';
  const unresolvedNote = unresolvedBones.length > 0
    ? `${unresolvedBones.length} custom bone track(s) remain unresolved and are not played`
    : 'all detected tracks fit the native player skeleton';

  return {
    geometryIdentifier: null,
    geometryPath: null,
    files: {},
    injectedBones: [],
    approximatedBones: [],
    unresolvedBones,
    note: `${candidateNote} for ${options.modId}; the native player mesh and skin stay intact, and ${unresolvedNote}.`,
  };
}