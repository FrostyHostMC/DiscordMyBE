/**
 * Anatomical bone analysis.
 *
 * Every retargeting failure reported by real ports comes from one mistake: deciding a destination
 * bone by *string similarity* instead of by *anatomy*. `DEF_FOREARM.L` and `head` share no meaning,
 * yet a substring rule that looked for `ear` inside `forearm` classified the forearm as a head
 * family bone, and the fallback then picked a head bone. The limb still "resolved", the track still
 * played, and the character's head rotated with its forearm.
 *
 * This module answers three questions about any bone name, from tokens rather than substrings:
 *
 *   • which body region it belongs to (head / body / arm / leg / wing / tail / item);
 *   • which joint of that region it is (whole limb, proximal, distal, tip) and whether it is the
 *     vanilla outer-layer variant (sleeve / pants / hat / jacket) or the base part;
 *   • whether it is a control node (mechanical, IK/FK target, constraint helper) rather than a
 *     deform bone — a control node carries no geometry, so applying its transform to a rendered
 *     limb twists that limb twice.
 *
 * `anatomyPenalty` turns the comparison into a cost: 0 for an exact anatomical counterpart,
 * a small cost for a documented approximation (a distal joint folded onto the single destination
 * joint), and Infinity when the two bones belong to different body regions. Retargeting never
 * crosses Infinity, so an unrelated limb can no longer receive a source bone's motion.
 */

export type BoneFamily = 'head' | 'body' | 'arm' | 'leg' | 'wing' | 'tail' | 'item' | 'other';

export type BoneSegment = 'whole' | 'proximal' | 'distal' | 'tip';

export interface BoneAnatomy {
  name: string;
  tokens: string[];
  family: BoneFamily;
  side: 'left' | 'right' | null;
  segment: BoneSegment;
  /** Vanilla outer-layer variant (sleeve / pants / hat / jacket). */
  layer: boolean;
  /** Mechanical / IK / constraint control node: carries no geometry of its own. */
  control: boolean;
  /** True when at least one token named a real body part. */
  recognised: boolean;
}

interface PartToken {
  family: BoneFamily;
  segment?: BoneSegment;
  layer?: boolean;
}

const PART_TOKENS: Record<string, PartToken> = {
  // head
  head: { family: 'head' }, skull: { family: 'head' }, cranium: { family: 'head' },
  neck: { family: 'head', segment: 'proximal' }, jaw: { family: 'head', segment: 'distal' },
  face: { family: 'head' }, snout: { family: 'head' }, beak: { family: 'head' },
  nose: { family: 'head' }, hair: { family: 'head' }, ear: { family: 'head', segment: 'tip' },
  ears: { family: 'head', segment: 'tip' }, eye: { family: 'head' }, eyes: { family: 'head' },
  mask: { family: 'head' }, crest: { family: 'head' }, antenna: { family: 'head', segment: 'tip' },
  mandible: { family: 'head' }, tusk: { family: 'head', segment: 'tip' },
  hat: { family: 'head', layer: true }, helmet: { family: 'head', layer: true },
  helm: { family: 'head', layer: true }, cap: { family: 'head', layer: true },

  // body
  body: { family: 'body' }, torso: { family: 'body' }, chest: { family: 'body' },
  waist: { family: 'body' }, hip: { family: 'body' }, hips: { family: 'body' },
  pelvis: { family: 'body' }, abdomen: { family: 'body' }, thorax: { family: 'body' },
  trunk: { family: 'body' }, spine: { family: 'body' }, root: { family: 'body' },
  armature: { family: 'body' }, cape: { family: 'body' }, cloak: { family: 'body' },
  mantle: { family: 'body' }, jacket: { family: 'body', layer: true },
  coat: { family: 'body', layer: true }, vest: { family: 'body', layer: true },

  // arm
  arm: { family: 'arm' }, arms: { family: 'arm' }, shoulder: { family: 'arm', segment: 'proximal' },
  shoulders: { family: 'arm', segment: 'proximal' }, bicep: { family: 'arm', segment: 'proximal' },
  biceps: { family: 'arm', segment: 'proximal' }, elbow: { family: 'arm', segment: 'proximal' },
  upperarm: { family: 'arm', segment: 'proximal' }, lowerarm: { family: 'arm', segment: 'distal' },
  forearm: { family: 'arm', segment: 'distal' }, forearms: { family: 'arm', segment: 'distal' },
  hand: { family: 'arm', segment: 'tip' }, hands: { family: 'arm', segment: 'tip' },
  fist: { family: 'arm', segment: 'tip' }, palm: { family: 'arm', segment: 'tip' },
  wrist: { family: 'arm', segment: 'distal' }, claw: { family: 'arm', segment: 'tip' },
  finger: { family: 'arm', segment: 'tip' }, fingers: { family: 'arm', segment: 'tip' },
  thumb: { family: 'arm', segment: 'tip' }, knuckle: { family: 'arm', segment: 'tip' },
  sleeve: { family: 'arm', layer: true }, sleeves: { family: 'arm', layer: true },

  // leg
  leg: { family: 'leg' }, legs: { family: 'leg' }, thigh: { family: 'leg', segment: 'proximal' },
  thighs: { family: 'leg', segment: 'proximal' }, knee: { family: 'leg', segment: 'proximal' },
  shin: { family: 'leg', segment: 'distal' }, shins: { family: 'leg', segment: 'distal' },
  calf: { family: 'leg', segment: 'distal' }, calves: { family: 'leg', segment: 'distal' },
  ankle: { family: 'leg', segment: 'distal' }, foot: { family: 'leg', segment: 'tip' },
  feet: { family: 'leg', segment: 'tip' }, toe: { family: 'leg', segment: 'tip' },
  toes: { family: 'leg', segment: 'tip' }, heel: { family: 'leg', segment: 'tip' },
  hoof: { family: 'leg', segment: 'tip' },
  pants: { family: 'leg', layer: true }, pant: { family: 'leg', layer: true },
  trouser: { family: 'leg', layer: true }, trousers: { family: 'leg', layer: true },
  leggings: { family: 'leg', layer: true },

  // wing / tail
  wing: { family: 'wing' }, wings: { family: 'wing' }, feather: { family: 'wing', segment: 'tip' },
  flipper: { family: 'wing' }, elytra: { family: 'wing' }, rotor: { family: 'wing' },
  propeller: { family: 'wing' }, sail: { family: 'wing' }, fin: { family: 'wing' },
  tail: { family: 'tail' }, stinger: { family: 'tail', segment: 'tip' },

  // held / attached items
  item: { family: 'item' }, items: { family: 'item' }, tool: { family: 'item' },
  tools: { family: 'item' }, weapon: { family: 'item' }, weapons: { family: 'item' },
  held: { family: 'item' }, helditem: { family: 'item' }, handitem: { family: 'item' },
  prop: { family: 'item' }, props: { family: 'item' }, grip: { family: 'item' },
  grippoint: { family: 'item' }, mainhand: { family: 'item' }, offhand: { family: 'item' },
  handheld: { family: 'item' },
};

