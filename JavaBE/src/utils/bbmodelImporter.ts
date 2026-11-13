import type { IntermediateModel, IRBone, IRCube, IRFace, ModelFaceName } from '@/utils/javaModelIR';
import { writeBedrockGeometry, type WrittenGeometry } from '@/utils/bedrockGeometryWriter';
import { canonicalGeometryId } from '@/utils/geometryRegistry';
import { buildSourceBoneGraph, type SourceBoneGroup } from '@/utils/universalBoneGraph';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';

/**
 * Blockbench `.bbmodel` importer.
 *
 * A `.bbmodel` is the authoring document a large share of modern Java mods ship or leak into
 * their jar: it holds the real cube list, the real bone hierarchy (`outliner`) and the real
 * keyframes (`animations`). None of that is Bedrock format, so the previous engine either
 * ignored the file or fell back to a generic rig — which is exactly the "mob has no model"
 * and "animation plays nothing" class of failure.
 *
 * Everything here is read from the document itself: cube corners, per-face UV rectangles,
 * element/bone rotation, bone pivots, hierarchy and keyframe channels. No shape, colour or
 * bone is invented; a property Bedrock cannot express is reported instead.
 */

const FACE_ORDER: ModelFaceName[] = ['north', 'east', 'south', 'west', 'up', 'down'];

interface BbFace {
  uv?: number[];
  rotation?: number;
  texture?: number | boolean | null;
  cullface?: string;
}

interface BbElement {
  uuid?: string;
  name?: string;
  from?: number[];
  to?: number[];
  origin?: number[];
  rotation?: number[];
  inflate?: number;
  faces?: Record<string, BbFace>;
}

interface BbOutlinerNode {
  name?: string;
  uuid?: string;
  origin?: number[];
  rotation?: number[];
  children?: Array<string | BbOutlinerNode>;
}

interface BbKeyframe {
  channel?: string;
  time?: number;
  data_points?: Array<{ x?: number; y?: number; z?: number }>;
}

interface BbAnimator {
  name?: string;
  keyframes?: BbKeyframe[];
}

interface BbAnimation {
  name?: string;
  loop?: string | boolean;
  length?: number;
  animators?: Record<string, BbAnimator>;
}

interface BbDocument {
  meta?: { model_format?: string; format_version?: string };
  name?: string;
  resolution?: { width?: number; height?: number };
  elements?: BbElement[];
  outliner?: Array<string | BbOutlinerNode>;
  animations?: BbAnimation[];
  textures?: Array<{ name?: string; source?: string }>;
}

export interface BbModelConversion {
  id: string;
  json: string;
  bones: number;
  cubes: number;
  quadruped: boolean;
  /** Source-part names that were carried verbatim into the skeleton. */
  boneNames: string[];
  notes: string[];
  written: WrittenGeometry;
}

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const vec3 = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) && value.length >= 3
    ? [num(value[0]), num(value[1]), num(value[2])]
    : null;

function normaliseFaceRotation(value: unknown): 0 | 90 | 180 | 270 {
  const angle = ((Math.round(num(value) / 90) * 90) % 360 + 360) % 360;
  if (angle === 90 || angle === 180 || angle === 270) return angle;
  return 0;
}

/** Dominant element rotation axis. Bedrock geometry cubes rotate about one axis only. */
function dominantRotation(value: unknown): { axis: 'x' | 'y' | 'z'; angle: number; origin: [number, number, number] } | null {
  const rotation = vec3(value);
  if (!rotation) return null;
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  let best = -1;
  let angle = 0;
  for (let index = 0; index < 3; index += 1) {
    if (Math.abs(rotation[index]) > Math.abs(angle)) {
      best = index;
      angle = rotation[index];
    }
  }
  if (best < 0 || Math.round(angle) === 0) return null;
  return { axis: axes[best], angle, origin: [0, 0, 0] };
}

function buildCube(element: BbElement, notes: string[]): IRCube | null {
  const from = vec3(element.from);
  const to = vec3(element.to);
  if (!from || !to) return null;
  const inflate = Math.max(0, num(element.inflate));
  const lo: [number, number, number] = [
    Math.min(from[0], to[0]) - inflate,
    Math.min(from[1], to[1]) - inflate,
    Math.min(from[2], to[2]) - inflate,
  ];
  const hi: [number, number, number] = [
    Math.max(from[0], to[0]) + inflate,
    Math.max(from[1], to[1]) + inflate,
    Math.max(from[2], to[2]) + inflate,
  ];

  const faces: Partial<Record<ModelFaceName, IRFace>> = {};
  let mapped = 0;
  for (const faceName of FACE_ORDER) {
    const source = element.faces?.[faceName];
    if (!source) continue;
    const uv = Array.isArray(source.uv) && source.uv.length >= 4
      ? [num(source.uv[0]), num(source.uv[1]), num(source.uv[2]), num(source.uv[3])] as [number, number, number, number]
      : undefined;
    if (!uv) {
      notes.push(`cube "${element.name ?? element.uuid ?? '?'}" face ${faceName} declares no UV rectangle; the writer derives it from the cube's own box layout`);
      continue;
    }
    faces[faceName] = {
      textureKey: '#0',
      uv,
      rotation: normaliseFaceRotation(source.rotation),
    };
    mapped += 1;
  }
  if (mapped === 0) {
    notes.push(`cube "${element.name ?? element.uuid ?? '?'}" has no usable face UV; a box layout is derived so the part still renders`);
  }

  const rotation = dominantRotation(element.rotation);
  const origin = vec3(element.origin) ?? [0, 0, 0];
  return {
    from: lo,
    to: hi,
    faces,
    rotation: rotation
      ? { origin, axis: rotation.axis, angle: rotation.angle, rescale: false }
      : undefined,
    shade: true,
  };
}

