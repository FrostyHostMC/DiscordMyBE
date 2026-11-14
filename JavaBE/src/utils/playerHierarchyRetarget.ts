import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { readChannel, sampleChannel } from '@/utils/animationTrackMath';
import { getPlayerSkeletonProfile, javaPivotToBedrockPivot, type PlayerArmModel, type PlayerRigBoneProfile } from '@/utils/playerSkeletonProfiles';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
interface Transform { origin: Vec3; rotation: Quat; scale: Vec3 }
const ZERO: Vec3 = [0, 0, 0];
const ONE: Vec3 = [1, 1, 1];
const IDENTITY: Quat = [0, 0, 0, 1];
const JAVA_TO_BEDROCK: Record<string, string> = {
  head: 'head', hat: 'hat', body: 'body',
  right_arm: 'rightArm', left_arm: 'leftArm', right_leg: 'rightLeg', left_leg: 'leftLeg',
  right_sleeve: 'rightSleeve', left_sleeve: 'leftSleeve',
  right_pants: 'rightPants', left_pants: 'leftPants', jacket: 'jacket', cloak: 'cape',
};
const BEDROCK_LAYER_PARENT: Record<string, string> = {
  hat: 'head', leftSleeve: 'leftArm', rightSleeve: 'rightArm',
  leftPants: 'leftLeg', rightPants: 'rightLeg', jacket: 'body', cape: 'body',
};
const SOURCE_LAYER_PARENT: Record<string, string> = {
  hat: 'head', leftSleeve: 'leftArm', rightSleeve: 'rightArm',
  leftPants: 'leftLeg', rightPants: 'rightLeg', jacket: 'body', cape: 'body',
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const div = (a: Vec3, b: Vec3): Vec3 => [a[0] / (b[0] || 1), a[1] / (b[1] || 1), a[2] / (b[2] || 1)];
const isNear = (a: number, b = 0) => Math.abs(a - b) < 1e-5;
const isIdentity = (t: Transform) => t.origin.every((v) => isNear(v)) &&
  t.rotation.slice(0, 3).every((v) => isNear(v)) && isNear(t.rotation[3], 1) && t.scale.every((v) => isNear(v, 1));

function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qInverse(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }
function qFromEuler(degrees: Vec3): Quat {
  const [x, y, z] = degrees.map((v) => v * Math.PI / 360);
  const qx: Quat = [Math.sin(x), 0, 0, Math.cos(x)];
  const qy: Quat = [0, Math.sin(y), 0, Math.cos(y)];
  const qz: Quat = [0, 0, Math.sin(z), Math.cos(z)];
  return qMul(qMul(qz, qy), qx);
}
function qToEuler(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const sinp = 2 * (w * y - z * x);
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  return [
    Math.atan2(sinr, cosr) * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, sinp))) * 180 / Math.PI,
    Math.atan2(siny, cosy) * 180 / Math.PI,
  ];
}
function qRotate(q: Quat, v: Vec3): Vec3 {
  const p: Quat = [v[0], v[1], v[2], 0];
  const out = qMul(qMul(q, p), qInverse(q));
  return [out[0], out[1], out[2]];
}
function readVector(track: Record<string, unknown> | undefined, channel: string, time: number, fallback: Vec3): Vec3 | null {
  const raw = track?.[channel];
  if (raw === undefined) return fallback;
  const frames = readChannel(raw);
  if (!frames) return null;
  const sampled = sampleChannel(frames, time);
  return [sampled[0] ?? fallback[0], sampled[1] ?? fallback[1], sampled[2] ?? fallback[2]];
}
function collectTimes(bones: Record<string, Record<string, unknown>>): number[] {
  const times = new Set<number>([0]);
  for (const track of Object.values(bones)) {
    for (const channel of ['rotation', 'position', 'scale']) {
      const frames = track[channel] === undefined ? null : readChannel(track[channel]);
      if (frames) for (const frame of frames) times.add(frame.time);
    }
  }
  return [...times].sort((a, b) => a - b);
}
function round(v: number): number { return Math.round(v * 100000) / 100000; }
function writeNumericChannel(frames: Array<{ time: number; value: Vec3 }>): unknown {
  if (frames.length === 1) return frames[0].value.map(round);
  const out: Record<string, number[]> = {};
  for (const frame of frames) out[String(round(frame.time))] = frame.value.map(round);
  return out;
}
function writeSlimArmPosition(frames: Array<{ time: number; value: Vec3 }>, side: 'left' | 'right'): unknown {
  const variable = side === 'left' ? 'variable.short_arm_offset_left' : 'variable.short_arm_offset_right';
  const expression = (value: number) => `(${round(value)} + ${variable})`;
  if (frames.length === 1) {
    const [x, y, z] = frames[0].value;
    return [round(x), expression(y), round(z)];
  }
  const out: Record<string, Array<number | string>> = {};
  for (const frame of frames) out[String(round(frame.time))] = [
    round(frame.value[0]), expression(frame.value[1]), round(frame.value[2]),
  ];
  return out;
}
function getBone(profile: readonly PlayerRigBoneProfile[], name: string): PlayerRigBoneProfile | undefined {
  return profile.find((bone) => bone.name === name);
}
function sourcePositionToBedrock(value: Vec3): Vec3 {
  // Java model-local coordinates are Y-down; Bedrock geometry/animation coordinates are Y-up.
  return [value[0], -value[1], value[2]];
}
function sourceRotationToBedrock(value: Vec3): Vec3 {
  // Reflecting the Y axis changes the signs of the X/Z rotation pseudovector components.
  return [-value[0], value[1], -value[2]];
}

