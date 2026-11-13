import {
  buildBoneIndex,
  matchBoneName,
  boneFamily,
  boneSide,
  type BoneIndex,
} from '@/utils/boneRetarget';
import { PLAYER_SKELETON_BONES } from '@/utils/playerBoneAliases';
import { composeTracks } from '@/utils/animationTrackMath';
import { anatomyPenalty, describeBoneAnatomy, describeApproximation, isControlBone } from '@/utils/boneAnatomy';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';

/**
 * Universal skeleton reconstruction and bone retargeting.
 *
 * A source clip names bones the way its own rig does (`leftArm`, `Left_Arm`, `left_lower_arm`,
 * `wrist_twist`); the geometry a client entity really renders names the same parts its own way
 * (`left_arm`), and the Bedrock player rig declares only a bare humanoid joint set. Bedrock
 * resolves a bone track by exact name, so a mismatch is not cosmetic: the track moves nothing,
 * the entity keeps its rest pose, and nothing is ever logged.
 *
 * Matching by name is therefore not enough. This stage reconstructs the destination skeleton and
 * decides, per source track, which of three operations preserves the motion:
 *
 *   1. **retarget** — the source bone resolves onto a destination bone by exact name, canonical
 *      form, limb family + side, ordinal or unique token overlap. Two source tracks that land on
 *      one bone are *composed* (FK accumulation), never overwritten.
 *   2. **reconstruct** — the source bone is a genuine joint the destination rig lacks (a twist
 *      bone, a finger, a mechanical part). When the entity renders a geometry document this pack
 *      ships, an empty container bone is created inside it: correct parent, inherited pivot, no
 *      cubes. The track then plays natively at full fidelity and the model is unchanged.
 *   3. **collapse** — the destination rig cannot gain bones (the engine-provided player rig), so
 *      the child transform is composed onto its resolved ancestor in destination space. The
 *      limb still moves; the collapse is reported as an approximation.
 *
 * Only a track that no rule can place keeps its source name, and that case is reported — motion
 * is never deleted silently.
 */

export interface BoneRenaming {
  clipId: string;
  from: string;
  to: string;
  via: string;
}

export interface BoneInjection {
  clipId: string;
  geometry: string;
  bone: string;
  parent: string;
  reason: string;
}

export interface BoneCollapse {
  clipId: string;
  from: string;
  to: string;
  channels: string[];
  reason: string;
}

/**
 * A track that reached a destination bone of the SAME body region but not an exact counterpart:
 * a distal source joint folded onto the destination's single joint for that limb. `penalty` is the
 * measured anatomical cost (0 exact, 0.1 outer-layer variant, 0.35 limb folded onto one joint,
 * 0.55 different joint of the same limb), so retarget fidelity is a number instead of a claim.
 */
export interface BoneApproximation {
  clipId: string;
  from: string;
  to: string;
  penalty: number;
  reason: string;
}

/**
 * A source bone whose only purpose is to position what the hand holds (a tool / weapon / socket
 * node). Bedrock expresses held-item positioning through the skeleton's item socket, so the track
 * is routed to the socket of its own side instead of being dropped into the body.
 *
 * `via` names the destination mechanism that actually carries the transform:
 *   • socket          — a real item socket bone the rendered rig already declares (`rightItem`);
 *   • injected-socket — a shipped geometry gained an empty socket node under the hand of that side;
 *   • hand            — the rig cannot gain a socket (engine-owned), so the track rides the hand and
 *                       the held item is positioned by the item / attachable system instead.
 */
export interface BoneAttachment {
  clipId: string;
  from: string;
  to: string;
  via: 'socket' | 'injected-socket' | 'hand';
  reason: string;
}

export interface EntitySkeletonOutcome {
  identifier: string;
  geometry: string;
  bonesAvailable: number;
  clips: number;
  bonesExamined: number;
  bonesResolved: number;
}

export interface SkeletonReconciliationReport {
  entitiesExamined: number;
  geometriesDeclared: number;
  clipsExamined: number;
  clipsRetargeted: number;
  bonesExamined: number;
  bonesResolved: number;
  bonesRenamed: number;
  renaming: BoneRenaming[];
  unmapped: string[];
  geometriesRebound: string[];
  skeletonUnresolved: string[];
  /** Empty container bones created inside shipped geometry documents. */
  bonesInjected: BoneInjection[];
  /** Tracks composed onto an ancestor bone because the rig could not gain a node. */
  bonesCollapsed: BoneCollapse[];
  /** Same-region approximations that reached a real joint with a measured anatomical cost. */
  approximations: BoneApproximation[];
  /** Held-item / tool sockets rebuilt onto a destination socket bone, hand or injected node. */
  attachments: BoneAttachment[];
  /** Control nodes (mechanical / IK / constraint) withheld because a deform track owns the joint. */
  auxiliary: string[];
  /** Tracks that could not reach any bone of their own body region (never retargeted cross-region). */
  crossRegionRefused: string[];
  /** Share of examined tracks that reached an anatomically exact counterpart (0–100). */
  retargetFidelityPct: number;
  /** Mean anatomical cost of the approximated tracks (0–100), reported separately from fidelity. */
  poseErrorPct: number;
  /** Bones whose declared parent does not exist in the same document. */
  hierarchyRepairs: string[];
  perEntity: EntitySkeletonOutcome[];
  summary: string;
}

