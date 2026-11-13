import type { IRBone, IRCube } from '@/utils/javaModelIR';
import { classifyRigPart } from '@/utils/modelRigBuilder';
import { anatomyFamily } from '@/utils/boneAnatomy';

/**
 * Universal bone graph.
 *
 * A Java element model has no skeleton: it is a flat list of cubes that may or may not carry
 * a part name. The previous grouping collapsed every element into a fixed thirteen-part body
 * plan, so a modded creature whose limbs are named `tentacle_1`, `abdomen`, `pincer_left` or
 * `mandible` had all of those cubes melted into `body` — the model still drew, but the
 * skeleton an animation drives no longer existed, and a source clip naming `tentacle_1`
 * animated nothing.
 *
 * This module keeps every source part name and rebuilds a real hierarchy from the only
 * evidence available: the names themselves (prefix nesting such as `arm_left_upper` under
 * `arm_left`), the cube bounds (a part whose cubes sit inside another part's bounds is its
 * child) and, failing both, the conventional body plan. Nothing is invented: a bone that
 * existed in the source keeps its name, and every bone that gains a parent is reported.
 */

export interface SourceBoneGroup {
  /** Part/bone name declared by the source element, before any normalisation. */
  name: string;
  cubes: IRCube[];
  /** Source pivot when the format declares one (GeckoLib, Blockbench, bedrock geometry). */
  pivot?: [number, number, number];
  /** Explicit parent declared by the source document, when it has one. */
  parentHint?: string;
}

export interface SourceBoneGraphResult {
  bones: IRBone[];
  /** Four or more limbs on the ground plane — the document gains `leg0..leg3` digest bones. */
  quadruped: boolean;
  /** Bones whose source name was carried verbatim. */
  preservedNames: number;
  parentedByContainment: number;
  parentedByConvention: number;
  /** `null` when the document has a single root; the synth root is reported instead. */
  syntheticRoot: boolean;
  renamed: string[];
  parts: string[];
}

const ROOT_NAMES = /^(root|origin|all|main|base|armature|skeleton|master)$/i;
const BODY_LIKE = /body|torso|chest|waist|hip|pelvis|abdomen|thorax|trunk|shell|carapace|spine/i;

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function boundsOf(cubes: IRCube[]): Bounds | null {
  let b: Bounds | null = null;
  for (const cube of cubes) {
    const xs = [cube.from[0], cube.to[0]];
    const ys = [cube.from[1], cube.to[1]];
    const zs = [cube.from[2], cube.to[2]];
    if (!b) {
      b = {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
      };
      continue;
    }
    b.minX = Math.min(b.minX, ...xs);
    b.maxX = Math.max(b.maxX, ...xs);
    b.minY = Math.min(b.minY, ...ys);
    b.maxY = Math.max(b.maxY, ...ys);
    b.minZ = Math.min(b.minZ, ...zs);
    b.maxZ = Math.max(b.maxZ, ...zs);
  }
  return b;
}

function contains(outer: Bounds, inner: Bounds): boolean {
  const pad = 0.51;
  return (
    inner.minX >= outer.minX - pad && inner.maxX <= outer.maxX + pad &&
    inner.minY >= outer.minY - pad && inner.maxY <= outer.maxY + pad &&
    inner.minZ >= outer.minZ - pad && inner.maxZ <= outer.maxZ + pad
  );
}

function volume(b: Bounds): number {
  return Math.abs(b.maxX - b.minX) * Math.abs(b.maxY - b.minY) * Math.abs(b.maxZ - b.minZ);
}

/** Bedrock bone names are free-form, but never allowed to break JSON tooling or collapse. */
export function sanitizeBoneName(raw: string, fallbackIndex: number): string {
  const trimmed = (raw || '').trim();
  const cleaned = trimmed
    .replace(/[^A-Za-z0-9_.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.\-]+|[_.\-]+$/g, '');
  if (cleaned) return cleaned;
  return `bone_${fallbackIndex + 1}`;
}

