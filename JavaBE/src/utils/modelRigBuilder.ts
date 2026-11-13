import type { IRBone, IRCube } from '@/utils/javaModelIR';

/**
 * Rig builder for entity geometry.
 *
 * Java element models carry no skeleton, so a flat element list has to be grouped into
 * a body plan before it can be written as Bedrock geometry. Grouping is derived from the
 * element's own part/bone name — never from the mob's file name — and the resulting bone
 * names follow Bedrock's conventional limb vocabulary so generated locomotion clips
 * actually drive the limbs instead of animating nothing.
 */

export type RigPart =
  | 'body'
  | 'head'
  | 'left_arm'
  | 'right_arm'
  | 'left_leg'
  | 'right_leg'
  | 'left_front_leg'
  | 'right_front_leg'
  | 'left_hind_leg'
  | 'right_hind_leg'
  | 'left_wing'
  | 'right_wing'
  | 'tail';

const LEG_PARTS: RigPart[] = [
  'left_front_leg',
  'right_front_leg',
  'left_hind_leg',
  'right_hind_leg',
  'left_leg',
  'right_leg',
];

const MIRROR: Partial<Record<RigPart, RigPart>> = {
  left_arm: 'right_arm',
  left_leg: 'right_leg',
  left_wing: 'right_wing',
  left_front_leg: 'right_front_leg',
  left_hind_leg: 'right_hind_leg',
};

const HEAD = /head|skull|jaw|snout|beak|muzzle|horn|ear|crest|mask|face|eye|antenna|tusk|mandible|neck/;
const WING = /wing|feather|flipper|elytra|rotor|propeller|sail/;
const TAIL = /tail|stinger/;
const ARM = /arm|hand|claw|shoulder|forearm|paw|fist/;
const LEG = /leg|foot|feet|thigh|shin|hoof|knee/;

function sideOf(name: string): 'left' | 'right' | null {
  if (/(?:^|[_\- ])(?:l|left)(?:[_\- ]|$)/.test(name) || /^left/.test(name)) return 'left';
  if (/(?:^|[_\- ])(?:r|right)(?:[_\- ]|$)/.test(name) || /^right/.test(name)) return 'right';
  return null;
}

/** Classifies one element/bone name into a rig part, orientation agnostic. */
export function classifyRigPart(raw: string): RigPart {
  const name = (raw || '').toLowerCase();
  // Cosmetic/attachment parts are never body plan limbs, even when their name
  // contains a limb keyword ("armor", "held_item", "hitbox").
  if (/armor|armour|held|hitbox|slot/.test(name)) return 'body';
  const side = sideOf(name);
  if (HEAD.test(name)) return 'head';
  if (WING.test(name)) return side === 'right' ? 'right_wing' : 'left_wing';
  if (TAIL.test(name)) return 'tail';
  if (ARM.test(name)) return side === 'right' ? 'right_arm' : 'left_arm';
  if (LEG.test(name)) {
    if (/front|fore/.test(name)) return side === 'right' ? 'right_front_leg' : 'left_front_leg';
    if (/hind|back|rear/.test(name)) return side === 'right' ? 'right_hind_leg' : 'left_hind_leg';
    return side === 'right' ? 'right_leg' : 'left_leg';
  }
  return 'body';
}

export interface ElementCubeGroup {
  name: string;
  cubes: IRCube[];
}

/**
 * Groups element cubes by rig part. An element that declares no side (a plain `leg`)
 * is mirrored onto the free side so a two-legged model never collapses both limbs into
 * one bone.
 */
export function groupByRigPart(groups: ElementCubeGroup[]): Map<RigPart, IRCube[]> {
  const result = new Map<RigPart, IRCube[]>();
  for (const group of groups) {
    if (group.cubes.length === 0) continue;
    let part = classifyRigPart(group.name);
    const mirror = MIRROR[part];
    if (result.has(part) && mirror && !result.has(mirror)) part = mirror;
    const list = result.get(part) ?? [];
    list.push(...group.cubes);
    result.set(part, list);
  }
  return result;
}

