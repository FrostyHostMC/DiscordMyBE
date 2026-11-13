import type {
  UniversalAnimationDiscoveryReport,
  DiscoveredSkeleton,
  DiscoveredController,
} from '@/utils/universalAnimationDiscovery';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { isPlainObject } from '@/utils/animationChannelMath';

export type KeyframeInterpolation =
  | 'linear'
  | 'catmullrom'
  | 'bezier'
  | 'step'
  | 'smooth'
  | 'ease_in'
  | 'ease_out'
  | 'ease_in_out'
  | 'custom';

export type ChannelType = 'position' | 'rotation' | 'scale';

export interface AnimTimeline {
  durationSeconds: number;
  timeUnit: 'seconds' | 'ticks' | 'frames';
  fps: number;
  startDelay: number;
  isLooping: boolean;
  loopMode: 'loop' | 'hold_on_last_frame' | 'once' | 'custom';
  blendWeight?: string | number;
  overridePreviousAnimation?: boolean;
  animTimeUpdate?: string;
  frameCount: number;
}

export interface Vector3Keyframe {
  time: number;
  originalTime: string | number;
  value: [number, number, number] | [string, string, string];
  preValue?: [number, number, number] | [string, string, string];
  postValue?: [number, number, number] | [string, string, string];
  interpolation: KeyframeInterpolation;
  bezierHandles?: {
    pre?: [number, number, number];
    post?: [number, number, number];
  };
  isMolang: boolean;
  rawExtras: Record<string, unknown>;
}

export interface IRTransformationChannel {
  channel: ChannelType;
  keyframes: Vector3Keyframe[];
  staticValue?: [number, number, number] | [string, string, string];
  isStatic: boolean;
  originalRotationUnit?: 'degrees' | 'radians';
  minTime: number;
  maxTime: number;
  valueBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  proceduralExpressions: string[];
  unfamiliarProperties: Record<string, unknown>;
}

export interface IRBoneTransformation {
  boneName: string;
  canonicalBoneName: string;
  parentBone?: string;
  childBones: string[];
  hierarchyDepth: number;
  pivot?: [number, number, number];
  relativeTo?: {
    rotation?: 'entity' | 'parent';
    position?: 'entity' | 'parent';
  };
  position?: IRTransformationChannel;
  rotation?: IRTransformationChannel;
  scale?: IRTransformationChannel;
  hasMotion: boolean;
  motionIntensity: number;
  unfamiliarProperties: Record<string, unknown>;
}

export interface IRProceduralBehavior {
  targetBone: string;
  channel: ChannelType;
  kind:
    | 'bobbing'
    | 'sway'
    | 'look_at'
    | 'pendulum'
    | 'rotation_cycle'
    | 'noise_displacement'
    | 'molang_expression'
    | 'custom';
  expression: string;
  frequency?: number;
  amplitude?: number;
  phaseOffset?: number;
  description: string;
  parameters: Record<string, unknown>;
}

export interface IRAudioReference {
  time: number;
  sound: string;
  volume?: number;
  pitch?: number;
  rawExtras: Record<string, unknown>;
}

export interface IRParticleReference {
  time: number;
  effect: string;
  locator?: string;
  preEffectScript?: string;
  rawExtras: Record<string, unknown>;
}

export interface IRCustomEvent {
  time: number;
  event: string;
  payload?: unknown;
  rawExtras: Record<string, unknown>;
}

export interface IRAnimationClip {
  id: string;
  originalId: string;
  owner: string;
  sourceFormat: string;
  sourcePath: string;
  perspective: 'first_person' | 'third_person' | 'dual_perspective' | 'unspecified';
  targetClassification:
    | 'player'
    | 'entity'
    | 'equipment'
    | 'held_item'
    | 'block_object'
    | 'unclassified';
  timeline: AnimTimeline;
  bones: Record<string, IRBoneTransformation>;
  rootBones: string[];
  hierarchicalRelationships: Array<{ parent: string; child: string; depth: number }>;
  proceduralBehaviors: IRProceduralBehavior[];
  audioReferences: IRAudioReference[];
  particleReferences: IRParticleReference[];
  customEvents: IRCustomEvent[];
  dependencies: Array<{
    kind: 'bone' | 'molang' | 'locator' | 'sound' | 'particle';
    target: string;
    reason: string;
  }>;
  unfamiliarProperties: Record<string, unknown>;
}

export interface IRControllerTransition {
  targetState: string;
  condition: string;
  conditionCategory:
    | 'locomotion'
    | 'combat'
    | 'health_damage'
    | 'perspective'
    | 'timing'
    | 'custom';
  blendDuration: number;
  priority: number;
  unfamiliarProperties: Record<string, unknown>;
}

export interface IRControllerState {
  name: string;
  animations: Array<{ clipId: string; blendCondition?: string }>;
  transitions: IRControllerTransition[];
  blendTransition: number;
  onEntry: string[];
  onExit: string[];
  variables: Record<string, string>;
  isTerminal: boolean;
  unfamiliarProperties: Record<string, unknown>;
}