/** Joint pivot: the cube end closest to the model centre, so the joint sits where it bends. */
function jointPivot(name: string, cubes: IRCube[], centerY: number): [number, number, number] {
  const b = boundsOf(cubes);
  if (!b) return [0, 0, 0];
  const centerX = round1((b.minX + b.maxX) / 2);
  const centerZ = round1((b.minZ + b.maxZ) / 2);
  if (BODY_LIKE.test(name)) return [0, round1((b.minY + b.maxY) / 2), 0];
  if (/wing|tail|stinger|fin/i.test(name)) return [centerX, round1((b.minY + b.maxY) / 2), centerZ];
  const jointY = Math.abs(b.minY - centerY) <= Math.abs(b.maxY - centerY) ? b.minY : b.maxY;
  return [centerX, round1(jointY), centerZ];
}

interface Entry {
  name: string;
  raw: string;
  cubes: IRCube[];
  pivot?: [number, number, number];
  bounds: Bounds | null;
  parent?: string;
}

/**
 * Builds a Bedrock bone hierarchy that preserves every source part name.
 * A part is only re-parented inside its own document; no bone is ever created for a part the
 * source does not describe, apart from one `root` when the document declares several roots.
 */
export function buildSourceBoneGraph(groups: SourceBoneGroup[]): SourceBoneGraphResult {
  const result: SourceBoneGraphResult = {
    bones: [],
    quadruped: false,
    preservedNames: 0,
    parentedByContainment: 0,
    parentedByConvention: 0,
    syntheticRoot: false,
    renamed: [],
    parts: [],
  };
  // A group that owns no cube can still be a real bone: Blockbench outliners and GeckoLib
  // models both express shoulders and armatures as empty parent groups. Such a group is kept
  // whenever another part names it as its parent — dropping it detaches the whole limb.
  const hintedNames = new Set(
    groups.map((group) => (group.parentHint ?? '').trim()).filter(Boolean),
  );
  const usable = groups.filter(
    (group) => group.cubes.length > 0 || hintedNames.has(group.name.trim()),
  );
  if (usable.length === 0) return result;

  const used = new Set<string>();
  const entries: Entry[] = [];
  for (let index = 0; index < usable.length; index += 1) {
    const group = usable[index];
    let name = sanitizeBoneName(group.name, index);
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name}_${suffix}`)) suffix += 1;
      result.renamed.push(`${group.name || '(unnamed)'} -> ${name}_${suffix}`);
      name = `${name}_${suffix}`;
    }
    // A part that declares no name keeps a stable generated bone (`bone_2`, …) so it still
    // renders; the converter's fixed rig-part fallback names the whole skeleton instead when
    // an element list carries no names at all.
    used.add(name);
    entries.push({
      name,
      raw: (group.name || '').trim(),
      cubes: group.cubes,
      pivot: group.pivot,
      bounds: boundsOf(group.cubes),
    });
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const byCanonical = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key && !byCanonical.has(key)) byCanonical.set(key, entry.name);
  }

  const parentOf = new Map<string, string>();
  const wouldCycle = (child: string, parent: string): boolean => {
    let cursor: string | undefined = parent;
    let guard = 0;
    while (cursor && guard < 64) {
      if (cursor === child) return true;
      cursor = parentOf.get(cursor);
      guard += 1;
    }
    return false;
  };

  // 1. Explicit parent declared by the source document wins over any inference.
  for (const entry of entries) {
    const hint = (entry.parentHint ?? '').trim();
    if (!hint) continue;
    const resolved =
      byName.get(hint) ??
      byCanonical.get(hint.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (resolved && resolved !== entry.name && !wouldCycle(entry.name, resolved)) {
      entry.parent = resolved;
      parentOf.set(entry.name, resolved);
    }
  }

  // 2. Name nesting: `arm_left_upper` is a child of `arm_left`, which is a child of `arm`.
  for (const entry of entries) {
    if (entry.parent) continue;
    const lower = entry.name.toLowerCase();
    let best: Entry | null = null;
    for (const candidate of entries) {
      if (candidate.name === entry.name) continue;
      const prefix = candidate.name.toLowerCase();
      if (prefix.length < 3 || prefix.length >= lower.length) continue;
      if (!lower.startsWith(prefix)) continue;
      const next = lower.charAt(prefix.length);
      if (next !== '_' && next !== '-' && next !== '.') continue;
      if (!best || candidate.name.length > best.name.length) best = candidate;
    }
    if (best && !wouldCycle(entry.name, best.name)) {
      entry.parent = best.name;
      parentOf.set(entry.name, best.name);
    }
  }

  // 3. Bounds containment: a part whose cubes sit inside another part's cubes is its child.
  for (const entry of entries) {
    if (entry.parent || !entry.bounds) continue;
    let best: Entry | null = null;
    let bestVolume = Infinity;
    for (const candidate of entries) {
      if (candidate.name === entry.name || !candidate.bounds) continue;
      if (!contains(candidate.bounds, entry.bounds)) continue;
      const candidateVolume = volume(candidate.bounds);
      if (candidateVolume <= volume(entry.bounds) * 1.02) continue;
      if (candidateVolume < bestVolume && !wouldCycle(entry.name, candidate.name)) {
        best = candidate;
        bestVolume = candidateVolume;
      }
    }
    if (best) {
      entry.parent = best.name;
      parentOf.set(entry.name, best.name);
      result.parentedByContainment += 1;
    }
  }

  // 4. Convention: heads hang off the body, limbs hang off the body, everything else off the
  //    nearest root. This only ever attaches to a part that really exists.
  const rootEntry =
    entries.find((entry) => ROOT_NAMES.test(entry.name) && !entry.parent) ??
    entries.find((entry) => ROOT_NAMES.test(entry.name)) ??
    null;
  const bodyEntry =
    entries.find((entry) => BODY_LIKE.test(entry.name) && entry.name !== rootEntry?.name) ?? null;
  for (const entry of entries) {
    if (entry.parent) continue;
    if (entry === rootEntry) continue;
    // Body region decided by the shared anatomical tokenizer, never by substring: "forearm"
    // contains "ear", so a substring head test hung every forearm off the head. A limb and a head
    // both attach to the body, and a part whose region the tokens cannot read keeps the root anchor.
    const family = anatomyFamily(entry.name);
    const limbPart = family !== 'body' && family !== 'other';
    const anchor = limbPart ? bodyEntry ?? rootEntry : rootEntry ?? bodyEntry;
    if (anchor && anchor.name !== entry.name && !wouldCycle(entry.name, anchor.name)) {
      entry.parent = anchor.name;
      parentOf.set(entry.name, anchor.name);
      result.parentedByConvention += 1;
    }
  }

  // 5. One root. Several parentless parts would each be drawn at the entity origin, so a
  //    single `root` bone is declared and the parentless parts hang off it.
  const roots = entries.filter((entry) => !entry.parent);
  result.syntheticRoot = roots.length > 1 || (roots.length === 1 && roots[0].name !== 'root');
  const centerY = (() => {
    const all = boundsOf(entries.flatMap((entry) => entry.cubes));
    return all ? (all.minY + all.maxY) / 2 : 0;
  })();

  const bones: IRBone[] = [];
  if (result.syntheticRoot) {
    bones.push({ name: 'root', pivot: [0, 0, 0], cubes: [] });
  }
  for (const entry of entries) {
    const bone: IRBone = {
      name: entry.name,
      pivot: entry.pivot ?? jointPivot(entry.name, entry.cubes, centerY),
      cubes: entry.cubes,
    };
    const parent = entry.parent ?? (result.syntheticRoot && entry.name !== 'root' ? 'root' : undefined);
    if (parent && parent !== entry.name) bone.parent = parent;
    bones.push(bone);
    if (entry.raw && entry.name.startsWith(entry.raw.replace(/[^A-Za-z0-9_.\-]+/g, '_'))) {
      result.preservedNames += 1;
    }
  }

  const limbs = entries.filter((entry) => /leg|foot|feet|hoof|paw/i.test(entry.name)).length;
  result.quadruped = limbs >= 4;
  result.bones = bones;
  result.parts = entries.map((entry) => entry.name);
  return result;
}

/** Number of bones that would collapse into `body` under the fixed rig-part vocabulary. */
export function countNonStandardParts(groups: SourceBoneGroup[]): number {
  return groups.filter((group) => {
    if (group.cubes.length === 0) return false;
    const part = classifyRigPart(group.name);
    return !group.name || part === 'body';
  }).length;
}