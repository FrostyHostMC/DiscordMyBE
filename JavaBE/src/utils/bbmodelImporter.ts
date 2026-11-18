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
  interpolation?: string;
  data_points?: Array<Record<string, unknown>>;
  bezier_left_time?: number[];
  bezier_right_time?: number[];
  bezier_left_value?: number[];
  bezier_right_value?: number[];
}

interface BbAnimator {
  name?: string;
  rotation_global?: boolean;
  keyframes?: BbKeyframe[];
}

interface BbAnimation {
  name?: string;
  loop?: string | boolean;
  length?: number;
  snapping?: number;
  start_delay?: string | number;
  loop_delay?: string | number;
  blend_weight?: string | number;
  anim_time_update?: string;
  override?: boolean;
  animators?: Record<string, BbAnimator>;
}

interface BbDocument {
  meta?: { model_format?: string; format_version?: string };
  name?: string;
  resolution?: { width?: number; height?: number };
  elements?: BbElement[];
  groups?: Array<{ uuid?: string; name?: string }>;
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

/** Blockbench keyframes and effects → Bedrock clips, one clip per Blockbench animation. */
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
  const groupNames = new Map<string, string>();

  for (const group of doc.groups ?? []) {
    if (typeof group.uuid === 'string' && typeof group.name === 'string' && group.name.trim()) {
      groupNames.set(group.uuid, group.name.trim());
    }
  }
  const collectOutlinerNames = (nodes: Array<string | BbOutlinerNode>): void => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      if (typeof node.uuid === 'string' && typeof node.name === 'string' && node.name.trim()) {
        groupNames.set(node.uuid, node.name.trim());
      }
      if (Array.isArray(node.children)) collectOutlinerNames(node.children);
    }
  };
  collectOutlinerNames(doc.outliner ?? []);

  const cubic = (a: number, b: number, c: number, d: number, t: number): number => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  };
  const solveBezierParameter = (x0: number, x1: number, x2: number, x3: number, target: number): number => {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 36; iteration += 1) {
      const middle = (low + high) / 2;
      if (cubic(x0, x1, x2, x3, middle) < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  const component = (raw: unknown, fallback: number): number | string => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : fallback;
    if (typeof raw !== 'string' || !raw.trim()) return fallback;
    const value = raw.trim();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value.replace(/[\r\n]+/g, ' ');
  };
  const vector = (point: Record<string, unknown> | undefined, channel: string): [number | string, number | string, number | string] => {
    const fallback = channel === 'scale' ? 1 : 0;
    const values: [number | string, number | string, number | string] = [
      component(point?.x, fallback),
      component(point?.y, fallback),
      component(point?.z, fallback),
    ];
    // Blockbench's Bedrock codec mirrors X for position and X/Y for rotation.
    if (channel === 'position' || channel === 'rotation') {
      values[0] = typeof values[0] === 'number' ? -values[0] : '-(' + values[0] + ')';
    }
    if (channel === 'rotation') {
      values[1] = typeof values[1] === 'number' ? -values[1] : '-(' + values[1] + ')';
    }
    return values;
  };
  const appendTimed = (target: Record<string, unknown>, time: string, value: unknown): void => {
    const current = target[time];
    if (current === undefined) target[time] = value;
    else if (Array.isArray(current)) current.push(value);
    else target[time] = [current, value];
  };

  const usedClipIds = new Set<string>();

  for (let index = 0; index < animations.length; index += 1) {
    const animation = animations[index];
    const snapping = Math.max(1, Math.min(120, num(animation.snapping, 24)));
    if (!animation || typeof animation !== 'object') continue;
    const bones: Record<string, Record<string, unknown>> = {};
    const soundEffects: Record<string, unknown> = {};
    const particleEffects: Record<string, unknown> = {};
    const timeline: Record<string, unknown> = {};
    let maxTime = 0;

    for (const [animatorId, animator] of Object.entries(animation.animators ?? {})) {
      if (!animator || typeof animator !== 'object') continue;
      const keyframes = Array.isArray(animator.keyframes) ? [...animator.keyframes] : [];
      const isEffects = animatorId.toLowerCase() === 'effects' || (animator.name ?? '').toLowerCase() === 'effects';
      if (isEffects) {
        for (const keyframe of keyframes) {
          const time = num(keyframe.time, NaN);
          if (!Number.isFinite(time) || time < 0) continue;
          maxTime = Math.max(maxTime, time);
          const timeKey = String(Math.round(time * 1000) / 1000);
          const points = Array.isArray(keyframe.data_points) ? keyframe.data_points : [];
          const channel = (keyframe.channel ?? '').toLowerCase();
          if (channel === 'sound') {
            for (const point of points) {
              const effect = typeof point.effect === 'string' ? point.effect.trim() : '';
              if (!effect) continue;
              const entry: Record<string, unknown> = { effect };
              if (typeof point.locator === 'string' && point.locator.trim()) entry.locator = point.locator.trim();
              if (typeof point.volume === 'number') entry.volume = point.volume;
              if (typeof point.pitch === 'number') entry.pitch = point.pitch;
              appendTimed(soundEffects, timeKey, entry);
            }
          } else if (channel === 'particle') {
            for (const point of points) {
              const effect = typeof point.effect === 'string' ? point.effect.trim() : '';
              if (!effect) continue;
              const entry: Record<string, unknown> = { effect };
              if (typeof point.locator === 'string' && point.locator.trim()) entry.locator = point.locator.trim();
              if (point.bind_to_actor === false) entry.bind_to_actor = false;
              if (typeof point.script === 'string' && point.script.trim()) entry.pre_effect_script = point.script.trim();
              appendTimed(particleEffects, timeKey, entry);
            }
          } else if (channel === 'timeline') {
            const scripts = points
              .map((point) => typeof point.script === 'string' ? point.script.trim() : '')
              .filter(Boolean);
            if (scripts.length > 0) appendTimed(timeline, timeKey, scripts.length === 1 ? scripts[0] : scripts);
          } else {
            notes.push('animation "' + (animation.name ?? index) + '": effects animator channel "' + channel + '" was not recognized and was reported, not discarded silently');
          }
        }
        continue;
      }

      const boneName = (animator.name ?? '').trim() || groupNames.get(animatorId) || '';
      if (!boneName) {
        if (keyframes.length > 0) notes.push('animation "' + (animation.name ?? index) + '": animator UUID "' + animatorId + '" did not resolve to a Blockbench group name; its tracks were withheld rather than assigned to the wrong bone');
        continue;
      }
      const track: Record<string, unknown> = {};
      const sortedAll = keyframes
        .filter((keyframe) => Number.isFinite(Number(keyframe.time)) && Number(keyframe.time) >= 0)
        .sort((a, b) => Number(a.time) - Number(b.time));
      for (const keyframe of sortedAll) {
        const channel = (keyframe.channel ?? '').toLowerCase();
        if (channel !== 'rotation' && channel !== 'position' && channel !== 'scale') {
          notes.push('animation "' + (animation.name ?? index) + '": channel "' + channel + '" has no Bedrock bone equivalent and was reported, not carried');
        }
      }

      // Keyframe ordering and step/Bezier interpolation are channel-local. Interleaving
      // rotation, position and scale timestamps must never make one channel become another's
      // previous/next keyframe.
      for (const bedrockChannel of ['rotation', 'position', 'scale'] as const) {
        const sorted = sortedAll.filter((keyframe) => (keyframe.channel ?? '').toLowerCase() === bedrockChannel);
        const target: Record<string, unknown> = {};
        for (let keyIndex = 0; keyIndex < sorted.length; keyIndex += 1) {
          const keyframe = sorted[keyIndex];
          const time = Number(keyframe.time);
          const timeKey = String(Math.round(time * 1000) / 1000);
          const points = Array.isArray(keyframe.data_points) ? keyframe.data_points : [];
          if (points.length === 0) continue;
          const values = points.slice(0, 2).map((point) => vector(point, bedrockChannel));
          const previous = sorted[keyIndex - 1];
          const previousIsStep = previous?.interpolation === 'step';
          let value: unknown = values[0];
          if (values.length > 1) {
            value = { pre: values[0], post: values[1] };
          } else if (previousIsStep) {
            const previousPoints = previous?.data_points ?? [];
            const previousPoint = previousPoints[previousPoints.length > 1 ? 1 : 0];
            value = { pre: vector(previousPoint, bedrockChannel), post: values[0] };
          }
          if (keyframe.interpolation === 'catmullrom') {
            const needsPre = (!previous && time > 0) || Boolean(previous && previous.interpolation !== 'catmullrom');
            value = {
              ...(needsPre ? { pre: values[0] } : {}),
              post: values.length > 1 && needsPre ? values[1] : values[0],
              lerp_mode: 'catmullrom',
            };
          }
          target[timeKey] = value;
          maxTime = Math.max(maxTime, time);
        }

        // Blockbench stores Bezier handles as time/value offsets. Bedrock has no Bezier
        // interpolation mode, so bake numeric curves onto this animation's snapping grid.
        for (let segmentIndex = 0; segmentIndex < sorted.length - 1; segmentIndex += 1) {
          const before = sorted[segmentIndex];
          const after = sorted[segmentIndex + 1];
          if (before.interpolation !== 'bezier' && after.interpolation !== 'bezier') continue;
          const beforePoints = before.data_points ?? [];
          const afterPoints = after.data_points ?? [];
          const beforePoint = beforePoints[beforePoints.length > 1 ? 1 : 0];
          const afterPoint = afterPoints[0];
          if (!beforePoint || !afterPoint) continue;
          const t0 = Number(before.time);
          const t1 = Number(after.time);
          const gap = t1 - t0;
          if (!(gap > 0)) continue;
          const axes = ['x', 'y', 'z'] as const;
          const controls: Array<[number, number, number, number]> = [];
          let numeric = true;
          for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
            const axis = axes[axisIndex];
            const y0 = Number(beforePoint[axis]);
            const y3 = Number(afterPoint[axis]);
            if (!Number.isFinite(y0) || !Number.isFinite(y3)) {
              numeric = false;
              break;
            }
            const rightTime = Math.max(0, Math.min(gap, Number(before.bezier_right_time?.[axisIndex]) || 0));
            const leftTime = Math.max(-gap, Math.min(0, Number(after.bezier_left_time?.[axisIndex]) || 0));
            const y1 = y0 + (Number(before.bezier_right_value?.[axisIndex]) || 0);
            const y2 = y3 + (Number(after.bezier_left_value?.[axisIndex]) || 0);
            controls.push([t0, t0 + rightTime, t1 + leftTime, t1]);
            controls.push([y0, y1, y2, y3]);
          }
          if (!numeric) {
            notes.push('animation "' + (animation.name ?? index) + '": Bezier segment ' + t0 + 's–' + t1 + 's contains a Molang expression; endpoint expressions were preserved but the custom curve could not be numerically baked');
            continue;
          }
          for (let sampleTime = t0 + 1 / snapping; sampleTime < t1 - 0.000001; sampleTime += 1 / snapping) {
            const snappedTime = Math.round(sampleTime * snapping) / snapping;
            if (snappedTime <= t0 || snappedTime >= t1) continue;
            const timeKey = String(Math.round(snappedTime * 1000) / 1000);
            if (Object.prototype.hasOwnProperty.call(target, timeKey)) continue;
            const values: Record<string, number> = {};
            for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
              const x = controls[axisIndex * 2];
              const y = controls[axisIndex * 2 + 1];
              const parameter = solveBezierParameter(x[0], x[1], x[2], x[3], snappedTime);
              values[axes[axisIndex]] = cubic(y[0], y[1], y[2], y[3], parameter);
            }
            target[timeKey] = vector(values, bedrockChannel);
          }
        }
        if (Object.keys(target).length > 0) track[bedrockChannel] = target;
      }
      if (animator.rotation_global) track.relative_to = { rotation: 'entity' };
      if (Object.keys(track).length > 0) bones[boneName] = track;
    }

    if (Object.keys(bones).length === 0 && Object.keys(soundEffects).length === 0 && Object.keys(particleEffects).length === 0 && Object.keys(timeline).length === 0) continue;

    const rawName = (animation.name ?? ('clip_' + (index + 1))).trim();
    const slug = rawName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '') || ('clip_' + (index + 1));
    const baseClipId = 'animation.' + (ownerHint || 'model') + '.' + slug;
    let clipId = baseClipId;
    let duplicateIndex = 2;
    while (usedClipIds.has(clipId)) {
      clipId = baseClipId + '_' + duplicateIndex;
      duplicateIndex += 1;
    }
    usedClipIds.add(clipId);
    const clip: BedrockAnimationClip = { bones };
    const declared = num(animation.length, 0);
    clip.animation_length = declared > 0 ? Math.round(declared * 1000) / 1000 : Math.round(maxTime * 1000) / 1000;
    if (animation.loop === true || animation.loop === 'loop') clip.loop = true;
    else if (animation.loop === 'hold' || animation.loop === 'hold_on_last_frame') clip.loop = 'hold_on_last_frame';
    else if (animation.loop === 'once' || animation.loop === false) clip.loop = false;
    if (animation.start_delay !== undefined) clip.start_delay = animation.start_delay;
    if (animation.loop_delay !== undefined) clip.loop_delay = animation.loop_delay;
    if (animation.blend_weight !== undefined) clip.blend_weight = animation.blend_weight;
    if (typeof animation.anim_time_update === 'string' && animation.anim_time_update.trim()) clip.anim_time_update = animation.anim_time_update.trim();
    if (animation.override === true) clip.override_previous_animation = true;
    if (Object.keys(soundEffects).length > 0) clip.sound_effects = soundEffects;
    if (Object.keys(particleEffects).length > 0) clip.particle_effects = particleEffects;
    if (Object.keys(timeline).length > 0) clip.timeline = timeline as Record<string, string | string[]>;
    clips[clipId] = clip;
  }

  return { owner: ownerHint, clips, notes };
}

/** True when the file is a Blockbench authoring document with usable content. */
export function looksLikeBbModel(text: string): boolean {
  if (!text.includes('"elements"')) return false;
  return text.includes('"outliner"') || text.includes('"bbmodel"') || text.includes('"animators"') || text.includes('"model_format"');
}