export interface IRAnimationController {
  id: string;
  owner: string;
  initialState: string;
  states: Record<string, IRControllerState>;
  stateGraph: {
    states: string[];
    transitions: Array<{ from: string; to: string; condition: string; blendDuration: number }>;
  };
  variables: Record<string, string>;
  referencedClips: string[];
  dependencies: string[];
  unfamiliarProperties: Record<string, unknown>;
}

export interface UniversalAnimationIRReport {
  clips: Record<string, IRAnimationClip>;
  clipCount: number;
  controllers: Record<string, IRAnimationController>;
  controllerCount: number;
  skeletonsMapped: number;
  bonesInterpreted: number;
  channelsNormalized: number;
  keyframesInterpreted: number;
  proceduralRulesDetected: number;
  audioReferencesCount: number;
  particleReferencesCount: number;
  hierarchiesResolved: number;
  unfamiliarPropertiesPreserved: number;
  proceduralExpressions: string[];
  perspectivesSummary: {
    firstPersonClips: number;
    thirdPersonClips: number;
    dualPerspectiveClips: number;
  };
  summary: string;
  log: string[];
}

export interface UniversalAnimationIRInput {
  discoveryReport: UniversalAnimationDiscoveryReport;
  rawControllers?: DiscoveredController[];
  onLog?: (line: string) => void;
}

const KNOWN_CLIP_FIELDS = new Set([
  'format_version',
  'animations',
  'animation_length',
  'length',
  'loop',
  'bones',
  'bone',
  'sound_effects',
  'particle_effects',
  'events',
  'blend_weight',
  'override_previous_animation',
  'anim_time_update',
  'start_delay',
  'fps',
  'name',
]);

const KNOWN_CHANNEL_FIELDS = new Set([
  'position',
  'rotation',
  'scale',
  'relative_to',
  'lerp_mode',
  'easing',
]);

const KNOWN_KEYFRAME_FIELDS = new Set([
  'post',
  'pre',
  'lerp_mode',
  'easing',
  'easingArgs',
  'interpolation',
  'handles',
]);

/** Categorizes Molang query triggers into semantic domains */
function categorizeMolangCondition(
  query: string,
): 'locomotion' | 'combat' | 'health_damage' | 'perspective' | 'timing' | 'custom' {
  const q = query.toLowerCase();
  if (q.includes('is_first_person') || q.includes('camera') || q.includes('view')) {
    return 'perspective';
  }
  if (
    q.includes('is_moving') ||
    q.includes('modified_move_speed') ||
    q.includes('ground_speed') ||
    q.includes('is_jumping') ||
    q.includes('is_swimming') ||
    q.includes('is_gliding')
  ) {
    return 'locomotion';
  }
  if (
    q.includes('is_delayed_attacking') ||
    q.includes('is_attacking') ||
    q.includes('is_charging') ||
    q.includes('item_in_use') ||
    q.includes('attack_time')
  ) {
    return 'combat';
  }
  if (q.includes('hurt_time') || q.includes('health') || q.includes('is_alive') || q.includes('is_dead')) {
    return 'health_damage';
  }
  if (q.includes('anim_time') || q.includes('life_time') || q.includes('math.mod')) {
    return 'timing';
  }
  return 'custom';
}

/** Parses raw Vector3 or Molang array/object representation */
function normalizeVector3Value(
  raw: unknown,
  fallback: [number, number, number] = [0, 0, 0],
): {
  value: [number, number, number] | [string, string, string];
  isMolang: boolean;
} {
  if (Array.isArray(raw)) {
    const v0 = raw[0];
    const v1 = raw[1];
    const v2 = raw[2];
    const isMolang = [v0, v1, v2].some((item) => typeof item === 'string' && /[a-z_.]/i.test(item));

    if (isMolang) {
      return {
        value: [String(v0 ?? '0'), String(v1 ?? '0'), String(v2 ?? '0')],
        isMolang: true,
      };
    }

    return {
      value: [
        Number(v0) || fallback[0],
        Number(v1) || fallback[1],
        Number(v2) || fallback[2],
      ],
      isMolang: false,
    };
  }

  if (isPlainObject(raw)) {
    const obj = raw as Record<string, unknown>;
    const x = obj.x ?? obj[0] ?? fallback[0];
    const y = obj.y ?? obj[1] ?? fallback[1];
    const z = obj.z ?? obj[2] ?? fallback[2];
    const isMolang = [x, y, z].some((item) => typeof item === 'string' && /[a-z_.]/i.test(item));

    if (isMolang) {
      return {
        value: [String(x), String(y), String(z)],
        isMolang: true,
      };
    }

    return {
      value: [Number(x) || fallback[0], Number(y) || fallback[1], Number(z) || fallback[2]],
      isMolang: false,
    };
  }

  if (typeof raw === 'number') {
    return {
      value: [raw, raw, raw],
      isMolang: false,
    };
  }

  if (typeof raw === 'string') {
    if (/[a-z_.]/i.test(raw)) {
      return {
        value: [raw, raw, raw],
        isMolang: true,
      };
    }
    const num = Number(raw) || 0;
    return {
      value: [num, num, num],
      isMolang: false,
    };
  }

  return {
    value: fallback,
    isMolang: false,
  };
}

