/**
 * Shared Java → Bedrock player-skeleton alias table.
 *
 * Java player animation mods (ModelPart rigs, PlayerAnimator/Emotecraft channels, GeckoLib
 * humanoids) name the same bones in wildly different ways: `left_arm`, `armLeft`, `lArm`,
 * `upper_arm_left`, `body_arm_left`, `left_arm_layer`. Rather than growing one hardcoded name
 * per mod, this module resolves a source bone in two evidence-driven steps:
 *
 *   1. exact skeleton name or an irregular synonym that no structural rule can derive
 *      (`skull`, `torso`, `cloak`, `helmet` …);
 *   2. token composition — a side token (`left`/`right`/`l`/`r`/`lt`/`rt` …) plus a part token
 *      (`arm`, `forearm`, `thigh`, `shin`, `foot`, `hand`, `hat`, `body`, `cape` …) that yields
 *      the Bedrock bone, including the vanilla outer-layer convention where `*_layer`
 *      resolves to sleeve / pants / hat / jacket.
 *
 * Anything the tokens cannot resolve stays unresolved. Nothing is guessed from a mod name,
 * a clip name or a file name, and every non-exact mapping is flagged `approximated`.
 */

export const PLAYER_SKELETON_BONES = [
  'root', 'waist', 'head', 'hat', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg',
  'leftSleeve', 'rightSleeve', 'leftPants', 'rightPants', 'jacket', 'cape', 'leftItem', 'rightItem',
] as const;

export type PlayerSkeletonBone = (typeof PLAYER_SKELETON_BONES)[number];

export type BoneAliasRoute = 'canonical' | 'alias' | 'compound' | 'suffix' | 'learned';

export interface BoneAliasResolution {
  bone: PlayerSkeletonBone;
  approximated: boolean;
  via: BoneAliasRoute;
}

export interface BoneAliasSuggestion {
  name: string;
  bone: PlayerSkeletonBone | null;
  reason: string;
}

type Side = 'left' | 'right';
type PlayerBonePart =
  | 'arm' | 'leg' | 'head' | 'hat' | 'body' | 'sleeve' | 'pants' | 'jacket' | 'cape' | 'item';
type SidedPart = 'arm' | 'leg' | 'sleeve' | 'pants' | 'item';

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const SIDE_TOKENS: Record<string, Side> = {
  left: 'left', l: 'left', lt: 'left', lf: 'left', lft: 'left',
  right: 'right', r: 'right', rt: 'right', rg: 'right', rgt: 'right',
  // Java rigs name the holding slot instead of the side; main hand is the right hand in the
  // Bedrock player skeleton, the off hand is the left.
  mainhand: 'right', righthand: 'right', offhand: 'left', lefthand: 'left',
};

const PART_TOKENS: Record<string, PlayerBonePart> = {
  arm: 'arm', arms: 'arm', upperarm: 'arm', lowerarm: 'arm', forearm: 'arm', forearms: 'arm',
  bicep: 'arm', biceps: 'arm', shoulder: 'arm', shoulders: 'arm', elbow: 'arm', hand: 'arm',
  hands: 'arm', wrist: 'arm', fist: 'arm', palm: 'arm',
  leg: 'leg', legs: 'leg', upperleg: 'leg', lowerleg: 'leg', thigh: 'leg', thighs: 'leg',
  calf: 'leg', calves: 'leg', shin: 'leg', shins: 'leg', knee: 'leg', knees: 'leg',
  foot: 'leg', feet: 'leg', ankle: 'leg', ankles: 'leg', toe: 'leg', toes: 'leg',
  head: 'head', skull: 'head', face: 'head', neck: 'head', ear: 'head', ears: 'head',
  nose: 'head', hair: 'head', beard: 'head', jaw: 'head',
  hat: 'hat', helmet: 'hat', helm: 'hat', cap: 'hat', headwear: 'hat',
  body: 'body', torso: 'body', chest: 'body', spine: 'body', upperbody: 'body',
  lowerbody: 'body', waist: 'body', hips: 'body', hip: 'body', pelvis: 'body',
  trunk: 'body', abdomen: 'body',
  sleeve: 'sleeve', sleeves: 'sleeve', armcover: 'sleeve',
  pants: 'pants', pant: 'pants', trouser: 'pants', trousers: 'pants', leggings: 'pants',
  jacket: 'jacket', coat: 'jacket', vest: 'jacket',
  cape: 'cape', cloak: 'cape', mantle: 'cape',
  item: 'item', items: 'item', helditem: 'item', handitem: 'item', held: 'item',
  // Held-item attachment points. A source rig rarely calls them "item": Java animation mods use
  // tool / weapon / prop / grip / socket nodes that exist only to position what the hand holds, and
  // the Bedrock player rig expresses exactly that with its leftItem / rightItem bones.
  tool: 'item', tools: 'item', weapon: 'item', weapons: 'item', prop: 'item', props: 'item',
  grip: 'item', grippoint: 'item', handheld: 'item', attachment: 'item', attach: 'item',
};