/** Walks the outliner and returns one bone group per real Blockbench group. */
function collectGroups(
  nodes: Array<string | BbOutlinerNode>,
  elementsByUuid: Map<string, BbElement>,
  parentHint: string | undefined,
  groups: SourceBoneGroup[],
  notes: string[],
): void {
  for (const node of nodes) {
    if (typeof node === 'string') {
      const element = elementsByUuid.get(node);
      if (!element) continue;
      const cube = buildCube(element, notes);
      if (!cube) continue;
      groups.push({ name: element.name || 'bone', cubes: [cube], parentHint });
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const cubes: IRCube[] = [];
    for (const child of node.children ?? []) {
      if (typeof child !== 'string') continue;
      const element = elementsByUuid.get(child);
      if (!element) continue;
      const cube = buildCube(element, notes);
      if (cube) cubes.push(cube);
    }
    const name = (node.name || '').trim() || `bone_${groups.length + 1}`;
    const pivot = vec3(node.origin) ?? undefined;
    if (cubes.length > 0) groups.push({ name, cubes, pivot, parentHint });
    // Nested groups are bones too, even when they own no cube of their own: an animation
    // that rotates a shoulder group must find that group in the shipped skeleton.
    const nested = (node.children ?? []).filter((child): child is BbOutlinerNode => typeof child !== 'string');
    if (nested.length > 0) {
      const before = groups.length;
      collectGroups(nested, elementsByUuid, name, groups, notes);
      if (groups.length === before) {
        groups.push({ name, cubes: [], pivot, parentHint });
      }
    }
  }
}

/**
 * Converts a `.bbmodel` document into a Bedrock geometry document.
 * Returns null only when the document declares no readable cube at all.
 */
export function convertBbModel(input: {
  modId: string;
  assetId: string;
  text: string;
  textureWidth?: number;
  textureHeight?: number;
}): BbModelConversion | null {
  let doc: BbDocument;
  try {
    doc = JSON.parse(input.text) as BbDocument;
  } catch {
    return null;
  }
  const elements = Array.isArray(doc.elements) ? doc.elements : [];
  if (elements.length === 0) return null;

  const notes: string[] = [];
  const elementsByUuid = new Map<string, BbElement>();
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const key = element.uuid || `element_${index}`;
    elementsByUuid.set(key, element);
  }

  const groups: SourceBoneGroup[] = [];
  const outliner = Array.isArray(doc.outliner) ? doc.outliner : [];
  if (outliner.length > 0) {
    collectGroups(outliner, elementsByUuid, undefined, groups, notes);
    // Elements that appear in no outliner group would otherwise never render.
    const grouped = new Set<string>();
    const walk = (nodes: Array<string | BbOutlinerNode>): void => {
      for (const node of nodes) {
        if (typeof node === 'string') grouped.add(node);
        else if (node && typeof node === 'object') walk(node.children ?? []);
      }
    };
    walk(outliner);
    const loose: IRCube[] = [];
    for (const [uuid, element] of elementsByUuid) {
      if (grouped.has(uuid)) continue;
      const cube = buildCube(element, notes);
      if (cube) loose.push(cube);
    }
    if (loose.length > 0) {
      groups.push({ name: 'body', cubes: loose });
      notes.push(`${loose.length} cube(s) sit outside every outliner group and were attached to a root "body" bone so they still render`);
    }
  } else {
    const cubes: IRCube[] = [];
    for (const element of elements) {
      const cube = buildCube(element, notes);
      if (cube) cubes.push(cube);
    }
    groups.push({ name: 'body', cubes });
    notes.push('the document declares no outliner, so every cube sits on one "body" bone (no hierarchy to recover)');
  }

  if (groups.every((group) => group.cubes.length === 0)) return null;

  const graph = buildSourceBoneGraph(groups);
  if (graph.bones.length === 0) return null;

  const modelFormat = (doc.meta?.model_format ?? '').toLowerCase();
  const isBlockSpace = modelFormat.includes('block') || modelFormat.includes('java');
  // Blockbench block models are authored inside a 0..16 box whose centre is 8, while Bedrock
  // geometry measures from the entity origin. The whole skeleton — cubes, pivots and rotation
  // origins — is shifted together, so the model neither floats half a block away nor rotates
  // around the wrong joint.
  const shift = isBlockSpace ? 8 : 0;
  if (shift !== 0) {
    for (const bone of graph.bones) {
      bone.pivot = [bone.pivot[0] - shift, bone.pivot[1], bone.pivot[2] - shift] as [number, number, number];
      bone.cubes = bone.cubes.map((cube) => ({
        ...cube,
        from: [cube.from[0] - shift, cube.from[1], cube.from[2] - shift] as [number, number, number],
        to: [cube.to[0] - shift, cube.to[1], cube.to[2] - shift] as [number, number, number],
        rotation: cube.rotation
          ? {
              ...cube.rotation,
              origin: [
                cube.rotation.origin[0] - shift,
                cube.rotation.origin[1],
                cube.rotation.origin[2] - shift,
              ] as [number, number, number],
            }
          : undefined,
      }));
    }
  }
  const width = Math.max(8, Math.round(num(doc.resolution?.width, input.textureWidth ?? 64)));
  const height = Math.max(8, Math.round(num(doc.resolution?.height, input.textureHeight ?? 64)));
  const identifier = canonicalGeometryId(input.modId, input.assetId);

  const ir: IntermediateModel = {
    id: identifier,
    sourcePath: `bbmodel/${input.assetId}.bbmodel`,
    space: 'entity',
    parentChain: [],
    textureWidth: width,
    textureHeight: height,
    bones: graph.bones as IRBone[],
    display: {},
    overrides: [],
    textureRefs: { 0: `${input.modId}:${input.assetId}` },
    textureAliases: {},
    resolvedTextures: {},
    uvLock: false,
    ambientOcclusion: true,
    guiLight: 'side',
    diagnostics: [],
    cubeCount: graph.bones.reduce((total, bone) => total + bone.cubes.length, 0),
  };

  const written = writeBedrockGeometry(ir, { identifier });
  if (written.cubes === 0) return null;

  return {
    id: identifier,
    json: written.json,
    bones: written.bones,
    cubes: written.cubes,
    quadruped: graph.quadruped,
    boneNames: graph.parts,
    notes,
    written,
  };
}