/** Detects procedural mathematical formulas in Molang expressions */
function detectProceduralFormulas(
  expressions: string[],
  boneName: string,
  channel: ChannelType,
): IRProceduralBehavior[] {
  const behaviors: IRProceduralBehavior[] = [];

  for (const expr of expressions) {
    const lower = expr.toLowerCase();
    if (!lower.includes('math.') && !lower.includes('query.')) continue;

    if (lower.includes('math.sin') || lower.includes('math.cos')) {
      const isSway = lower.includes('anim_time') || lower.includes('life_time');
      const isBobbing = lower.includes('body') || lower.includes('head') || channel === 'position';
      behaviors.push({
        targetBone: boneName,
        channel,
        kind: isSway && channel === 'rotation' ? 'sway' : isBobbing ? 'bobbing' : 'pendulum',
        expression: expr,
        description: `Procedural harmonic oscillation detected on bone "${boneName}" (${channel})`,
        parameters: { formula: expr },
      });
    } else if (lower.includes('target_x_rotation') || lower.includes('target_y_rotation') || lower.includes('look_at')) {
      behaviors.push({
        targetBone: boneName,
        channel,
        kind: 'look_at',
        expression: expr,
        description: `Entity procedural look-at targeting bound to bone "${boneName}"`,
        parameters: { formula: expr },
      });
    } else if (lower.includes('math.mod') && (lower.includes('rot') || lower.includes('360'))) {
      behaviors.push({
        targetBone: boneName,
        channel,
        kind: 'rotation_cycle',
        expression: expr,
        description: `Continuous mechanical/environmental rotation cycle on "${boneName}"`,
        parameters: { formula: expr },
      });
    } else {
      behaviors.push({
        targetBone: boneName,
        channel,
        kind: 'molang_expression',
        expression: expr,
        description: `Procedural Molang expression driving bone "${boneName}"`,
        parameters: { formula: expr },
      });
    }
  }

  return behaviors;
}