/** Most specific part wins when a compounded name carries more than one (`body_arm_left`). */
const PART_PRIORITY: PlayerBonePart[] = [
  'item', 'sleeve', 'pants', 'arm', 'leg', 'hat', 'head', 'jacket', 'cape', 'body',
];

const SIDED_PARTS: SidedPart[] = ['arm', 'leg', 'sleeve', 'pants', 'item'];

const SIDED_BONES: Record<Side, Record<SidedPart, PlayerSkeletonBone>> = {
  left: { arm: 'leftArm', leg: 'leftLeg', sleeve: 'leftSleeve', pants: 'leftPants', item: 'leftItem' },
  right: { arm: 'rightArm', leg: 'rightLeg', sleeve: 'rightSleeve', pants: 'rightPants', item: 'rightItem' },
};

const UNSIDED_BONES: Partial<Record<PlayerBonePart, PlayerSkeletonBone>> = {
  head: 'head', hat: 'hat', body: 'body', jacket: 'jacket', cape: 'cape',
};

/**
 * Tokens that only describe the rig or how it was exported — never a custom sub-bone. They are
 * ignored when deciding whether a name is a plain skeleton bone (`biped_left_arm`,
 * `model_right_leg`, `left_arm_outer_overlay` all still resolve).
 */
const SCAFFOLD_TOKENS = new Set([
  'biped', 'model', 'models', 'part', 'parts', 'player', 'players', 'humanoid',
  'armor', 'armour', 'outer', 'inner', 'overlay', 'mesh', 'node', 'group', 'joint',
  'root', 'default', 'main', 'base', 'bone', 'bones', 'rig', 'skeleton', 'layer', 'layers',
  'anim', 'animation', 'entity', 'bodypart',
  // Rig conventions: deform-bone prefixes, mechanical/IK control nodes, sockets and pivots. These
  // describe HOW the source rig is built, never a new body part, so they must not make an
  // attachment bone look like an unmappable custom joint.
  'def', 'deform', 'bnd', 'bnp', 'org', 'pivot', 'segment', 'seg', 'parent', 'child',
  'mch', 'mech', 'ctrl', 'control', 'controller', 'ik', 'fk', 'target', 'pole', 'aux',
  'auxiliary', 'helper', 'constraint', 'locator', 'guide', 'drv', 'driver', 'switch',
  'socket', 'anchor', 'mount', 'attach', 'attachment', 'offset',
  'upper', 'lower', 'fore', 'hind', 'front', 'back', 'middle', 'mid', 'top', 'bottom',
  'end', 'start', 'roll', 'twistholder',
]);

/**
 * True when a source bone name carries a token no side/part rule explains (`left_wrist_twist`,
 * `finger_joint`, `right_ear_tip`). Such a name is a custom sub-bone: folding it onto the whole
 * arm or head would rotate the limb twice and read in game as a stretched body, so it is left
 * unresolved for the bone injector instead of being approximated onto a skeleton bone.
 */
export function hasCustomBoneTokens(rawName: string): boolean {
  return boneNameTokens(rawName).some(
    (token) =>
      SIDE_TOKENS[token] === undefined &&
      PART_TOKENS[token] === undefined &&
      !SCAFFOLD_TOKENS.has(token) &&
      // Indexed duplicates (`left_arm_2`, `arm2`) address the same bone twice, not a new one.
      !/^\d+$/.test(token) &&
      !/^[a-z]+\d+$/.test(token),
  );
}

/**
 * Irregular Java spellings with no derivable side/part pair. Kept short on purpose: anything
 * the token rules can compose (`left_forearm`, `right_calf`, `armLeft`) is NOT listed here.
 */
const IRREGULAR_ALIASES: Array<[string, PlayerSkeletonBone]> = [
  ['skull', 'head'], ['face', 'head'], ['cranium', 'head'], ['headbone', 'head'],
  ['helmet', 'hat'], ['helm', 'hat'], ['cap', 'hat'], ['headlayer', 'hat'], ['outerhead', 'hat'],
  ['torso', 'body'], ['chest', 'body'], ['spine', 'body'], ['upperbody', 'body'],
  ['lowerbody', 'body'], ['hips', 'body'], ['hip', 'body'],
  ['pelvis', 'body'], ['trunk', 'body'], ['abdomen', 'body'],
  ['cloak', 'cape'], ['mantle', 'cape'], ['backcape', 'cape'], ['caplayer', 'cape'],
  ['coat', 'jacket'], ['vest', 'jacket'], ['bodylayer', 'jacket'],
  ['leftlegging', 'leftPants'], ['rightlegging', 'rightPants'],
  ['larm', 'leftArm'], ['rarm', 'rightArm'],
];

