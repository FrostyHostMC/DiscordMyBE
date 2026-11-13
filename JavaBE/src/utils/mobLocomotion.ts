import { classifyMobRig, type MobRigKind } from '@/utils/mobAnimationTemplates';

export interface LocomotionProfile {
  rig: MobRigKind;
  /** True when the body plan came from real skeleton bones, not a generated rig. */
  detected: boolean;
  boneCount: number;
  flight: boolean;
  evidence: string;
}

const WING_BONE = /wing|rotor|feather|propeller|prop_|fin_|fan_/;
const LEG_BONE = /leg|foot|thigh|knee|shin|hoof|paw/;
const ARM_BONE = /arm|hand|claw|shoulder|forearm/;

/**
 * Classifies biped / quadruped / flying / amorphous strictly from the recovered
 * model's bone layout. A ground mob can never receive an aerial flight clip just
 * because its name contains a flying keyword.
 */
export function classifyLocomotion(boneNames: string[] = [], flightDetected = false): LocomotionProfile {
  const bones = boneNames.filter(Boolean).map((name) => name.toLowerCase());
  const wings = bones.filter((bone) => WING_BONE.test(bone));
  const legs = bones.filter((bone) => LEG_BONE.test(bone));
  const arms = bones.filter((bone) => ARM_BONE.test(bone));
  const rig = classifyMobRig(boneNames, flightDetected);
  const detected = bones.length > 0;
  const evidence = detected
    ? `${legs.length} leg / ${arms.length} arm / ${wings.length} wing bone(s) across ${bones.length} bones`
    : 'no recovered skeleton — standard Bedrock rig used';
  return { rig, detected, boneCount: bones.length, flight: rig === 'flying', evidence };
}

/** Extracts bone names out of a shipped Bedrock geometry document. */
export function boneNamesFromGeometry(json: string | Uint8Array | undefined): string[] {
  if (typeof json !== 'string') return [];
  try {
    const parsed = JSON.parse(json) as { 'minecraft:geometry'?: Array<{ bones?: Array<{ name?: string }> }> };
    const bones = parsed['minecraft:geometry']?.[0]?.bones ?? [];
    return bones.map((bone) => bone.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/** Human readable gait label used in logs and audit tables. */
export function locomotionLabel(rig: MobRigKind): string {
  if (rig === 'flying') return 'aerial flight cycle';
  if (rig === 'quadruped') return 'quadruped gait';
  if (rig === 'amorphous') return 'squish & stretch';
  return 'biped locomotion';
}