/** Extracts keyframe points, pre/post tangents, and unfamiliar properties */
function interpretChannelTrack(
  channel: ChannelType,
  rawTrack: unknown,
  timeMultiplier = 1.0,
): {
  channelIR: IRTransformationChannel | null;
  unfamiliarCount: number;
} {
  let unfamiliarCount = 0;
  const channelUnfamiliar: Record<string, unknown> = {};

  if (!rawTrack) return { channelIR: null, unfamiliarCount: 0 };

  const keyframes: Vector3Keyframe[] = [];
  const proceduralExprs: string[] = [];
  const fallbackVector: [number, number, number] = channel === 'scale' ? [1, 1, 1] : [0, 0, 0];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const updateBounds = (v: [number, number, number] | [string, string, string]) => {
    const x = typeof v[0] === 'number' ? v[0] : 0;
    const y = typeof v[1] === 'number' ? v[1] : 0;
    const z = typeof v[2] === 'number' ? v[2] : 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  };

  // Case A: Track is a static vector directly (e.g. [0, 10, 0] or {x: 0, y: 10, z: 0})
  if (Array.isArray(rawTrack) || typeof rawTrack === 'number' || typeof rawTrack === 'string') {
    const parsed = normalizeVector3Value(rawTrack, fallbackVector);
    updateBounds(parsed.value);
    if (parsed.isMolang) {
      for (const axis of parsed.value) {
        if (typeof axis === 'string') proceduralExprs.push(axis);
      }
    }
    return {
      channelIR: {
        channel,
        keyframes: [
          {
            time: 0,
            originalTime: 0,
            value: parsed.value,
            interpolation: 'linear',
            isMolang: parsed.isMolang,
            rawExtras: {},
          },
        ],
        staticValue: parsed.value,
        isStatic: true,
        minTime: 0,
        maxTime: 0,
        valueBounds: {
          min: [Number.isFinite(minX) ? minX : 0, Number.isFinite(minY) ? minY : 0, Number.isFinite(minZ) ? minZ : 0],
          max: [Number.isFinite(maxX) ? maxX : 0, Number.isFinite(maxY) ? maxY : 0, Number.isFinite(maxZ) ? maxZ : 0],
        },
        proceduralExpressions: proceduralExprs,
        unfamiliarProperties: {},
      },
      unfamiliarCount: 0,
    };
  }

  // Case B: Track is an object (keyframes or {x, y, z} vector)
  if (isPlainObject(rawTrack)) {
    const trackObj = rawTrack as Record<string, unknown>;

    // Check if it's a vector object {x: 0, y: 10, z: 0}
    if (
      (trackObj.x !== undefined || trackObj.y !== undefined || trackObj.z !== undefined) &&
      !Object.keys(trackObj).some((k) => /^\s*-?\d+(\.\d+)?\s*$/.test(k))
    ) {
      const parsed = normalizeVector3Value(trackObj, fallbackVector);
      updateBounds(parsed.value);
      if (parsed.isMolang) {
        for (const axis of parsed.value) {
          if (typeof axis === 'string') proceduralExprs.push(axis);
        }
      }
      return {
        channelIR: {
          channel,
          keyframes: [
            {
              time: 0,
              originalTime: 0,
              value: parsed.value,
              interpolation: 'linear',
              isMolang: parsed.isMolang,
              rawExtras: {},
            },
          ],
          staticValue: parsed.value,
          isStatic: true,
          minTime: 0,
          maxTime: 0,
          valueBounds: {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
          },
          proceduralExpressions: proceduralExprs,
          unfamiliarProperties: {},
        },
        unfamiliarCount: 0,
      };
    }

    // Process timestamped keyframes
    for (const [timeKey, rawKf] of Object.entries(trackObj)) {
      const isTimestamp = /^\s*-?\d+(?:\.\d+)?\s*$/.test(timeKey);
      if (!isTimestamp) {
        if (!KNOWN_CHANNEL_FIELDS.has(timeKey)) {
          channelUnfamiliar[timeKey] = rawKf;
          unfamiliarCount += 1;
        }
        continue;
      }

      const rawTime = parseFloat(timeKey);
      const timeInSec = (isNaN(rawTime) ? 0 : rawTime) * timeMultiplier;
      const kfExtras: Record<string, unknown> = {};

      let interp: KeyframeInterpolation = 'linear';
      let value: [number, number, number] | [string, string, string] = fallbackVector;
      let preValue: [number, number, number] | [string, string, string] | undefined;
      let postValue: [number, number, number] | [string, string, string] | undefined;
      let isMolang = false;
      let bezierHandles: { pre?: [number, number, number]; post?: [number, number, number] } | undefined;

      if (isPlainObject(rawKf)) {
        const kfObj = rawKf as Record<string, unknown>;

        // Interpolation
        const lerpMode = String(kfObj.lerp_mode ?? kfObj.interpolation ?? kfObj.easing ?? 'linear').toLowerCase();
        if (lerpMode.includes('catmullrom')) interp = 'catmullrom';
        else if (lerpMode.includes('bezier')) interp = 'bezier';
        else if (lerpMode.includes('step')) interp = 'step';
        else if (lerpMode.includes('smooth')) interp = 'smooth';
        else if (lerpMode.includes('ease_in_out')) interp = 'ease_in_out';
        else if (lerpMode.includes('ease_in')) interp = 'ease_in';
        else if (lerpMode.includes('ease_out')) interp = 'ease_out';

        // Tangent handles
        if (isPlainObject(kfObj.handles)) {
          const hObj = kfObj.handles as Record<string, unknown>;
          bezierHandles = {
            pre: Array.isArray(hObj.pre) ? [Number(hObj.pre[0]) || 0, Number(hObj.pre[1]) || 0, Number(hObj.pre[2]) || 0] : undefined,
            post: Array.isArray(hObj.post) ? [Number(hObj.post[0]) || 0, Number(hObj.post[1]) || 0, Number(hObj.post[2]) || 0] : undefined,
          };
        }

        // Values
        if (kfObj.post !== undefined) {
          const parsedPost = normalizeVector3Value(kfObj.post, fallbackVector);
          postValue = parsedPost.value;
          value = parsedPost.value;
          isMolang = isMolang || parsedPost.isMolang;
        }
        if (kfObj.pre !== undefined) {
          const parsedPre = normalizeVector3Value(kfObj.pre, fallbackVector);
          preValue = parsedPre.value;
          if (kfObj.post === undefined) value = parsedPre.value;
          isMolang = isMolang || parsedPre.isMolang;
        }
        if (kfObj.post === undefined && kfObj.pre === undefined) {
          const parsed = normalizeVector3Value(kfObj, fallbackVector);
          value = parsed.value;
          isMolang = parsed.isMolang;
        }

        // Preserve unfamiliar properties on keyframe
        for (const [k, v] of Object.entries(kfObj)) {
          if (!KNOWN_KEYFRAME_FIELDS.has(k) && k !== 'x' && k !== 'y' && k !== 'z') {
            kfExtras[k] = v;
            unfamiliarCount += 1;
          }
        }
      } else {
        const parsed = normalizeVector3Value(rawKf, fallbackVector);
        value = parsed.value;
        isMolang = parsed.isMolang;
      }

      updateBounds(value);
      if (isMolang) {
        for (const axis of value) {
          if (typeof axis === 'string') proceduralExprs.push(axis);
        }
      }

      keyframes.push({
        time: timeInSec,
        originalTime: timeKey,
        value,
        preValue,
        postValue,
        interpolation: interp,
        bezierHandles,
        isMolang,
        rawExtras: kfExtras,
      });
    }
  }

  if (keyframes.length === 0) {
    return { channelIR: null, unfamiliarCount };
  }

  keyframes.sort((a, b) => a.time - b.time);
  const minTime = keyframes[0].time;
  const maxTime = keyframes[keyframes.length - 1].time;

  return {
    channelIR: {
      channel,
      keyframes,
      isStatic: keyframes.length === 1 && !keyframes[0].isMolang,
      staticValue: keyframes.length === 1 ? keyframes[0].value : undefined,
      minTime,
      maxTime,
      valueBounds: {
        min: [Number.isFinite(minX) ? minX : 0, Number.isFinite(minY) ? minY : 0, Number.isFinite(minZ) ? minZ : 0],
        max: [Number.isFinite(maxX) ? maxX : 0, Number.isFinite(maxY) ? maxY : 0, Number.isFinite(maxZ) ? maxZ : 0],
      },
      proceduralExpressions: Array.from(new Set(proceduralExprs)),
      unfamiliarProperties: channelUnfamiliar,
    },
    unfamiliarCount,
  };
}