type FileMap = Record<string, string | Uint8Array>;

const VANILLA_GEOMETRY = /^geometry\.(humanoid|cape|armor_stand|player)\b/i;
const ENGINE_CLIP = { test: isKnownVanillaPlayerAnimationReference };
const PLAYER_IDENTIFIER = 'minecraft:player';

/** Sub-part words a finer source skeleton uses where the destination rig has one joint. */
const SUBPART = /(upper|lower|fore|hind|front|back|inner|outer|middle|mid|main|sub|twist|tip|end|joint|seg|segment|finger|thumb|index|ring|pinky)/gi;

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function reduced(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface BoneNode {
  name: string;
  parent: string | null;
  pivot: number[];
}

interface GeometryRecord {
  path: string;
  identifier: string;
  doc: Record<string, any>;
  entry: Record<string, any>;
  nodes: BoneNode[];
  bones: string[];
  dirty: boolean;
}

function collectGeometries(files: FileMap): Record<string, GeometryRecord> {
  const out: Record<string, GeometryRecord> = {};
  const docs = new Map<string, Record<string, any>>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.json')) continue;
    let doc = docs.get(path);
    if (!doc) {
      const parsed = parseJson(files[path]);
      if (!parsed) continue;
      doc = parsed;
      docs.set(path, doc);
    }
    const raw = doc['minecraft:geometry'] ?? doc.geometry;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const identifier = (entry as Record<string, any>).description?.identifier;
      if (typeof identifier !== 'string' || !identifier.trim()) continue;
      const declared = Array.isArray((entry as Record<string, any>).bones)
        ? ((entry as Record<string, any>).bones as unknown[])
        : [];
      const nodes: BoneNode[] = declared
        .filter((bone) => Boolean(bone) && typeof bone === 'object')
        .map((bone) => {
          const record = bone as Record<string, unknown>;
          return {
            name: String(record.name ?? ''),
            parent: typeof record.parent === 'string' ? record.parent : null,
            pivot: Array.isArray(record.pivot)
              ? (record.pivot as unknown[]).filter((value): value is number => typeof value === 'number')
              : [],
          };
        })
        .filter((node) => node.name.length > 0);
      out[identifier] = {
        path,
        identifier,
        doc,
        entry: entry as Record<string, any>,
        nodes,
        bones: nodes.map((node) => node.name),
        dirty: false,
      };
    }
  }
  return out;
}

/** `controller.animation.*` definitions, reduced to the clip ids their states select. */
function collectControllerClips(files: FileMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const doc = parseJson(files[path]);
    const controllers = doc?.animation_controllers;
    if (!controllers || typeof controllers !== 'object') continue;
    for (const [controllerId, body] of Object.entries(controllers as Record<string, any>)) {
      const clips: string[] = [];
      const states = body && typeof body === 'object' ? body.states : null;
      if (states && typeof states === 'object') {
        for (const state of Object.values(states as Record<string, any>)) {
          const list = state && typeof state === 'object' ? state.animations : null;
          if (!Array.isArray(list)) continue;
          for (const entry of list) {
            if (typeof entry === 'string') clips.push(entry);
            else if (entry && typeof entry === 'object') clips.push(...Object.keys(entry));
          }
        }
      }
      out[controllerId] = clips;
    }
  }
  return out;
}

interface ClipRecord {
  id: string;
  path: string;
  body: Record<string, any>;
}

function collectClips(files: FileMap): Record<string, ClipRecord> {
  const out: Record<string, ClipRecord> = {};
  const docs = new Map<string, Record<string, any>>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    let doc = docs.get(path);
    if (!doc) {
      const parsed = parseJson(files[path]);
      if (!parsed) continue;
      doc = parsed;
      docs.set(path, doc);
    }
    const animations = doc?.animations;
    if (!animations || typeof animations !== 'object') continue;
    for (const [clipId, body] of Object.entries(animations as Record<string, any>)) {
      if (!body || typeof body !== 'object') continue;
      if (out[clipId]) continue;
      out[clipId] = { id: clipId, path, body: body as Record<string, any> };
    }
  }
  return out;
}

interface EntityRecord {
  path: string;
  identifier: string;
  description: Record<string, any>;
}

function collectEntities(files: FileMap): EntityRecord[] {
  const out: EntityRecord[] = [];
  for (const path of Object.keys(files)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const doc = parseJson(files[path]);
    const description = doc?.['minecraft:client_entity']?.description;
    if (!doc || !description || typeof description !== 'object') continue;
    out.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      description: description as Record<string, any>,
    });
  }
  return out;
}

function clipBonesOf(clip: ClipRecord | undefined): string[] {
  const bones = clip?.body?.bones;
  return bones && typeof bones === 'object' && !Array.isArray(bones) ? Object.keys(bones) : [];
}