const canonicalIndex = new Map<string, PlayerSkeletonBone>(
  PLAYER_SKELETON_BONES.map((bone) => [normalize(bone), bone] as [string, PlayerSkeletonBone]),
);
const aliasIndex = new Map<string, PlayerSkeletonBone>(
  IRREGULAR_ALIASES.map(([alias, bone]) => [normalize(alias), bone] as [string, PlayerSkeletonBone]),
);
/** Conventions learned at runtime from unmapped bone reports (session scoped). */
const learnedIndex = new Map<string, PlayerSkeletonBone>();

/** Splits `body_armLeft` / `LeftArm` / `left-pants` into normalized part tokens. */
export function boneNameTokens(rawName: string): string[] {
  const spaced = rawName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return spaced ? spaced.split(/\s+/) : [];
}

function composeBone(part: PlayerBonePart, side: Side | null): PlayerSkeletonBone | null {
  if (SIDED_PARTS.includes(part as SidedPart)) {
    return side ? SIDED_BONES[side][part as SidedPart] : null;
  }
  return UNSIDED_BONES[part] ?? null;
}

/** Derives a Bedrock player bone from side + part tokens, or explains why it cannot. */
export function derivePlayerBoneFromTokens(
  rawName: string,
): { bone: PlayerSkeletonBone | null; reason: string } {
  const tokens = boneNameTokens(rawName);
  if (tokens.length === 0) {
    return { bone: null, reason: 'the name carries no alphanumeric tokens to read a part from' };
  }
  const sideToken = tokens.find((token) => SIDE_TOKENS[token] !== undefined);
  const side: Side | null = sideToken ? SIDE_TOKENS[sideToken] : null;
  const parts = new Set<PlayerBonePart>();
  for (const token of tokens) {
    const part = PART_TOKENS[token];
    if (part) parts.add(part);
  }
  if (parts.size === 0) {
    return {
      bone: null,
      reason:
        'no Java humanoid part token (head / hat / body / arm / leg / sleeve / pants / jacket / cape / item) appears in the name',
    };
  }
  let selected = PART_PRIORITY.find((part) => parts.has(part));
  if (!selected) {
    return { bone: null, reason: 'the name carries part tokens but none is a Bedrock player-skeleton part' };
  }
  const layered = tokens.includes('layer');
  if (layered) {
    if (selected === 'arm') selected = 'sleeve';
    else if (selected === 'leg') selected = 'pants';
    else if (selected === 'head') selected = 'hat';
    else if (selected === 'body') selected = 'jacket';
  }
  const bone = composeBone(selected, side);
  if (bone) {
    const scope = `${side ? `${side} ` : ''}${selected}${layered ? ' (outer layer)' : ''}`;
    return { bone, reason: `tokens compose to ${scope}` };
  }
  return {
    bone: null,
    reason: `part "${selected}" is a sided skeleton bone and the name states no left/right side`,
  };
}

/** Resolves one Java bone name onto the Bedrock player skeleton, or returns null. */
export function resolvePlayerBone(rawName: string): BoneAliasResolution | null {
  const key = normalize(rawName);
  if (!key) return null;
  const canonical = canonicalIndex.get(key);
  if (canonical) return { bone: canonical, approximated: false, via: 'canonical' };
  const irregular = aliasIndex.get(key);
  if (irregular) return { bone: irregular, approximated: true, via: 'alias' };
  const learned = learnedIndex.get(key);
  if (learned) return { bone: learned, approximated: true, via: 'learned' };
  const derived = derivePlayerBoneFromTokens(rawName);
  if (derived.bone) return { bone: derived.bone, approximated: true, via: 'compound' };
  // Last resort: a prefixed spelling (`player_left_arm`, `model_body`, `bipedHead`) whose tail
  // is a table entry long enough to be distinctive.
  for (const [aliasKey, bone] of [...aliasIndex, ...canonicalIndex]) {
    if (aliasKey.length >= 6 && key.endsWith(aliasKey)) {
      return { bone, approximated: true, via: 'suffix' };
    }
  }
  return null;
}

/** Adds a convention discovered from an unmapped report. Existing entries are never replaced. */
export function registerLearnedBoneAlias(rawName: string, bone: PlayerSkeletonBone): boolean {
  const key = normalize(rawName);
  if (!key || canonicalIndex.has(key) || aliasIndex.has(key) || learnedIndex.has(key)) return false;
  learnedIndex.set(key, bone);
  return true;
}

export function getLearnedBoneAliases(): Array<[string, PlayerSkeletonBone]> {
  return [...learnedIndex.entries()];
}

export function getPlayerBoneAliasStats(): {
  canonical: number;
  alias: number;
  learned: number;
  total: number;
} {
  return {
    canonical: canonicalIndex.size,
    alias: aliasIndex.size,
    learned: learnedIndex.size,
    total: canonicalIndex.size + aliasIndex.size + learnedIndex.size,
  };
}