/** Compound priority: the most specific region wins (`body_arm_left` is an arm). */
const FAMILY_PRIORITY: BoneFamily[] = ['item', 'wing', 'tail', 'arm', 'leg', 'head', 'body'];

const SIDE_TOKENS: Record<string, 'left' | 'right'> = {
  left: 'left', l: 'left', lt: 'left', lf: 'left', lft: 'left',
  right: 'right', r: 'right', rt: 'right', rg: 'right', rgt: 'right',
};

/** Tokens that describe the rig or an exporter convention, never a body part. */
const SCAFFOLD_TOKENS = new Set([
  'def', 'deform', 'bnd', 'bnp', 'org', 'grp', 'group', 'node', 'bone', 'bones', 'part',
  'parts', 'biped', 'humanoid', 'model', 'models', 'player', 'mesh', 'rig', 'skeleton',
  'pivot', 'joint', 'segment', 'seg', 'main', 'base', 'default', 'layer', 'layers', 'outer',
  'inner', 'overlay', 'anim', 'animation', 'entity', 'bodypart', 'parent', 'child', 'offset',
  'upper', 'lower', 'fore', 'hind', 'front', 'back', 'middle', 'mid', 'top', 'bottom', 'tip',
  'end', 'start', 'leftmost', 'rightmost',
]);

/** Tokens that mark a node as a control (no geometry), not a deform bone. */
const CONTROL_TOKENS = new Set([
  'mch', 'mech', 'ctrl', 'control', 'controller', 'ik', 'fk', 'target', 'pole', 'aux',
  'auxiliary', 'helper', 'constraint', 'locator', 'guide', 'drv', 'driver', 'switch',
]);

/** Proximal / distal words that refine the segment of a neighbouring part token. */
const PROXIMAL_MODIFIERS = new Set(['upper', 'proximal', 'top']);
const DISTAL_MODIFIERS = new Set(['lower', 'distal', 'fore', 'bottom']);
const TIP_MODIFIERS = new Set(['tip', 'end', 'outermost']);