/**
 * Joint pivot for a bone. The joint sits at the cube end closest to the model centre,
 * which keeps the pivot correct regardless of whether the source model counts Y upward
 * or downward.
 */
function pivotOf(part: RigPart, cubes: IRCube[], centerY: number): [number, number, number] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const cube of cubes) {
    minX = Math.min(minX, cube.from[0], cube.to[0]);
    maxX = Math.max(maxX, cube.from[0], cube.to[0]);
    minY = Math.min(minY, cube.from[1], cube.to[1]);
    maxY = Math.max(maxY, cube.from[1], cube.to[1]);
    minZ = Math.min(minZ, cube.from[2], cube.to[2]);
    maxZ = Math.max(maxZ, cube.from[2], cube.to[2]);
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const centerX = round1((minX + maxX) / 2);
  const centerZ = round1((minZ + maxZ) / 2);
  if (part === 'body') return [0, round1((minY + maxY) / 2), 0];
  if (part === 'tail' || part === 'left_wing' || part === 'right_wing') {
    return [centerX, round1((minY + maxY) / 2), centerZ];
  }
  const jointY = Math.abs(minY - centerY) <= Math.abs(maxY - centerY) ? minY : maxY;
  return [centerX, round1(jointY), centerZ];
}

export interface RigBuildResult {
  bones: IRBone[];
  /** True when the element layout has four legs and gets Bedrock's leg0..leg3 naming. */
  quadruped: boolean;
  parts: RigPart[];
}

/**
 * Builds the Bedrock bone hierarchy from grouped cubes: `root` -> `body` ->
 * head / arms / wings / tail, with legs hung off the body. A quadruped limb layout is
 * renamed `leg0`-`leg3` so the quadruped gait clips bind to real bones.
 */
export function buildRigBones(groups: Map<RigPart, IRCube[]>): RigBuildResult {
  const parts = [...groups.keys()];
  const legs = LEG_PARTS.filter((part) => (groups.get(part)?.length ?? 0) > 0);
  const quadruped = legs.length >= 4;
  const allCubes = [...groups.values()].flat();
  let centerY = 0;
  if (allCubes.length > 0) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const cube of allCubes) {
      minY = Math.min(minY, cube.from[1], cube.to[1]);
      maxY = Math.max(maxY, cube.from[1], cube.to[1]);
    }
    centerY = (minY + maxY) / 2;
  }

  const make = (name: string, part: RigPart, cubes: IRCube[], parent?: string): IRBone => {
    const bone: IRBone = { name, pivot: pivotOf(part, cubes, centerY), cubes };
    if (parent) bone.parent = parent;
    return bone;
  };

  if (parts.length <= 1) {
    const part = parts[0];
    if (!part) return { bones: [], quadruped: false, parts };
    const cubes = groups.get(part) ?? [];
    return { bones: [make(part, part, cubes)], quadruped, parts };
  }

  const hasBody = (groups.get('body')?.length ?? 0) > 0;
  const bones: IRBone[] = [{ name: 'root', pivot: [0, 0, 0], cubes: [] }];
  const legIndex = new Map(legs.map((part, index) => [part, index]));
  const order: RigPart[] = [
    'body',
    'head',
    'left_arm',
    'right_arm',
    'left_wing',
    'right_wing',
    'tail',
    ...LEG_PARTS,
  ];

  for (const part of order) {
    const cubes = groups.get(part);
    if (!cubes || cubes.length === 0) continue;
    const isLeg = legIndex.has(part);
    const name = quadruped && isLeg ? `leg${legIndex.get(part)}` : part;
    const parent = part === 'body' ? 'root' : hasBody ? 'body' : 'root';
    bones.push(make(name, part, cubes, parent));
  }

  return { bones, quadruped, parts };
}