/** Blockbench keyframes → Bedrock animation clips, one clip per Blockbench animation. */
export function extractBbModelAnimations(text: string, ownerHint: string): {
  owner: string;
  clips: Record<string, BedrockAnimationClip>;
  notes: string[];
} {
  let doc: BbDocument;
  try {
    doc = JSON.parse(text) as BbDocument;
  } catch {
    return { owner: ownerHint, clips: {}, notes: [] };
  }
  const notes: string[] = [];
  const clips: Record<string, BedrockAnimationClip> = {};
  const animations = Array.isArray(doc.animations) ? doc.animations : [];

  for (let index = 0; index < animations.length; index += 1) {
    const animation = animations[index];
    if (!animation || typeof animation !== 'object') continue;
    const bones: Record<string, Record<string, unknown>> = {};
    let maxTime = 0;
    for (const animator of Object.values(animation.animators ?? {})) {
      const boneName = (animator?.name ?? '').trim();
      if (!boneName) continue;
      const track: Record<string, unknown> = {};
      for (const keyframe of animator.keyframes ?? []) {
        const channel = (keyframe.channel ?? '').toLowerCase();
        const bedrockChannel =
          channel === 'rotation' ? 'rotation' : channel === 'position' ? 'position' : channel === 'scale' ? 'scale' : '';
        if (!bedrockChannel) {
          notes.push(`animation "${animation.name ?? index}": channel "${channel}" has no Bedrock equivalent and was reported, not carried`);
          continue;
        }
        const time = num(keyframe.time, NaN);
        if (!Number.isFinite(time)) continue;
        const point = keyframe.data_points?.[0];
        const value: [number, number, number] = [num(point?.x), num(point?.y), num(point?.z)];
        const stamped = String(Math.max(0, Math.round(time * 1000) / 1000));
        const target = (track[bedrockChannel] as Record<string, unknown>) ?? {};
        target[stamped] = value;
        track[bedrockChannel] = target;
        maxTime = Math.max(maxTime, Math.max(0, time));
      }
      if (Object.keys(track).length > 0) bones[boneName] = track;
    }
    if (Object.keys(bones).length === 0) continue;

    const rawName = (animation.name ?? `clip_${index + 1}`).trim();
    const slug = rawName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '') || `clip_${index + 1}`;
    const clipId = `animation.${ownerHint || 'model'}.${slug}`;
    const clip: BedrockAnimationClip = { bones };
    const declared = num(animation.length, 0);
    clip.animation_length = declared > 0 ? Math.round(declared * 1000) / 1000 : Math.round(maxTime * 1000) / 1000;
    if (animation.loop === true || animation.loop === 'loop') clip.loop = true;
    else if (animation.loop === 'hold' || animation.loop === 'hold_on_last_frame') clip.loop = 'hold_on_last_frame';
    else if (animation.loop === 'once' || animation.loop === false) clip.loop = false;
    clips[clipId] = clip;
  }

  return { owner: ownerHint, clips, notes };
}

/** True when the file is a Blockbench authoring document with usable content. */
export function looksLikeBbModel(text: string): boolean {
  if (!text.includes('"elements"')) return false;
  return text.includes('"outliner"') || text.includes('"bbmodel"') || text.includes('"animators"') || text.includes('"model_format"');
}