export function splitBoneTokens(name: string): string[] {
  const spaced = (name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return spaced ? spaced.split(/\s+/) : [];
}

const cache = new Map<string, BoneAnatomy>();
const CACHE_LIMIT = 512;

/**
 * Reads one bone name into its anatomical description. Results are cached because retargeting
 * asks the same questions for every track of every clip.
 */
export function describeBoneAnatomy(name: string): BoneAnatomy {
  const key = (name || '').trim();
  const cached = cache.get(key);
  if (cached) return cached;

  const tokens = splitBoneTokens(key);
  let family: BoneFamily = 'other';
  let matchedPart: PartToken | null = null;
  let control = false;
  for (const token of tokens) {
    if (CONTROL_TOKENS.has(token)) control = true;
    const part = PART_TOKENS[token];
    if (!part) continue;
    if (!matchedPart || FAMILY_PRIORITY.indexOf(part.family) < FAMILY_PRIORITY.indexOf(matchedPart.family)) {
      matchedPart = part;
      family = part.family;
    }
  }
  const sideToken = tokens.find((token) => SIDE_TOKENS[token] !== undefined);
  const side = sideToken ? SIDE_TOKENS[sideToken] : null;

  let segment: BoneSegment = matchedPart?.segment ?? 'whole';
  if (matchedPart) {
    if (tokens.some((token) => PROXIMAL_MODIFIERS.has(token)) && segment === 'whole') segment = 'proximal';
    else if (tokens.some((token) => DISTAL_MODIFIERS.has(token)) && segment === 'whole') segment = 'distal';
    else if (tokens.some((token) => TIP_MODIFIERS.has(token)) && segment !== 'tip') segment = 'tip';
  }
  const anatomy: BoneAnatomy = {
    name: key,
    tokens,
    family,
    side,
    segment,
    layer: matchedPart?.layer ?? false,
    control,
    recognised: matchedPart !== null,
  };
  if (cache.size < CACHE_LIMIT) cache.set(key, anatomy);
  return anatomy;
}

export function anatomyFamily(name: string): BoneFamily {
  return describeBoneAnatomy(name).family;
}

/** True for mechanical / IK / constraint nodes that carry no geometry. */
export function isControlBone(name: string): boolean {
  return describeBoneAnatomy(name).control;
}

/** True when a token is neither a body part, a side, nor rig scaffolding (`twist`, `finger_joint`). */
export function hasUnrecognisedTokens(name: string): boolean {
  return describeBoneAnatomy(name).tokens.some(
    (token) =>
      SIDE_TOKENS[token] === undefined &&
      PART_TOKENS[token] === undefined &&
      !SCAFFOLD_TOKENS.has(token) &&
      !CONTROL_TOKENS.has(token) &&
      !/^\d+$/.test(token) &&
      !/^[a-z]+\d+$/.test(token),
  );
}

export function familiesCompatible(source: BoneFamily, destination: BoneFamily): boolean {
  if (source === 'other' || destination === 'other') return false;
  return source === destination;
}

/**
 * Cost of driving `destination` with `source`'s transform.
 *
 *   Infinity — different body region, a control node, or conflicting sides. Never retarget.
 *   0.00     — the same joint (exact anatomical counterpart).
 *   0.10     — the vanilla outer-layer variant of the same joint (arm ↔ sleeve).
 *   0.35     — a finer source joint folded onto the destination's single joint for that limb.
 *   0.55     — two different joints of the same limb.
 */
export function anatomyPenalty(source: string, destination: string): number {
  const from = describeBoneAnatomy(source);
  const to = describeBoneAnatomy(destination);
  if (to.control) return Number.POSITIVE_INFINITY;
  if (!familiesCompatible(from.family, to.family)) return Number.POSITIVE_INFINITY;
  if (from.side && to.side && from.side !== to.side) return Number.POSITIVE_INFINITY;
  const layerShift = from.layer === to.layer ? 0 : 0.1;
  if (from.segment === to.segment) return layerShift;
  // A finer source joint folded onto the destination's single joint for that limb. The base part
  // is preferred over its outer-layer variant, so a forearm resolves to the arm, never the sleeve.
  if (to.segment === 'whole' || from.segment === 'whole') return 0.35 + layerShift;
  return 0.55 + layerShift;
}

/** Human-readable reason a mapping is an approximation, or null when it is exact. */
export function describeApproximation(source: string, destination: string): string | null {
  const from = describeBoneAnatomy(source);
  const to = describeBoneAnatomy(destination);
  const penalty = anatomyPenalty(source, destination);
  if (penalty === 0) return null;
  if (!Number.isFinite(penalty)) return `"${source}" and "${destination}" are not the same body region`;
  if (penalty === 0.1) return `"${destination}" is the outer-layer variant of the joint "${source}" addresses`;
  if (penalty <= 0.4) {
    return `"${source}" is a finer ${from.segment} joint of the ${from.family} and the destination rig has a single ${to.family} joint ("${destination}"), so the ${from.family} moves as one piece`;
  }
  return `"${source}" and "${destination}" are different joints of the same ${to.family}, so the motion is shifted to "${destination}"`;
}