function coverage(boneNames: string[], index: BoneIndex): number {
  if (boneNames.length === 0) return 1;
  let resolved = 0;
  for (const bone of boneNames) if (matchBoneName(bone, index).bone) resolved += 1;
  return resolved / boneNames.length;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stripSubparts(name: string): string {
  const stripped = name.replace(SUBPART, '').replace(/\d+/g, '').trim();
  return stripped.replace(/[_\-\s]{2,}/g, '_');
}

/** Resolution that survives a finer source rig: sub-part words, family and side are all tried. */
function resolveStructural(source: string, index: BoneIndex): { bone: string; via: string } | null {
  const direct = matchBoneName(source, index);
  if (direct.bone) return { bone: direct.bone, via: direct.kind };
  const stripped = stripSubparts(source);
  if (stripped && stripped !== source) {
    const second = matchBoneName(stripped, index);
    if (second.bone) return { bone: second.bone, via: `structural-${second.kind}` };
  }
  const family = boneFamily(source);
  if (family !== 'other') {
    const pool = index.family.get(family) ?? [];
    const side = boneSide(source);
    const sided = side ? pool.filter((bone) => boneSide(bone) === side) : [];
    if (sided.length === 1) return { bone: sided[0], via: 'structural-family-side' };
    if (pool.length === 1) return { bone: pool[0], via: 'structural-family' };
  }
  return null;
}

/**
 * Destination bone a held-item track should ride.
 *
 * Tool / weapon / socket nodes carry no geometry of their own; their transform exists to move what
 * the hand holds. The destination joint that expresses that is the item socket of the same side
 * (`rightItem` / `leftItem`); a rig that declares no socket is served by the hand of that side
 * (tip segment), then the wrist (distal), then the whole arm. Returns null when the rig declares no
 * bone of that side at all, so a socket is never hung from an unrelated limb.
 */
function resolveItemSocket(source: string, index: BoneIndex): string | null {
  const anatomy = describeBoneAnatomy(source);
  const sideMatches = (bone: string): boolean => {
    const side = describeBoneAnatomy(bone).side;
    return anatomy.side === null || side === null || side === anatomy.side;
  };
  const sockets = (index.family.get('item') ?? []).filter(sideMatches);
  const rankedSocket = sockets
    .map((bone) => ({ bone, penalty: anatomyPenalty(source, bone) }))
    .filter((entry) => Number.isFinite(entry.penalty))
    .sort((a, b) => a.penalty - b.penalty)[0];
  if (rankedSocket) return rankedSocket.bone;
  const arms = (index.family.get('arm') ?? []).filter(sideMatches);
  for (const segment of ['tip', 'distal', 'whole', 'proximal'] as const) {
    const hit = arms.find((bone) => describeBoneAnatomy(bone).segment === segment);
    if (hit) return hit;
  }
  return null;
}

/** Which destination bone a new container node should hang from. */
function resolveContainerParent(source: string, index: BoneIndex): string | null {
  // A held-item socket hangs from the joint that carries the item, never from an armature root:
  // an item socket on the body renders the held tool in the torso.
  if (describeBoneAnatomy(source).family === 'item') {
    const socket = resolveItemSocket(source, index);
    if (socket) return socket;
  }
  const structural = resolveStructural(source, index);
  if (structural) return structural.bone;
  const lower = source.toLowerCase();
  // The closest declared ancestor is the LONGEST destination bone name contained in the source
  // name: `left_lower_arm_twist` belongs under `left_lower_arm`, never under `arm`. Picking the
  // first match instead folded sub-joints into the wrong limb, which is what produced floating
  // limbs and stretched geometry even though every track reported as resolved.
  // Every candidate must also pass the anatomy test, so a parent is never taken from another limb.
  const contained = index.names
    .filter(
      (bone) =>
        bone.length >= 3 &&
        lower.includes(bone.toLowerCase()) &&
        bone.toLowerCase() !== lower &&
        Number.isFinite(anatomyPenalty(source, bone)),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (contained) return contained;
  const family = describeBoneAnatomy(source).family;
  const pool = (index.family.get(family) ?? []).filter(
    (bone) => Number.isFinite(anatomyPenalty(source, bone)),
  );
  if (family !== 'other' && pool.length > 0) {
    // The cheapest anatomically valid joint of the same region: base part before outer layer,
    // whole joint of the same side before the other side.
    return [...pool].sort((a, b) => anatomyPenalty(source, a) - anatomyPenalty(source, b))[0];
  }
  // No bone of this region exists at all. A custom node still needs a parent, so it hangs from the
  // body (an in-place animation) — never from an unrelated limb. The caller reports it.
  const bodyPool = index.family.get('body') ?? [];
  return bodyPool[0] ?? null;
}

function injectContainerBone(record: GeometryRecord, boneName: string, parent: string | null): boolean {
  if (!record || record.bones.includes(boneName)) return false;
  const parentNode = parent ? record.nodes.find((node) => node.name === parent) : null;
  const pivot = parentNode && parentNode.pivot.length > 0 ? [...parentNode.pivot] : [0, 0, 0];
  const node: Record<string, unknown> = { name: boneName, pivot };
  if (parent) node.parent = parent;
  const bones = Array.isArray(record.entry.bones) ? record.entry.bones : [];
  bones.push(node);
  record.entry.bones = bones;
  record.nodes.push({ name: boneName, parent, pivot });
  record.bones.push(boneName);
  record.dirty = true;
  return true;
}

function placeTrack(out: Record<string, unknown>, target: string, track: unknown): { composed: string[]; kept: string[] } {
  const existing = out[target];
  if (existing && typeof existing === 'object' && track && typeof track === 'object') {
    const merged = composeTracks(existing, track);
    out[target] = merged.track;
    return { composed: merged.composed, kept: merged.kept };
  }
  out[target] = track;
  return { composed: [], kept: [] };
}

interface ClipRetargetOutcome {
  renamed: BoneRenaming[];
  collapsed: BoneCollapse[];
  injected: BoneInjection[];
  approximations: BoneApproximation[];
  attachments: BoneAttachment[];
  auxiliary: string[];
  unmapped: string[];
  examined: number;
  resolved: number;
  changed: boolean;
}

/**
 * Rebuilds one clip's bone tracks onto the destination skeleton.
 * Pass 1 places every track whose bone exists; pass 2 handles the remainder by reconstruction
 * (container bone) or FK collapse, so no transform is lost.
 */
function retargetClip(
  clip: ClipRecord,
  index: BoneIndex,
  geometry: GeometryRecord | null,
  destinationBones: string[],
): ClipRetargetOutcome {
  const outcome: ClipRetargetOutcome = {
    renamed: [],
    collapsed: [],
    injected: [],
    approximations: [],
    attachments: [],
    auxiliary: [],
    unmapped: [],
    examined: 0,
    resolved: 0,
    changed: false,
  };
  const bones = clip.body.bones;
  if (!bones || typeof bones !== 'object' || Array.isArray(bones)) return outcome;

  const entries = Object.entries(bones as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  const deferred: Array<[string, unknown]> = [];
  let working = index;
  const workingBones = [...destinationBones];

  const recordApproximation = (from: string, to: string, extra?: string): void => {
    const penalty = anatomyPenalty(from, to);
    if (!Number.isFinite(penalty)) return;
    if (penalty === 0) return;
    outcome.approximations.push({
      clipId: clip.id,
      from,
      to,
      penalty,
      reason: extra ?? describeApproximation(from, to) ?? `${from} approximated onto ${to}`,
    });
  };

  // Pass 1 — deform bones. These carry the geometry, so they are placed before any control node and
  // may only reach a bone of their own body region (the matcher enforces that).
  const heldItem: Array<[string, unknown]> = [];
  for (const [name, track] of entries) {
    if (isControlBone(name)) continue;
    // Held-item / tool nodes are not deform bones: their transform exists to position what the
    // hand holds, so they are resolved against the item socket AFTER the body joints are placed.
    if (describeBoneAnatomy(name).family === 'item') {
      heldItem.push([name, track]);
      continue;
    }
    const match = matchBoneName(name, working);
    const preserveSourceJoint =
      geometry !== null &&
      match.bone !== null &&
      match.kind !== 'exact' &&
      match.kind !== 'canonical';
    if (!match.bone || preserveSourceJoint) {
      deferred.push([name, track]);
      continue;
    }
    if (match.bone !== name) outcome.renamed.push({ clipId: clip.id, from: name, to: match.bone, via: match.kind });
    recordApproximation(name, match.bone);
    placeTrack(out, match.bone, track);
  }

  // Pass 2 — control nodes (mechanical parents, IK/FK targets, sockets). They exist to drive other
  // bones; a node whose joint a deform track already drives is withheld and reported, because
  // applying it as well would rotate that limb twice.
  for (const [name, track] of entries) {
    if (!isControlBone(name)) continue;
    const target = matchBoneName(name, working).bone;
    if (target && out[target] === undefined) {
      placeTrack(out, target, track);
      if (target !== name) {
        outcome.renamed.push({ clipId: clip.id, from: name, to: target, via: 'control-node' });
      }
      recordApproximation(
        name,
        target,
        `"${name}" is a control node of the ${describeBoneAnatomy(name).family} and drives "${target}", which no deform track drives in this clip`,
      );
      continue;
    }
    outcome.auxiliary.push(name);
  }

  // Pass 3 — held-item / tool sockets. A source rig names nodes whose only job is to position what
  // the hand holds (`DEF_TOOL.R`, `MCH_PARENT_TOOL.L`). Bedrock has no free-form attachment bones,
  // so each such track is routed to the mechanism that really carries it: an item socket the rig
  // declares, a socket node created under the hand of that side inside a geometry this pack ships,
  // or the hand itself when the rig cannot gain a bone (the engine player rig, where the held item
  // is positioned by the item / attachable system). A tool socket is never hung from the body.
  for (const [name, track] of heldItem) {
    const side = describeBoneAnatomy(name).side;
    const socketTarget =
      matchBoneName(name, working).bone ??
      (working.family.get('item') ?? []).find((bone) => {
        const boneSideValue = describeBoneAnatomy(bone).side;
        return side === null || boneSideValue === null || boneSideValue === side;
      }) ??
      null;
    if (socketTarget) {
      placeTrack(out, socketTarget, track);
      if (socketTarget !== name) {
        outcome.renamed.push({ clipId: clip.id, from: name, to: socketTarget, via: 'item-socket' });
      }
      outcome.attachments.push({
        clipId: clip.id,
        from: name,
        to: socketTarget,
        via: 'socket',
        reason: `"${name}" positions a held item and the rendered rig declares the item socket "${socketTarget}", so the tool rides the hand that carries it`,
      });
      continue;
    }
    const hand = resolveItemSocket(name, working);
    if (geometry && hand && injectContainerBone(geometry, name, hand)) {
      out[name] = track;
      workingBones.push(name);
      working = buildBoneIndex(workingBones);
      outcome.injected.push({
        clipId: clip.id,
        geometry: geometry.identifier,
        bone: name,
        parent: hand,
        reason:
          `the clip animates the held-item socket "${name}", which the bound geometry did not declare; ` +
          `an empty socket bone was created under the hand "${hand}". The source pivot was unavailable, ` +
          `so the generated node inherits the hand pivot and its exact local offset is unverified`,
      });
      outcome.attachments.push({
        clipId: clip.id,
        from: name,
        to: hand,
        via: 'injected-socket',
        reason: `an empty socket node "${name}" was created under the hand "${hand}" of ${geometry.identifier}`,
      });
      continue;
    }
    if (hand) {
      placeTrack(out, hand, track);
      outcome.attachments.push({
        clipId: clip.id,
        from: name,
        to: hand,
        via: 'hand',
        reason: `the rendered rig is engine-owned and cannot gain a socket bone, so the held-item transform of "${name}" rides the hand "${hand}"; the item itself is positioned by the item / attachable definition`,
      });
      continue;
    }
    out[name] = track;
    outcome.unmapped.push(name);
  }

  for (const [name, track] of deferred) {
    const parent = resolveContainerParent(name, working);
    const parentIsCompatible =
      parent !== null && Number.isFinite(anatomyPenalty(name, parent));
    // Reconstruct a source-named joint before considering a semantic alias. On an editable
    // geometry, collapsing `torso` onto `body` loses the independent joint even though both are
    // anatomically related. The new empty node preserves the source track without moving another
    // visible region; its inherited pivot is explicitly reported as an unverified approximation.
    if (
      geometry &&
      parent &&
      parentIsCompatible &&
      injectContainerBone(geometry, name, parent)
    ) {
      out[name] = track;
      workingBones.push(name);
      working = buildBoneIndex(workingBones);
      outcome.injected.push({
        clipId: clip.id,
        geometry: geometry.identifier,
        bone: name,
        parent,
        reason:
          `the converted geometry lacked the source joint "${name}"; an empty node was created ` +
          `under the closest compatible bone "${parent}". The source pivot was unavailable, ` +
          `so the node inherits the parent's pivot and its exact local offset is unverified`,
      });
      continue;
    }

    const structural = resolveStructural(name, working);
    if (structural && structural.bone !== name) {
      const placed = placeTrack(out, structural.bone, track);
      outcome.collapsed.push({
        clipId: clip.id,
        from: name,
        to: structural.bone,
        channels: placed.composed,
        reason: `no destination bone is named "${name}"; its transform was composed onto "${structural.bone}" (${structural.via}) so the limb still moves`,
      });
      recordApproximation(name, structural.bone);
      continue;
    }
    const fallback = resolveContainerParent(name, working);
    // Only a bone of the SAME body region may receive this transform. Composing an unrecognised
    // source bone — or one whose region this rig does not declare — onto the body is what made a
    // whole model rotate from one auxiliary node. Such a track keeps its source name (so it drives
    // nothing and the pose is untouched) and is reported as unresolved instead of being counted as
    // a mapping.
    if (fallback && Number.isFinite(anatomyPenalty(name, fallback))) {
      const placed = placeTrack(out, fallback, track);
      outcome.collapsed.push({
        clipId: clip.id,
        from: name,
        to: fallback,
        channels: placed.composed,
        reason: `"${name}" has no destination counterpart and the rendered rig cannot gain bones (engine-owned skeleton); its transform was composed onto its own limb's joint "${fallback}"`,
      });
      recordApproximation(name, fallback);
      continue;
    }
    out[name] = track;
    outcome.unmapped.push(name);
  }

  outcome.examined = entries.length;
  // Every track is now addressed to a bone the destination skeleton really contains: renamed,
  // injected as a container node, or composed onto an anatomically valid ancestor. Withheld control
  // nodes are not counted as resolved, because they were deliberately dropped from the clip.
  outcome.resolved = entries.length - outcome.unmapped.length - outcome.auxiliary.length;
  const originalNames = Object.keys(bones as Record<string, unknown>);
  const outputNames = Object.keys(out);
  outcome.changed =
    outcome.renamed.length > 0 ||
    outcome.collapsed.length > 0 ||
    outcome.injected.length > 0 ||
    outputNames.length !== originalNames.length ||
    outputNames.some((name) => !originalNames.includes(name));
  if (outcome.changed) clip.body.bones = out;
  return outcome;
}

export function retargetBones(input: {
  resourcePackFiles: FileMap;
  onLog?: (line: string) => void;
}): SkeletonReconciliationReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  const report: SkeletonReconciliationReport = {
    entitiesExamined: 0,
    geometriesDeclared: 0,
    clipsExamined: 0,
    clipsRetargeted: 0,
    bonesExamined: 0,
    bonesResolved: 0,
    bonesRenamed: 0,
    renaming: [],
    unmapped: [],
    geometriesRebound: [],
    skeletonUnresolved: [],
    bonesInjected: [],
    bonesCollapsed: [],
    approximations: [],
    attachments: [],
    auxiliary: [],
    crossRegionRefused: [],
    retargetFidelityPct: 100,
    poseErrorPct: 0,
    hierarchyRepairs: [],
    perEntity: [],
    summary: '',
  };

  const geometries = collectGeometries(files);
  const controllerClips = collectControllerClips(files);
  const clips = collectClips(files);
  const entities = collectEntities(files);
  report.geometriesDeclared = Object.keys(geometries).length;
  report.clipsExamined = Object.keys(clips).length;

  // Parent-child integrity: a bone whose declared parent is not in the same document renders at
  // the wrong offset, so the condition is measured here and handed to the mesh repair stage.
  for (const record of Object.values(geometries)) {
    const declared = new Set(record.bones.map((bone) => bone.toLowerCase()));
    for (const node of record.nodes) {
      if (!node.parent) continue;
      if (declared.has(node.parent.toLowerCase())) continue;
      report.hierarchyRepairs.push(`${record.identifier}: bone "${node.name}" declares missing parent "${node.parent}"`);
    }
  }

  if (entities.length === 0) {
    report.summary =
      'Skeleton reconstruction: the pack ships no client entity definition, so no rendered skeleton exists to retarget against (not measured).';
    log(`[ANIM:BONE] ${report.summary}`);
    return report;
  }

  const dirtyClips = new Set<string>();
  const retargetedWith = new Map<string, string>();
  const unmapped = new Set<string>();

  for (const entity of entities) {
    report.entitiesExamined += 1;
    const isPlayer = entity.identifier === PLAYER_IDENTIFIER;
    const geometryMap: Record<string, string> = {};
    if (entity.description.geometry && typeof entity.description.geometry === 'object') {
      for (const [key, value] of Object.entries(entity.description.geometry as Record<string, unknown>)) {
        if (typeof value === 'string') geometryMap[key] = value;
      }
    }
    const boundIds = unique(Object.values(geometryMap));

    const clipIds = new Set<string>();
    if (entity.description.animations && typeof entity.description.animations === 'object') {
      for (const value of Object.values(entity.description.animations as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        if (value.startsWith('animation.') && !ENGINE_CLIP.test(value)) clipIds.add(value);
        if (value.startsWith('controller.animation.')) {
          for (const clipId of controllerClips[value] ?? []) {
            if (clipId.startsWith('animation.') && !ENGINE_CLIP.test(clipId)) clipIds.add(clipId);
          }
        }
      }
    }

    let destinationBones: string[] = [];
    for (const id of boundIds) {
      const record = geometries[id];
      if (record) destinationBones.push(...record.bones);
    }
    if (isPlayer && boundIds.some((id) => VANILLA_GEOMETRY.test(id))) {
      destinationBones.push(...PLAYER_SKELETON_BONES);
    }
    destinationBones = unique(destinationBones);

    const entityClips = [...clipIds].filter((clipId) => clips[clipId]);
    const animatedBones = unique(entityClips.flatMap((clipId) => clipBonesOf(clips[clipId])));

    if (destinationBones.length === 0) {
      if (entityClips.length > 0) {
        report.skeletonUnresolved.push(
          `${entity.identifier}: binds ${boundIds.length > 0 ? boundIds.join(', ') : 'no geometry'} and no shipped geometry document declares its bones, so ${animatedBones.length} animated bone(s) cannot be resolved`,
        );
      }
      report.perEntity.push({
        identifier: entity.identifier,
        geometry: boundIds.join(', ') || '(none)',
        bonesAvailable: 0,
        clips: entityClips.length,
        bonesExamined: animatedBones.length,
        bonesResolved: 0,
      });
      continue;
    }

    let index = buildBoneIndex(destinationBones);
    let activeGeometry = geometryMap.default ?? boundIds[0] ?? '(none)';
    let activeRecord = geometries[activeGeometry] ?? null;

    // A mob rebound to a model that cannot express its motion renders inert: if a declared
    // geometry expresses the clip set far better than the bound one, rebind. The player mesh is
    // never swapped — replacing a player skin rig with a source model breaks the skin.
    if (!isPlayer && animatedBones.length > 0) {
      const current = coverage(animatedBones, index);
      if (current < 0.6) {
        const entityIdentity = reduced(entity.identifier.split(':').pop() ?? entity.identifier);
        const candidates = Object.entries(geometries)
          .filter(([id]) => !boundIds.includes(id))
          .map(([id, record]) => ({ id, bones: record.bones }))
          .filter((candidate) => {
            if (candidate.bones.length === 0) return false;
            const candidateIdentity = reduced(candidate.id.replace(/^geometry\./i, '').split(':').pop() ?? candidate.id);
            if (!entityIdentity || !candidateIdentity) return false;
            return (
              candidateIdentity === entityIdentity ||
              candidateIdentity.endsWith(entityIdentity) ||
              entityIdentity.endsWith(candidateIdentity)
            );
          });
        let best: { id: string; bones: string[]; score: number } | null = null;
        for (const candidate of candidates) {
          const score = coverage(animatedBones, buildBoneIndex(candidate.bones));
          if (score >= 0.9 && (!best || score > best.score)) best = { ...candidate, score };
        }
        if (best) {
          const previous = activeGeometry;
          const rebindKey = Object.keys(geometryMap).find((key) => geometryMap[key] === previous) ?? 'default';
          geometryMap[rebindKey] = best.id;
          entity.description.geometry = geometryMap;
          destinationBones = unique(best.bones);
          index = buildBoneIndex(destinationBones);
          activeGeometry = best.id;
          activeRecord = geometries[best.id] ?? null;
          report.geometriesRebound.push(
            `${entity.identifier}: ${previous} → ${best.id} (coverage ${current.toFixed(2)} → ${best.score.toFixed(2)})`,
          );
          log(
            `[ANIM:BONE] ${entity.identifier} was bound to ${previous}, which expresses only ${(current * 100).toFixed(0)}% of the bones its own clips move; rebound to ${best.id}, which declares ${best.bones.length} bone(s) and expresses ${(best.score * 100).toFixed(0)}%.`,
          );
        }
      }
    }

    let bonesExamined = 0;
    let bonesResolved = 0;
    const signature = destinationBones.map((bone) => bone.toLowerCase()).sort().join('|');
    // Engine-owned rigs (the player humanoid) cannot receive container bones.
    const editableGeometry = activeRecord && !VANILLA_GEOMETRY.test(activeGeometry) ? activeRecord : null;

    for (const clipId of entityClips) {
      const clip = clips[clipId];
      const tracked = retargetedWith.get(clipId);
      if (tracked && tracked !== signature) {
        log(
          `[ANIM:BONE] Clip "${clipId}" is also registered by another entity with a different skeleton; it stays retargeted for the skeleton that resolves it best and the second binding is reported.`,
        );
        continue;
      }
      const result = retargetClip(clip, index, editableGeometry, destinationBones);
      // Injection extends the skeleton, so the working index is rebuilt from the geometry that
      // now declares the container bones as well.
      if (editableGeometry && result.injected.length > 0) {
        destinationBones = unique([...destinationBones, ...editableGeometry.bones]);
      }
      index = buildBoneIndex(destinationBones);
      retargetedWith.set(clipId, signature);
      bonesExamined += result.examined;
      bonesResolved += result.resolved;

      if (result.renamed.length > 0) {
        report.renaming.push(...result.renamed);
        report.bonesRenamed += result.renamed.length;
        report.clipsRetargeted += 1;
        dirtyClips.add(clip.path);
        log(
          `[ANIM:BONE] ${clipId}: ${result.renamed.length} track(s) rebound onto ${activeGeometry} — ${result.renamed
            .slice(0, 4)
            .map((entry) => `${entry.from}→${entry.to} (${entry.via})`)
            .join(', ')}${result.renamed.length > 4 ? ` … +${result.renamed.length - 4}` : ''}.`,
        );
      }
      if (result.injected.length > 0) {
        report.bonesInjected.push(...result.injected);
      }
      if (result.collapsed.length > 0) {
        report.bonesCollapsed.push(...result.collapsed);
        dirtyClips.add(clip.path);
      }
      if (result.approximations.length > 0) {
        report.approximations.push(...result.approximations);
        dirtyClips.add(clip.path);
        log(
          `[ANIM:BONE:ANATOMY] ${clipId}: ${result.approximations.length} track(s) reached a same-region joint with a measured anatomical cost — ${result.approximations
            .slice(0, 4)
            .map((entry) => `${entry.from}→${entry.to} (${entry.penalty.toFixed(2)})`)
            .join(', ')}${result.approximations.length > 4 ? ` … +${result.approximations.length - 4}` : ''}.`,
        );
      }
      if (result.attachments.length > 0) {
        report.attachments.push(...result.attachments);
        dirtyClips.add(clip.path);
        log(
          `[ANIM:BONE:ITEM] ${clipId}: ${result.attachments.length} held-item socket(s) rebuilt onto the destination hand/socket — ${result.attachments
            .slice(0, 4)
            .map((entry) => `${entry.from}→${entry.to} (${entry.via})`)
            .join(', ')}${result.attachments.length > 4 ? ` … +${result.attachments.length - 4}` : ''}.`,
        );
      }
      if (result.auxiliary.length > 0) {
        report.auxiliary.push(...result.auxiliary.map((bone) => `${clipId}: ${bone}`));
        dirtyClips.add(clip.path);
        log(
          `[ANIM:BONE:AUX] ${clipId}: ${result.auxiliary.length} control node(s) withheld because a deform track already drives their joint — ${result.auxiliary.slice(0, 4).join(', ')}${result.auxiliary.length > 4 ? ` … +${result.auxiliary.length - 4}` : ''}.`,
        );
      }
      for (const bone of result.unmapped) unmapped.add(`${clipId}: ${bone}`);
    }

    report.bonesExamined += bonesExamined;
    report.bonesResolved += bonesResolved;
    report.perEntity.push({
      identifier: entity.identifier,
      geometry: activeGeometry,
      bonesAvailable: destinationBones.length,
      clips: entityClips.length,
      bonesExamined,
      bonesResolved,
    });
  }

  for (const path of dirtyClips) {
    const doc = parseJson(files[path]);
    if (doc) files[path] = JSON.stringify(doc, null, 2);
  }
  // Container bones are written back into the geometry documents that received them.
  const dirtyGeometryPaths = new Set<string>();
  for (const record of Object.values(geometries)) {
    if (record.dirty) dirtyGeometryPaths.add(record.path);
  }
  for (const path of dirtyGeometryPaths) {
    const record = Object.values(geometries).find((entry) => entry.path === path);
    if (record) files[path] = JSON.stringify(record.doc, null, 2);
  }

  report.unmapped = [...unmapped];
  // Retarget fidelity and pose error are two different figures and are never merged into one
  // percentage: how many tracks reached an anatomically exact counterpart, and how much anatomical
  // cost the remaining ones carry.
  const approximated = report.approximations.length;
  const exactTracks = Math.max(0, report.bonesExamined - approximated - report.unmapped.length);
  report.retargetFidelityPct = report.bonesExamined > 0 ? Math.round((exactTracks / report.bonesExamined) * 100) : 100;
  report.poseErrorPct = approximated > 0
    ? Math.round((report.approximations.reduce((sum, entry) => sum + entry.penalty, 0) / approximated) * 100)
    : 0;
  for (const entry of report.approximations) {
    if (Number.isFinite(anatomyPenalty(entry.from, entry.to))) continue;
    report.crossRegionRefused.push(`${entry.clipId}: ${entry.from} → ${entry.to}`);
  }
  const ratio = report.bonesExamined > 0 ? report.bonesResolved / report.bonesExamined : 1;
  report.summary =
    `Skeleton reconstruction: ${report.entitiesExamined} client entit(ies) resolved against ${report.geometriesDeclared} shipped geometry definition(s); ` +
    `${report.bonesRenamed} track(s) renamed across ${report.clipsRetargeted} clip(s), ` +
    `${report.bonesInjected.length} container bone(s) created for joints the rig lacked, ` +
    `${report.bonesCollapsed.length} track(s) composed onto an ancestor bone, ` +
    `${report.geometriesRebound.length} entity binding(s) corrected, ${report.bonesResolved}/${report.bonesExamined} animated bone(s) now drive a real bone ` +
    `(${(ratio * 100).toFixed(0)}%), ${report.unmapped.length} unresolved track(s), ${report.skeletonUnresolved.length} entity(ies) with no resolvable skeleton, ` +
    `${report.hierarchyRepairs.length} broken parent link(s). Anatomical retargeting: ${report.retargetFidelityPct}% of tracks reached an exact counterpart, ` +
    `${approximated} same-region approximation(s) carrying ${report.poseErrorPct}% mean pose error, ` +
    `${report.auxiliary.length} control node(s) withheld, ${report.attachments.length} held-item socket(s) rebuilt onto a destination socket/hand, ${report.crossRegionRefused.length} cross-region mapping(s) refused.`;
  log(`[ANIM:BONE] ${report.summary}`);
  for (const entry of report.bonesInjected.slice(0, 8)) {
    log(`[ANIM:BONE:INJECT] ${entry.geometry}: created empty container "${entry.bone}" under "${entry.parent}" — ${entry.reason}.`);
  }
  for (const entry of report.bonesCollapsed.slice(0, 8)) {
    log(`[ANIM:BONE:COLLAPSE] ${entry.clipId}: "${entry.from}" → "${entry.to}" (${entry.channels.join('/') || 'no composable channel'}) — ${entry.reason}.`);
  }
  for (const entry of report.unmapped.slice(0, 10)) {
    log(`[ANIM:BONE:UNRESOLVED] ${entry} — no destination bone matches by name, canonical form, anatomical region, sub-part or token, and the rig cannot gain a node; the track is kept and reported rather than deleted.`);
  }
  for (const entry of report.approximations.slice(0, 10)) {
    log(
      `[ANIM:BONE:APPROX] ${entry.clipId}: "${entry.from}" → "${entry.to}" (cost ${entry.penalty.toFixed(2)}) — ${entry.reason}.`,
    );
  }
  for (const entry of report.auxiliary.slice(0, 8)) {
    log(`[ANIM:BONE:AUX] ${entry} — a control node whose joint a deform track already drives; withheld so the limb is not transformed twice.`);
  }
  return report;
}