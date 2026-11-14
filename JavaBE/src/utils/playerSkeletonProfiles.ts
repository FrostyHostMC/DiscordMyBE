/**
 * Vanilla player rig contracts sourced from Java 1.21.x PlayerEntityModel/BipedEntityModel
 * and Mojang bedrock-samples humanoid.custom.geo.json + geometry.humanoid.customSlim.
 * Both platforms use 16 model pixels per block. Java player parts are root siblings; Bedrock
 * has root -> waist -> body -> head/arms and root -> legs. Slim changes arm width and Bedrock
 * arm/item pivots, not the semantic bone names.
 */
export type PlayerArmModel = 'classic' | 'slim';
export type PlayerRigPlatform = 'java' | 'bedrock';
export interface PlayerRigBoneProfile {
  name: string;
  parent: string | null;
  pivot: readonly [number, number, number];
  size: readonly [number, number, number] | null;
  role: 'deform' | 'overlay' | 'root' | 'attachment';
}
export interface PlayerSkeletonProfile {
  id: string;
  platform: PlayerRigPlatform;
  armModel: PlayerArmModel;
  coordinateUnit: 'model-pixel';
  bones: readonly PlayerRigBoneProfile[];
}
const java = (armModel: PlayerArmModel): PlayerRigBoneProfile[] => {
  const armWidth = armModel === 'slim' ? 3 : 4;
  return [
    { name: 'root', parent: null, pivot: [0, 0, 0], size: null, role: 'root' },
    { name: 'head', parent: 'root', pivot: [0, 0, 0], size: [8, 8, 8], role: 'deform' },
    { name: 'hat', parent: 'root', pivot: [0, 0, 0], size: [8, 8, 8], role: 'overlay' },
    { name: 'body', parent: 'root', pivot: [0, 0, 0], size: [8, 12, 4], role: 'deform' },
    { name: 'right_arm', parent: 'root', pivot: [-5, 2, 0], size: [armWidth, 12, 4], role: 'deform' },
    { name: 'left_arm', parent: 'root', pivot: [5, 2, 0], size: [armWidth, 12, 4], role: 'deform' },
    { name: 'right_leg', parent: 'root', pivot: [-1.9, 12, 0], size: [4, 12, 4], role: 'deform' },
    { name: 'left_leg', parent: 'root', pivot: [1.9, 12, 0], size: [4, 12, 4], role: 'deform' },
    { name: 'right_sleeve', parent: 'root', pivot: [-5, 2, 0], size: [armWidth, 12, 4], role: 'overlay' },
    { name: 'left_sleeve', parent: 'root', pivot: [5, 2, 0], size: [armWidth, 12, 4], role: 'overlay' },
    { name: 'right_pants', parent: 'root', pivot: [-1.9, 12, 0], size: [4, 12, 4], role: 'overlay' },
    { name: 'left_pants', parent: 'root', pivot: [1.9, 12, 0], size: [4, 12, 4], role: 'overlay' },
    { name: 'jacket', parent: 'root', pivot: [0, 0, 0], size: [8, 12, 4], role: 'overlay' },
    { name: 'cloak', parent: 'root', pivot: [0, 0, 0], size: null, role: 'overlay' },
  ];
};
const bedrockClassic: PlayerRigBoneProfile[] = [
  { name: 'root', parent: null, pivot: [0, 0, 0], size: null, role: 'root' },
  { name: 'waist', parent: 'root', pivot: [0, 12, 0], size: null, role: 'root' },
  { name: 'body', parent: 'waist', pivot: [0, 24, 0], size: [8, 12, 4], role: 'deform' },
  { name: 'head', parent: 'body', pivot: [0, 24, 0], size: [8, 8, 8], role: 'deform' },
  { name: 'hat', parent: 'head', pivot: [0, 24, 0], size: [8, 8, 8], role: 'overlay' },
  { name: 'leftArm', parent: 'body', pivot: [5, 22, 0], size: [4, 12, 4], role: 'deform' },
  { name: 'leftSleeve', parent: 'leftArm', pivot: [5, 22, 0], size: [4, 12, 4], role: 'overlay' },
  { name: 'leftItem', parent: 'leftArm', pivot: [6, 15, 1], size: null, role: 'attachment' },
  { name: 'rightArm', parent: 'body', pivot: [-5, 22, 0], size: [4, 12, 4], role: 'deform' },
  { name: 'rightSleeve', parent: 'rightArm', pivot: [-5, 22, 0], size: [4, 12, 4], role: 'overlay' },
  { name: 'rightItem', parent: 'rightArm', pivot: [-6, 15, 1], size: null, role: 'attachment' },
  { name: 'leftLeg', parent: 'root', pivot: [1.9, 12, 0], size: [4, 12, 4], role: 'deform' },
  { name: 'leftPants', parent: 'leftLeg', pivot: [1.9, 12, 0], size: [4, 12, 4], role: 'overlay' },
  { name: 'rightLeg', parent: 'root', pivot: [-1.9, 12, 0], size: [4, 12, 4], role: 'deform' },
  { name: 'rightPants', parent: 'rightLeg', pivot: [-1.9, 12, 0], size: [4, 12, 4], role: 'overlay' },
  { name: 'jacket', parent: 'body', pivot: [0, 24, 0], size: [8, 12, 4], role: 'overlay' },
  { name: 'cape', parent: 'body', pivot: [0, 24, 3], size: null, role: 'overlay' },
];
const bedrockSlim = bedrockClassic.map((bone) => {
  if (bone.name === 'leftArm' || bone.name === 'leftSleeve') return { ...bone, pivot: [5, 21.5, 0] as const, size: bone.size ? [3, 12, 4] as const : null };
  if (bone.name === 'rightArm' || bone.name === 'rightSleeve') return { ...bone, pivot: [-5, 21.5, 0] as const, size: bone.size ? [3, 12, 4] as const : null };
  if (bone.name === 'leftItem') return { ...bone, pivot: [6, 14.5, 1] as const };
  if (bone.name === 'rightItem') return { ...bone, pivot: [-6, 14.5, 1] as const };
  return bone;
});
export const PLAYER_SKELETON_PROFILES: Record<PlayerRigPlatform, Record<PlayerArmModel, PlayerSkeletonProfile>> = {
  java: {
    classic: { id: 'java-player-classic-1.21', platform: 'java', armModel: 'classic', coordinateUnit: 'model-pixel', bones: java('classic') },
    slim: { id: 'java-player-slim-1.21', platform: 'java', armModel: 'slim', coordinateUnit: 'model-pixel', bones: java('slim') },
  },
  bedrock: {
    classic: { id: 'bedrock-player-classic-mojang-samples', platform: 'bedrock', armModel: 'classic', coordinateUnit: 'model-pixel', bones: bedrockClassic },
    slim: { id: 'bedrock-player-slim-mojang-samples', platform: 'bedrock', armModel: 'slim', coordinateUnit: 'model-pixel', bones: bedrockSlim },
  },
};
export const BEDROCK_PLAYER_BONE_NAMES = bedrockClassic.map((bone) => bone.name) as readonly string[];
export function getPlayerSkeletonProfile(platform: PlayerRigPlatform, armModel: PlayerArmModel): PlayerSkeletonProfile {
  return PLAYER_SKELETON_PROFILES[platform][armModel];
}
function normaliseBoneName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
/** Bone names are identical across variants; cube width is the reliable classic/slim discriminator. */
export function detectPlayerArmModelFromGeometry(geometry: unknown): PlayerArmModel | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const doc = geometry as Record<string, unknown>;
  const list = Array.isArray(doc['minecraft:geometry']) ? doc['minecraft:geometry'] as Array<Record<string, unknown>> : [doc];
  const widths: number[] = [];
  for (const candidate of list) {
    const bones = Array.isArray(candidate.bones) ? candidate.bones as Array<Record<string, unknown>> : [];
    for (const bone of bones) {
      const name = normaliseBoneName(String(bone.name ?? ''));
      if (name !== 'leftarm' && name !== 'rightarm') continue;
      const cubes = Array.isArray(bone.cubes) ? bone.cubes as Array<Record<string, unknown>> : [];
      for (const cube of cubes) if (Array.isArray(cube.size) && typeof cube.size[0] === 'number') widths.push(cube.size[0]);
    }
  }
  if (!widths.length) return null;
  const width = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  if (Math.abs(width - 3) < 0.01) return 'slim';
  if (Math.abs(width - 4) < 0.01) return 'classic';
  return null;
}
export function detectPlayerArmModelFromEvidence(evidence: string[]): PlayerArmModel | null {
  const text = evidence.join('\n').toLowerCase();
  if (/slim|thin_arms|thinarm|alex/.test(text)) return 'slim';
  if (/wide_arms|widearm|steve|classic/.test(text)) return 'classic';
  return null;
}
/** ModelPart pivots are local to each part; this helper converts the Java rig's Y-down pivot frame to Bedrock's geometry frame. */
export function javaPivotToBedrockPivot(pivot: readonly [number, number, number], javaModelHeight = 24): [number, number, number] {
  return [pivot[0], javaModelHeight - pivot[1], pivot[2]];
}