/**
 * Retargets Java PlayerEntityModel root-sibling transforms onto Bedrock's nested humanoid rig.
 * Every sample is evaluated at the union of all source keyframe times. Child-local transforms are
 * solved against the parent's world transform at that SAME time; this is essential when a body
 * animation and an independently animated head/arm overlap.
 *
 * Layer parts follow the corresponding Java body part when they have no explicit source track,
 * matching PlayerEntityModel's copyTransform behavior. Explicit layer tracks are preserved as
 * independent world poses and converted into Bedrock child-local transforms.
 */
export function retargetJavaPlayerHierarchy(
  clips: Record<string, BedrockAnimationClip>,
  armModel: PlayerArmModel = 'classic',
): { clips: Record<string, BedrockAnimationClip>; transformed: number; warnings: string[] } {
  const javaBones = getPlayerSkeletonProfile('java', armModel).bones;
  const bedrockBones = getPlayerSkeletonProfile('bedrock', 'classic').bones;
  const targetByName = new Map(bedrockBones.map((bone) => [bone.name, bone]));
  const javaSourceForTarget = new Map<string, PlayerRigBoneProfile>();
  for (const source of javaBones) {
    const target = JAVA_TO_BEDROCK[source.name];
    if (target) javaSourceForTarget.set(target, source);
  }
  const warnings: string[] = [];
  let transformed = 0;
  const output: Record<string, BedrockAnimationClip> = {};

  for (const [clipId, clip] of Object.entries(clips)) {
    const original = clip.bones ?? {};
    const times = collectTimes(original);
    const unsupported = Object.entries(original).filter(([, track]) =>
      ['rotation', 'position', 'scale'].some((channel) => track[channel] !== undefined && !readChannel(track[channel])),
    );
    if (unsupported.length > 0) {
      warnings.push(`clip ${clipId}: hierarchy compensation skipped because expression/easing channels on ${unsupported.map(([name]) => name).slice(0, 4).join(', ')} cannot be safely sampled; original tracks preserved`);
      output[clipId] = clip;
      continue;
    }

    const rewritten: Record<string, Record<string, unknown>> = { ...original };
    let changed = false;
    for (const time of times) {
      const sourceWorld = new Map<string, Transform>();
      for (const [targetName, sourceBone] of javaSourceForTarget) {
        const sourceTrack = original[targetName];
        const layerParent = SOURCE_LAYER_PARENT[targetName];
        const explicit = Boolean(sourceTrack);
        if (layerParent && !explicit) {
          const inherited = sourceWorld.get(layerParent);
          if (inherited) {
            sourceWorld.set(targetName, inherited);
            continue;
          }
        }
        const pivot = javaPivotToBedrockPivot(sourceBone.pivot) as Vec3;
        const rawPosition = readVector(sourceTrack, 'position', time, ZERO);
        const rawRotation = readVector(sourceTrack, 'rotation', time, ZERO);
        const rawScale = readVector(sourceTrack, 'scale', time, ONE);
        if (!rawPosition || !rawRotation || !rawScale) continue;
        sourceWorld.set(targetName, {
          origin: add(pivot, sourcePositionToBedrock(rawPosition)),
          rotation: qFromEuler(sourceRotationToBedrock(rawRotation)),
          scale: rawScale,
        });
      }

      const targetWorld = new Map<string, Transform>();
      for (const bone of bedrockBones) {
        const parent = bone.parent ? targetWorld.get(bone.parent) : undefined;
        const parentTransform = parent ?? { origin: ZERO, rotation: IDENTITY, scale: ONE };
        const parentBone = bone.parent ? targetByName.get(bone.parent) : undefined;
        const targetPivot = bone.pivot as Vec3;
        const parentPivot = (parentBone?.pivot ?? ZERO) as Vec3;
        const source = sourceWorld.get(bone.name);
        if (!source) {
          const bindOffset = sub(targetPivot, parentPivot);
          targetWorld.set(bone.name, {
            origin: add(parentTransform.origin, qRotate(parentTransform.rotation, mul(parentTransform.scale, bindOffset))),
            rotation: parentTransform.rotation,
            scale: parentTransform.scale,
          });
          continue;
        }

        const relativeRotation = qMul(qInverse(parentTransform.rotation), source.rotation);
        const relativeOffset = div(
          qRotate(qInverse(parentTransform.rotation), sub(source.origin, parentTransform.origin)),
          parentTransform.scale,
        );
        const relativePosition = sub(relativeOffset, sub(targetPivot, parentPivot));
        const relativeScale = div(source.scale, parentTransform.scale);
        const local: Transform = { origin: relativePosition, rotation: relativeRotation, scale: relativeScale };
        targetWorld.set(bone.name, source);

        const originalTrack = original[bone.name] ?? {};
        const needsTrack = Boolean(original[bone.name]) || !isIdentity(local) ||
          false;
        if (!needsTrack) continue;
        const track = rewritten[bone.name] ?? { ...originalTrack };
        const existingFrames = (rewritten[bone.name] as Record<string, unknown> | undefined) ?? {};
        const rotationFrames = (existingFrames.__rotationFrames as Array<{ time: number; value: Vec3 }> | undefined) ?? [];
        const positionFrames = (existingFrames.__positionFrames as Array<{ time: number; value: Vec3 }> | undefined) ?? [];
        const scaleFrames = (existingFrames.__scaleFrames as Array<{ time: number; value: Vec3 }> | undefined) ?? [];
        rotationFrames.push({ time, value: qToEuler(relativeRotation) });
        positionFrames.push({ time, value: relativePosition });
        scaleFrames.push({ time, value: relativeScale });
        track.__rotationFrames = rotationFrames;
        track.__positionFrames = positionFrames;
        track.__scaleFrames = scaleFrames;
        rewritten[bone.name] = track;
      }
    }

    for (const bone of bedrockBones) {
      const track = rewritten[bone.name];
      if (!track || !Array.isArray(track.__rotationFrames)) continue;
      const rotationFrames = track.__rotationFrames as Array<{ time: number; value: Vec3 }>;
      const positionFrames = track.__positionFrames as Array<{ time: number; value: Vec3 }>;
      const scaleFrames = track.__scaleFrames as Array<{ time: number; value: Vec3 }>;
      delete track.__rotationFrames;
      delete track.__positionFrames;
      delete track.__scaleFrames;
      const isArm = bone.name === 'leftArm' || bone.name === 'rightArm';
      const side = bone.name === 'leftArm' ? 'left' : 'right';
      const rotationsNeeded = rotationFrames.some((frame) => !frame.value.every((v) => isNear(v)));
      const positionsNeeded = positionFrames.some((frame) => !frame.value.every((v) => isNear(v)));
      const scalesNeeded = scaleFrames.some((frame) => !frame.value.every((v, i) => isNear(v, 1)));
      if (rotationsNeeded) track.rotation = writeNumericChannel(rotationFrames);
      else if (track.rotation !== undefined && !isArm) delete track.rotation;
      if (positionsNeeded || isArm) {
        track.position = isArm ? writeSlimArmPosition(positionFrames, side) : writeNumericChannel(positionFrames);
      } else if (track.position !== undefined) delete track.position;
      if (scalesNeeded) track.scale = writeNumericChannel(scaleFrames);
      else if (track.scale !== undefined) delete track.scale;
      if (Object.keys(track).length > 0) changed = true;
    }
    if (changed) transformed += 1;
    output[clipId] = { ...clip, bones: rewritten };
  }
  return { clips: output, transformed, warnings };
}
