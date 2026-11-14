import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { readChannel, sampleChannel, writeChannel } from '@/utils/animationTrackMath';
import {
  getPlayerSkeletonProfile,
  javaPivotToBedrockPivot,
  type PlayerArmModel,
  type PlayerRigBoneProfile,
} from '@/utils/playerSkeletonProfiles';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
interface Transform { origin: Vec3; rotation: Quat; scale: Vec3 }
const IDENTITY_Q: Quat = [0, 0, 0, 1];
const ONE: Vec3 = [1, 1, 1];
const ZERO: Vec3 = [0, 0, 0];
const SOURCE_BONE: Record<string, string> = {
  head: 'head', hat: 'hat', body: 'body', right_arm: 'rightArm', left_arm: 'leftArm',
  right_leg: 'rightLeg', left_leg: 'leftLeg', right_sleeve: 'rightSleeve',
  left_sleeve: 'leftSleeve', right_pants: 'rightPants', left_pants: 'leftPants',
  jacket: 'jacket', ear: 'ear', cloak: 'cape',
};
const SOURCE_POSE_PARENT: Record<string, string> = {
  hat: 'head', rightSleeve: 'rightArm', leftSleeve: 'leftArm',
  rightPants: 'rightLeg', leftPants: 'leftLeg', jacket: 'body',
};
const SOURCE_PIVOTS: Record<string, Vec3> = {
  head: [0, 24, 0], hat: [0, 24, 0], body: [0, 24, 0],
  rightArm: [-5, 22, 0], leftArm: [5, 22, 0],
  rightLeg: [-1.9, 12, 0], leftLeg: [1.9, 12, 0],
  rightSleeve: [-5, 22, 0], leftSleeve: [5, 22, 0],
  rightPants: [-1.9, 12, 0], leftPants: [1.9, 12, 0],
  jacket: [0, 24, 0], ear: [0, 24, 0], cape: [0, 24, 0],
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const div = (a: Vec3, b: Vec3): Vec3 => [a[0] / (b[0] || 1), a[1] / (b[1] || 1), a[2] / (b[2] || 1)];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const near = (a: number, b = 0): boolean => Math.abs(a - b) < 1e-5;
const isIdentity = (t: Transform): boolean =>
  t.rotation.slice(0, 3).every((v) => near(v)) && near(t.rotation[3], 1) &&
  t.origin.every((v, i) => near(v, [0, 0, 0][i])) && t.scale.every((v) => near(v, 1));

function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qInverse(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }
function qFromEuler(value: Vec3): Quat {
  const h = value.map((v) => v * Math.PI / 360);
  const [sx, sy, sz] = h.map(Math.sin);
  const [cx, cy, cz] = h.map(Math.cos);
  const x: Quat = [sx, 0, 0, cx], y: Quat = [0, sy, 0, cy], z: Quat = [0, 0, sz, cz];
  return qMul(qMul(x, y), z);
}
function qToEuler(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const r11 = 1 - 2 * (y * y + z * z);
  const r12 = 2 * (x * y - z * w);
  const r13 = 2 * (x * z + y * w);
  const r23 = 2 * (y * z - x * w);
  const r33 = 1 - 2 * (x * x + y * y);
  const pitchY = Math.asin(Math.max(-1, Math.min(1, r13)));
  const cosY = Math.cos(pitchY);
  const rollX = Math.abs(cosY) > 1e-6 ? Math.atan2(-r23, r33) : 0;
  const yawZ = Math.abs(cosY) > 1e-6 ? Math.atan2(-r12, r11) : 0;
  return [rollX, pitchY, yawZ].map((v) => v * 180 / Math.PI) as Vec3;
}
function qRotate(q: Quat, v: Vec3): Vec3 {
  const p: Quat = [v[0], v[1], v[2], 0];
  const result = qMul(qMul(q, p), qInverse(q));
  return [result[0], result[1], result[2]];
}
function channelAt(track: Record<string, unknown> | undefined, name: string, time: number, fallback: Vec3): Vec3 | null {
  const raw = track?.[name];
  if (raw === undefined) return fallback;
  const frames = readChannel(raw);
  if (!frames) return null;
  const value = sampleChannel(frames, time);
  return [value[0] ?? fallback[0], value[1] ?? fallback[1], value[2] ?? fallback[2]];
}
function channelTimes(track: Record<string, unknown> | undefined): number[] {
  const times = new Set<number>();
  for (const name of ['rotation', 'position', 'scale']) {
    const raw = track?.[name];
    if (raw === undefined) continue;
    const frames = readChannel(raw);
    if (frames) for (const frame of frames) times.add(frame.time);
  }
  return [...times];
}
function roundVec(v: Vec3): Vec3 { return v.map((n) => Math.round(n * 100000) / 100000) as Vec3; }
function getBone(profile: readonly PlayerRigBoneProfile[], name: string): PlayerRigBoneProfile | undefined {
  return profile.find((bone) => bone.name === name);
}

/**
 * Converts Java's root-sibling ModelPart transforms into Bedrock's parent-relative bone
 * transforms. Java PlayerEntityModel's head/hat/body/arms/legs and player layers are root parts;
 * Bedrock humanoid.custom nests head/arms under body and layers under their rendered limb.
 *
 * The source part pivots are converted from Java's Y-down 24px model frame to Bedrock's Y-up
 * geometry frame. For every animated parent, child local transforms are solved from world
 * transforms (inverse parent rotation, translated pivot delta), rather than copied or added.
 */
export function retargetJavaPlayerHierarchy(
  clips: Record<string, BedrockAnimationClip>,
  armModel: PlayerArmModel = 'classic',
): { clips: Record<string, BedrockAnimationClip>; transformed: number; warnings: string[] } {
  const target = getPlayerSkeletonProfile('bedrock', armModel).bones;
  const java = getPlayerSkeletonProfile('java', armModel).bones;
  const targetByName = new Map(target.map((bone) => [bone.name, bone]));
  const sourcePivot = new Map<string, Vec3>();
  for (const [sourceName, targetName] of Object.entries(SOURCE_BONE)) {
    const source = getBone(java, sourceName);
    if (source) sourcePivot.set(targetName, javaPivotToBedrockPivot(source.pivot));
  }
  const warnings: string[] = [];
  let transformed = 0;
  const output: Record<string, BedrockAnimationClip> = {};

  for (const [clipId, clip] of Object.entries(clips)) {
    const original = clip.bones ?? {};
    const allTimes = new Set<number>([0]);
    for (const track of Object.values(original)) for (const time of channelTimes(track)) allTimes.add(time);
    const times = [...allTimes].sort((a, b) => a - b);
    const rewritten: Record<string, Record<string, unknown>> = { ...original };
    const world = new Map<string, Transform>();
    const local = new Map<string, Transform>();
    let clipChanged = false;
    let clipUnsupported = false;

    for (const bone of target) {
      const parent = bone.parent ? targetByName.get(bone.parent) : undefined;
      const parentWorld = bone.parent ? world.get(bone.parent) : undefined;
      const parentTransform: Transform = parentWorld ?? { origin: ZERO, rotation: IDENTITY_Q, scale: ONE };
      const ownTrack = original[bone.name];
      const poseSource = SOURCE_POSE_PARENT[bone.name];
      const inheritedTrack = poseSource ? original[poseSource] : undefined;
      const sourceTrack = ownTrack ?? inheritedTrack;
      const hasSourceRigBone = sourcePivot.has(bone.name) || Boolean(poseSource) || bone.name === 'leftItem' || bone.name === 'rightItem';
      if (!hasSourceRigBone && !parentWorld) {
        const pivot = bone.pivot as Vec3;
        world.set(bone.name, { origin: pivot, rotation: IDENTITY_Q, scale: ONE });
        local.set(bone.name, { origin: ZERO, rotation: IDENTITY_Q, scale: ONE });
        continue;
      }
      const targetPivot = bone.pivot as Vec3;
      const parentPivot = (parent?.pivot ?? ZERO) as Vec3;
      const sourcePosition = sourcePivot.get(bone.name) ?? targetPivot;
      const localFrames: { time: number; rotation: Vec3; position: Vec3; scale: Vec3 }[] = [];
      const worldFrames: { time: number; transform: Transform }[] = [];
      let unsupported = false;

      for (const time of times) {
        const rotation = channelAt(sourceTrack, 'rotation', time, ZERO);
        const position = channelAt(sourceTrack, 'position', time, ZERO);
        const boneScale = channelAt(sourceTrack, 'scale', time, ONE);
        if (!rotation || !position || !boneScale) { unsupported = true; break; }
        const desiredRotation = qFromEuler(rotation);
        const desiredOrigin = add(sourcePosition, position);
        const inverseParent = qInverse(parentTransform.rotation);
        const relativeRotation = qMul(inverseParent, desiredRotation);
        const relativeOffset = div(qRotate(inverseParent, sub(desiredOrigin, parentTransform.origin)), parentTransform.scale);
        const relativePosition = sub(relativeOffset, sub(targetPivot, parentPivot));
        const relativeScale = div(boneScale, parentTransform.scale);
        const localTransform: Transform = { origin: relativePosition, rotation: relativeRotation, scale: relativeScale };
        const worldOrigin = add(
          parentTransform.origin,
          qRotate(parentTransform.rotation, mul(parentTransform.scale, add(sub(targetPivot, parentPivot), relativePosition))),
        );
        const worldRotation = qMul(parentTransform.rotation, relativeRotation);
        const worldScale = mul(parentTransform.scale, relativeScale);
        localFrames.push({ time, rotation: qToEuler(relativeRotation), position: relativePosition, scale: relativeScale });
        worldFrames.push({ time, transform: { origin: worldOrigin, rotation: worldRotation, scale: worldScale } });
        if (bone.name === 'root' || bone.name === 'waist') continue;
      }
      if (unsupported) {
        clipUnsupported = true;
        warnings.push(`clip ${clipId}: ${bone.name} has a non-numeric Molang/expression channel; parent compensation was not applied to that bone`);
        if (parentWorld) world.set(bone.name, parentWorld);
        else world.set(bone.name, { origin: targetPivot, rotation: IDENTITY_Q, scale: ONE });
        continue;
      }
      const finalWorld = worldFrames[worldFrames.length - 1]?.transform ?? {
        origin: add(parentTransform.origin, qRotate(parentTransform.rotation, mul(parentTransform.scale, sub(targetPivot, parentPivot)))),
        rotation: parentTransform.rotation,
        scale: parentTransform.scale,
      };
      world.set(bone.name, finalWorld);
      const parentAnimated = Boolean(parentWorld && !isIdentity(parentWorld));
      const explicitOverlay = Boolean(ownTrack && poseSource);
      const needsRewrite = Boolean(ownTrack && parentWorld) || Boolean(parentAnimated && hasSourceRigBone && !poseSource) || explicitOverlay;
      if (needsRewrite && localFrames.length > 0) {
        const rotationFrames = localFrames.map((frame) => ({ time: frame.time, value: frame.rotation }));
        const positionFrames = localFrames.map((frame) => ({ time: frame.time, value: frame.position }));
        const scaleFrames = localFrames.map((frame) => ({ time: frame.time, value: frame.scale }));
        const track: Record<string, unknown> = { ...(ownTrack ?? {}) };
        track.rotation = writeChannel(rotationFrames);
        track.position = writeChannel(positionFrames);
        track.scale = writeChannel(scaleFrames);
        rewritten[bone.name] = track;
        transformed += 1;
        clipChanged = true;
      } else if (ownTrack && parent && !parentWorld) {
        // No animated parent: the original root-relative channels are already correct.
        world.set(bone.name, {
          origin: add(targetPivot, channelAt(ownTrack, 'position', times[times.length - 1], ZERO) ?? ZERO),
          rotation: qFromEuler(channelAt(ownTrack, 'rotation', times[times.length - 1], ZERO) ?? ZERO),
          scale: channelAt(ownTrack, 'scale', times[times.length - 1], ONE) ?? ONE,
        });
      }
    }
    output[clipId] = { ...clip, bones: rewritten };
    if (clipChanged && clipUnsupported) warnings.push(`clip ${clipId}: some tracks were retargeted while expression-driven tracks were preserved as-is`);
  }
  return { clips: output, transformed, warnings };
}