/**
 * Builds the Universal Intermediate Representation (IR) for discovered animation documents,
 * skeletons, controllers, and state machines.
 */
export function buildUniversalAnimationIR(
  input: UniversalAnimationIRInput,
): UniversalAnimationIRReport {
  const { discoveryReport, rawControllers, onLog } = input;
  const log: string[] = [];
  const logLine = (msg: string) => {
    log.push(msg);
    onLog?.(msg);
  };

  logLine('[ANIMATION:IR] Universal Animation Interpretation Engine constructing intermediate representation...');

  const clips: Record<string, IRAnimationClip> = {};
  const controllers: Record<string, IRAnimationController> = {};

  let bonesInterpreted = 0;
  let channelsNormalized = 0;
  let keyframesInterpreted = 0;
  let proceduralRulesDetected = 0;
  let audioReferencesCount = 0;
  let particleReferencesCount = 0;
  let hierarchiesResolved = 0;
  let unfamiliarPropertiesPreserved = 0;

  // Build skeleton lookup by owner
  const skeletonMap = new Map<string, DiscoveredSkeleton>();
  for (const skel of discoveryReport.skeletons ?? []) {
    skeletonMap.set(skel.owner.toLowerCase(), skel);
  }

  // 1. Interpret Animation Clips
  for (const [owner, clipSet] of Object.entries(discoveryReport.clipsByOwner ?? {})) {
    const ownerLower = owner.toLowerCase();
    const skeleton = skeletonMap.get(ownerLower);

    for (const [clipId, rawClip] of Object.entries(clipSet)) {
      const graphNode = discoveryReport.animationGraph?.[clipId];
      const timeUnit = graphNode?.timeUnit ?? 'seconds';
      const timeMultiplier = timeUnit === 'ticks' ? 1.0 / 20.0 : 1.0;
      const perspective = graphNode?.perspective ?? 'unspecified';
      const targetClassification = graphNode?.targetClassification ?? 'unclassified';
      const sourceFormat = graphNode?.format ?? 'universal-ir';
      const sourcePath = graphNode?.sourcePath ?? '';

      const clipUnfamiliar: Record<string, unknown> = {};

      // Detect unfamiliar top-level properties on the clip
      if (isPlainObject(rawClip)) {
        for (const [k, v] of Object.entries(rawClip as Record<string, unknown>)) {
          if (!KNOWN_CLIP_FIELDS.has(k)) {
            clipUnfamiliar[k] = v;
            unfamiliarPropertiesPreserved += 1;
          }
        }
      }

      // Loop & Blending
      const rawLoop = (rawClip as Record<string, unknown>).loop;
      let isLooping = false;
      let loopMode: AnimTimeline['loopMode'] = 'once';

      if (rawLoop === true || rawLoop === 'loop' || rawLoop === 'true') {
        isLooping = true;
        loopMode = 'loop';
      } else if (rawLoop === 'hold_on_last_frame') {
        isLooping = true;
        loopMode = 'hold_on_last_frame';
      } else if (typeof rawLoop === 'string' && rawLoop.trim()) {
        isLooping = true;
        loopMode = 'custom';
      }

      const blendWeight = (rawClip as Record<string, unknown>).blend_weight as string | number | undefined;
      const overridePrevious = (rawClip as Record<string, unknown>).override_previous_animation as boolean | undefined;
      const animTimeUpdate = (rawClip as Record<string, unknown>).anim_time_update as string | undefined;

      const rawStartDelay = Number((rawClip as Record<string, unknown>).start_delay) || 0;
      const declaredLength = Number((rawClip as Record<string, unknown>).animation_length ?? (rawClip as Record<string, unknown>).length) || 0;

      let maxClipTime = declaredLength;

      // Interpret bone tracks
      const bonesIR: Record<string, IRBoneTransformation> = {};
      const clipProcedural: IRProceduralBehavior[] = [];
      const clipDependencies: IRAnimationClip['dependencies'] = [];

      const rawBones = (rawClip.bones ?? (rawClip as Record<string, unknown>).bone ?? {}) as Record<string, unknown>;

      for (const [boneName, rawTrack] of Object.entries(rawBones)) {
        if (!isPlainObject(rawTrack)) continue;
        const trackObj = rawTrack as Record<string, unknown>;
        const boneLower = boneName.toLowerCase();

        bonesInterpreted += 1;

        // Hierarchy resolution from skeleton or canonical parent pointers
        const parentBone = skeleton?.parents?.[boneLower] ?? (skeleton?.parents?.[boneName]);
        const childBones = skeleton?.hierarchy?.[boneLower] ?? [];
        const pivot = skeleton?.pivots?.[boneLower] ?? skeleton?.pivots?.[boneName];

        let hierarchyDepth = 1;
        let cur = parentBone;
        while (cur && skeleton?.parents?.[cur]) {
          hierarchyDepth++;
          cur = skeleton.parents[cur];
          if (hierarchyDepth > 10) break;
        }

        hierarchiesResolved += 1;

        // Relative coordinate spaces
        const relativeTo = isPlainObject(trackObj.relative_to)
          ? (trackObj.relative_to as IRBoneTransformation['relativeTo'])
          : undefined;

        // Position channel
        const posResult = interpretChannelTrack('position', trackObj.position, timeMultiplier);
        unfamiliarPropertiesPreserved += posResult.unfamiliarCount;
        if (posResult.channelIR) {
          channelsNormalized += 1;
          keyframesInterpreted += posResult.channelIR.keyframes.length;
          maxClipTime = Math.max(maxClipTime, posResult.channelIR.maxTime);
          const procs = detectProceduralFormulas(posResult.channelIR.proceduralExpressions, boneName, 'position');
          clipProcedural.push(...procs);
          proceduralRulesDetected += procs.length;
        }

        // Rotation channel
        const rotResult = interpretChannelTrack('rotation', trackObj.rotation, timeMultiplier);
        unfamiliarPropertiesPreserved += rotResult.unfamiliarCount;
        if (rotResult.channelIR) {
          channelsNormalized += 1;
          keyframesInterpreted += rotResult.channelIR.keyframes.length;
          maxClipTime = Math.max(maxClipTime, rotResult.channelIR.maxTime);
          rotResult.channelIR.originalRotationUnit = graphNode?.rotationUnit ?? 'degrees';
          const procs = detectProceduralFormulas(rotResult.channelIR.proceduralExpressions, boneName, 'rotation');
          clipProcedural.push(...procs);
          proceduralRulesDetected += procs.length;
        }

        // Scale channel
        const scaleResult = interpretChannelTrack('scale', trackObj.scale, timeMultiplier);
        unfamiliarPropertiesPreserved += scaleResult.unfamiliarCount;
        if (scaleResult.channelIR) {
          channelsNormalized += 1;
          keyframesInterpreted += scaleResult.channelIR.keyframes.length;
          maxClipTime = Math.max(maxClipTime, scaleResult.channelIR.maxTime);
          const procs = detectProceduralFormulas(scaleResult.channelIR.proceduralExpressions, boneName, 'scale');
          clipProcedural.push(...procs);
          proceduralRulesDetected += procs.length;
        }

        // Unfamiliar properties on bone track
        const boneUnfamiliar: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(trackObj)) {
          if (!KNOWN_CHANNEL_FIELDS.has(k)) {
            boneUnfamiliar[k] = v;
            unfamiliarPropertiesPreserved += 1;
          }
        }

        // Motion analysis
        const hasMotion = Boolean(
          (posResult.channelIR && !posResult.channelIR.isStatic) ||
            (rotResult.channelIR && !rotResult.channelIR.isStatic) ||
            (scaleResult.channelIR && !scaleResult.channelIR.isStatic),
        );

        const motionIntensity =
          (posResult.channelIR ? posResult.channelIR.keyframes.length : 0) +
          (rotResult.channelIR ? rotResult.channelIR.keyframes.length : 0) +
          (scaleResult.channelIR ? scaleResult.channelIR.keyframes.length : 0);

        bonesIR[boneName] = {
          boneName,
          canonicalBoneName: boneLower,
          parentBone,
          childBones,
          hierarchyDepth,
          pivot,
          relativeTo,
          position: posResult.channelIR ?? undefined,
          rotation: rotResult.channelIR ?? undefined,
          scale: scaleResult.channelIR ?? undefined,
          hasMotion,
          motionIntensity,
          unfamiliarProperties: boneUnfamiliar,
        };
      }

      // Root bones in this clip
      const rootBones = Object.values(bonesIR)
        .filter((b) => !b.parentBone || !bonesIR[b.parentBone])
        .map((b) => b.boneName);

      const hierarchicalRelationships: IRAnimationClip['hierarchicalRelationships'] = [];
      for (const b of Object.values(bonesIR)) {
        if (b.parentBone && bonesIR[b.parentBone]) {
          hierarchicalRelationships.push({
            parent: b.parentBone,
            child: b.boneName,
            depth: b.hierarchyDepth,
          });
        }
      }

      // Audio cues
      const audioReferences: IRAudioReference[] = [];
      if (rawClip.sound_effects && isPlainObject(rawClip.sound_effects)) {
        for (const [timeKey, entry] of Object.entries(rawClip.sound_effects)) {
          const ts = parseFloat(timeKey) * timeMultiplier;
          const time = !isNaN(ts) ? ts : 0;
          if (isPlainObject(entry)) {
            const eObj = entry as Record<string, unknown>;
            const effect = String(eObj.effect ?? eObj.sound ?? eObj.name ?? '');
            if (effect) {
              const extras: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(eObj)) {
                if (k !== 'effect' && k !== 'sound' && k !== 'name') extras[k] = v;
              }
              audioReferences.push({
                time,
                sound: effect,
                volume: typeof eObj.volume === 'number' ? eObj.volume : undefined,
                pitch: typeof eObj.pitch === 'number' ? eObj.pitch : undefined,
                rawExtras: extras,
              });
              audioReferencesCount += 1;
            }
          } else if (typeof entry === 'string' && entry.trim()) {
            audioReferences.push({ time, sound: entry.trim(), rawExtras: {} });
            audioReferencesCount += 1;
          }
        }
      }

      // Particle cues
      const particleReferences: IRParticleReference[] = [];
      if (rawClip.particle_effects && isPlainObject(rawClip.particle_effects)) {
        for (const [timeKey, entry] of Object.entries(rawClip.particle_effects)) {
          const ts = parseFloat(timeKey) * timeMultiplier;
          const time = !isNaN(ts) ? ts : 0;
          if (isPlainObject(entry)) {
            const eObj = entry as Record<string, unknown>;
            const effect = String(eObj.effect ?? eObj.particle ?? '');
            if (effect) {
              const extras: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(eObj)) {
                if (k !== 'effect' && k !== 'particle' && k !== 'locator' && k !== 'pre_effect_script') {
                  extras[k] = v;
                }
              }
              particleReferences.push({
                time,
                effect,
                locator: typeof eObj.locator === 'string' ? eObj.locator : undefined,
                preEffectScript: typeof eObj.pre_effect_script === 'string' ? eObj.pre_effect_script : undefined,
                rawExtras: extras,
              });
              particleReferencesCount += 1;
            }
          } else if (typeof entry === 'string' && entry.trim()) {
            particleReferences.push({ time, effect: entry.trim(), rawExtras: {} });
            particleReferencesCount += 1;
          }
        }
      }

      // Timeline synthesis
      const finalDuration = maxClipTime > 0 ? Math.round(maxClipTime * 1000) / 1000 : 0.05;
      const inferredFps = timeUnit === 'ticks' ? 20 : 30;
      const frameCount = Math.max(1, Math.round(finalDuration * inferredFps));

      const timeline: AnimTimeline = {
        durationSeconds: finalDuration,
        timeUnit,
        fps: inferredFps,
        startDelay: rawStartDelay,
        isLooping,
        loopMode,
        blendWeight,
        overridePreviousAnimation: overridePrevious,
        animTimeUpdate,
        frameCount,
      };

      // Dependency resolution
      for (const bone of Object.keys(bonesIR)) {
        if (graphNode?.missingBones?.includes(bone)) {
          clipDependencies.push({
            kind: 'bone',
            target: bone,
            reason: `Bone "${bone}" required by track but not in base skeleton`,
          });
        }
      }
      for (const audio of audioReferences) {
        clipDependencies.push({
          kind: 'sound',
          target: audio.sound,
          reason: `Audio trigger "${audio.sound}" bound at ${audio.time}s`,
        });
      }
      for (const particle of particleReferences) {
        clipDependencies.push({
          kind: 'particle',
          target: particle.effect,
          reason: `Particle trigger "${particle.effect}" bound at ${particle.time}s`,
        });
        if (particle.locator) {
          clipDependencies.push({
            kind: 'locator',
            target: particle.locator,
            reason: `Locator "${particle.locator}" required for particle effect attachment`,
          });
        }
      }

      clips[clipId] = {
        id: clipId,
        originalId: clipId,
        owner,
        sourceFormat,
        sourcePath,
        perspective,
        targetClassification,
        timeline,
        bones: bonesIR,
        rootBones,
        hierarchicalRelationships,
        proceduralBehaviors: clipProcedural,
        audioReferences,
        particleReferences,
        customEvents: [],
        dependencies: clipDependencies,
        unfamiliarProperties: clipUnfamiliar,
      };
    }
  }

  // 2. Interpret Controllers & State Machines
  const sourceControllers = rawControllers ?? discoveryReport.controllersDiscovered ?? [];
  for (const ctrl of sourceControllers) {
    const statesIR: Record<string, IRControllerState> = {};
    const graphTransitions: IRAnimationController['stateGraph']['transitions'] = [];
    const referencedClips: string[] = [];

    for (const stateName of ctrl.states) {
      const stateTransitions: IRControllerTransition[] = [];

      // Link to state transitions if available from queries
      for (const q of ctrl.conditionQueries) {
        const cat = categorizeMolangCondition(q);
        stateTransitions.push({
          targetState: 'active',
          condition: q,
          conditionCategory: cat,
          blendDuration: 0.2,
          priority: 1,
          unfamiliarProperties: {},
        });
        graphTransitions.push({
          from: stateName,
          to: 'active',
          condition: q,
          blendDuration: 0.2,
        });
      }

      const animList: IRControllerState['animations'] = [];
      for (const ref of ctrl.animationsReferenced) {
        animList.push({ clipId: ref });
        if (!referencedClips.includes(ref)) referencedClips.push(ref);
      }

      const rawState = (typeof ctrl.raw === 'object' && ctrl.raw !== null)
        ? ((ctrl.raw as Record<string, unknown>).states as Record<string, unknown> | undefined)?.[stateName] as Record<string, unknown> | undefined
        : undefined;

      const onEntry: string[] = Array.isArray(rawState?.on_entry) ? (rawState?.on_entry as string[]) : [];
      const onExit: string[] = Array.isArray(rawState?.on_exit) ? (rawState?.on_exit as string[]) : [];
      const stateVars: Record<string, string> = {};
      if (typeof rawState?.variables === 'object' && rawState.variables !== null) {
        for (const [vk, vv] of Object.entries(rawState.variables as Record<string, unknown>)) {
          stateVars[vk] = typeof vv === 'string' ? vv : JSON.stringify(vv);
        }
      }

      statesIR[stateName] = {
        name: stateName,
        animations: animList,
        transitions: stateTransitions,
        blendTransition: 0.15,
        onEntry,
        onExit,
        variables: stateVars,
        isTerminal: stateName === 'death' || stateName === 'terminate',
        unfamiliarProperties: {},
      };
    }

    const ctrlVars: Record<string, string> = {};
    if (typeof ctrl.raw === 'object' && ctrl.raw !== null && typeof (ctrl.raw as Record<string, unknown>).variables === 'object') {
      for (const [vk, vv] of Object.entries((ctrl.raw as Record<string, unknown>).variables as Record<string, unknown>)) {
        ctrlVars[vk] = typeof vv === 'string' ? vv : JSON.stringify(vv);
      }
    }

    controllers[ctrl.id] = {
      id: ctrl.id,
      owner: ctrl.owner,
      initialState: ctrl.initialState ?? ctrl.states[0] ?? 'default',
      states: statesIR,
      stateGraph: {
        states: ctrl.states,
        transitions: graphTransitions,
      },
      variables: ctrlVars,
      referencedClips,
      dependencies: referencedClips,
      unfamiliarProperties: {},
    };
  }

  const firstPersonCount = Object.values(clips).filter((c) => c.perspective === 'first_person').length;
  const thirdPersonCount = Object.values(clips).filter((c) => c.perspective === 'third_person').length;
  const dualCount = Object.values(clips).filter((c) => c.perspective === 'dual_perspective').length;

  const clipCount = Object.keys(clips).length;
  const controllerCount = Object.keys(controllers).length;

  const allProceduralExprs: string[] = [];
  for (const clip of Object.values(clips)) {
    for (const b of clip.proceduralBehaviors ?? []) {
      if (typeof b?.expression === 'string' && b.expression.trim()) allProceduralExprs.push(b.expression);
    }
    for (const bone of Object.values(clip.bones ?? {})) {
      for (const ch of [bone.position, bone.rotation, bone.scale]) {
        for (const expr of ch?.proceduralExpressions ?? []) {
          if (typeof expr === 'string' && expr.trim()) allProceduralExprs.push(expr);
        }
      }
    }
  }

  const summary = `Universal Animation IR: Normalized ${clipCount} clip(s) and ${controllerCount} controller(s) into format-agnostic intermediate representation. ${bonesInterpreted} bone channel(s) evaluated, ${channelsNormalized} vector tracks normalized, ${keyframesInterpreted} keyframes parsed (${proceduralRulesDetected} procedural math rules, ${unfamiliarPropertiesPreserved} unfamiliar properties preserved verbatim).`;

  logLine(`[ANIMATION:IR] ${summary}`);
  logLine(
    `[ANIMATION:IR] Audio & Particle References: ${audioReferencesCount} sound cue(s), ${particleReferencesCount} particle cue(s); ${hierarchiesResolved} hierarchical parent-child bone link(s) bound.`,
  );

  return {
    clips,
    clipCount,
    controllers,
    controllerCount,
    skeletonsMapped: discoveryReport.skeletons.length,
    bonesInterpreted,
    channelsNormalized,
    keyframesInterpreted,
    proceduralRulesDetected,
    audioReferencesCount,
    particleReferencesCount,
    hierarchiesResolved,
    unfamiliarPropertiesPreserved,
    proceduralExpressions: Array.from(new Set(allProceduralExprs)),
    perspectivesSummary: {
      firstPersonClips: firstPersonCount,
      thirdPersonClips: thirdPersonCount,
      dualPerspectiveClips: dualCount,
    },
    summary,
    log,
  };
}