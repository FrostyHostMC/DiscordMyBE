import {
  analyzeChannel,
  channelDuration,
  isPlainObject,
  type BedrockChannel,
} from '@/utils/animationChannelMath';
import { retargetClips } from '@/utils/boneRetarget';

/**
 * Dedicated Java → Bedrock animation translator.
 *
 * Java mods carry keyframes in shapes Bedrock cannot read: GeckoLib `vector` objects, nested
 * arrays, java easing names, framed `{time, value}` lists, vector channels emitted as arrays.
 * Copying that JSON into a pack is what made every ported clip fail validation. This module
 * re-writes each clip into a real Bedrock animation document: valid rotation/position/scale
 * channels, timestamps preserved, interpolation preserved where Bedrock supports it, looping
 * and duration preserved, and every unsupported expression recorded instead of dropped.
 */

export interface AnimationTranslationIssue {
  clip: string;
  bone: string;
  channel: string;
  kind: 'malformed' | 'unsupported' | 'normalised';
  detail: string;
}

export interface AnimationTranslationStats {
  clips: number;
  clipsSkipped: number;
  bones: number;
  channels: number;
  keyframes: number;
  normalised: number;
  unsupported: number;
  durationsDerived: number;
}

export interface BedrockAnimationClip {
  loop?: boolean | 'hold_on_last_frame';
  animation_length?: number;
  start_delay?: string | number;
  loop_delay?: string | number;
  blend_weight?: string | number;
  anim_time_update?: string;
  override_previous_animation?: boolean;
  bones: Record<string, Record<string, unknown>>;
  sound_effects?: Record<string, unknown>;
  particle_effects?: Record<string, unknown>;
  timeline?: Record<string, string | string[]>;
}

export interface AnimationTranslationResult {
  animations: Record<string, BedrockAnimationClip>;
  issues: AnimationTranslationIssue[];
  stats: AnimationTranslationStats;
  log: string[];
  /** source clip id → shipped Bedrock clip id */
  idMap: Record<string, string>;
}

const CLIP_MEMBERS = new Set([
  'format_version',
  'loop',
  'animation_length',
  'length',
  'bones',
  'bone',
  'name',
  'parent',
  'start_delay',
  'loop_delay',
  'blend_weight',
  'override_previous_animation',
  'sound_effects',
  'particle_effects',
  // Player Animation Library / Emotecraft wrapper metadata.
  'emote',
  'animators',
  'parts',
  'timeline',
  'geckoResource',
  'name',
  'author',
  'description',
  'version',
  'settings',
  '__emoteIssues',
]);

function emptyStats(): AnimationTranslationStats {
  return {
    clips: 0,
    clipsSkipped: 0,
    bones: 0,
    channels: 0,
    keyframes: 0,
    normalised: 0,
    unsupported: 0,
    durationsDerived: 0,
  };
}

/** Converts the legacy Emotecraft tick/part format into timestamped bone tracks. */
function convertEmotecraftEmote(emote: Record<string, unknown>): Record<string, unknown> {
  const issues: string[] = [];
  const moves = Array.isArray(emote.moves) ? emote.moves.filter(isPlainObject) : [];
  const beginTick = Number.isFinite(Number(emote.beginTick)) ? Number(emote.beginTick) : 0;
  const degrees = emote.degrees !== false;
  const easeBefore = emote.easeBeforeKeyframe === true;
  type PartFrame = {
    position: Record<string, number>;
    rotation: Record<string, number>;
    positionEasing?: string;
    rotationEasing?: string;
    bendAngle?: number;
    bendEasing?: string;
    bend: boolean;
  };
  const frames = new Map<number, {
    turn?: number;
    parts: Map<string, PartFrame>;
  }>();

  for (const move of moves) {
    const tick = Number(move.tick);
    if (!Number.isFinite(tick) || tick < 0) {
      issues.push('Emotecraft move with an invalid or negative tick was not carried.');
      continue;
    }
    let frame = frames.get(tick);
    if (!frame) {
      frame = { parts: new Map() };
      frames.set(tick, frame);
    }
    if (move.turn !== undefined) {
      const turn = Number(move.turn);
      if (Number.isFinite(turn)) frame.turn = turn;
      else issues.push('Emotecraft turn at tick ' + tick + ' is not numeric and was ignored.');
    }

    for (const partName of ['head', 'torso', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
      const transform = move[partName];
      if (!isPlainObject(transform)) continue;
      const part = frame.parts.get(partName) ?? { position: {}, rotation: {}, bend: false };
      let positionChanged = false;
      let rotationChanged = false;
      for (const axis of ['x', 'y', 'z']) {
        if (transform[axis] === undefined) continue;
        const value = Number(transform[axis]);
        if (Number.isFinite(value)) {
          part.position[axis] = value;
          positionChanged = true;
        } else issues.push('Emotecraft ' + partName + '.' + axis + ' at tick ' + tick + ' is not numeric and was not carried.');
      }
      for (const axis of ['pitch', 'yaw', 'roll']) {
        if (transform[axis] === undefined) continue;
        const value = Number(transform[axis]);
        if (Number.isFinite(value)) {
          part.rotation[axis] = value;
          rotationChanged = true;
        } else issues.push('Emotecraft ' + partName + '.' + axis + ' at tick ' + tick + ' is not numeric and was not carried.');
      }
      const easing = typeof move.easing === 'string' && move.easing.trim() ? move.easing.trim() : 'linear';
      if (positionChanged && easing) {
        if (part.positionEasing && part.positionEasing.toLowerCase() !== easing.toLowerCase()) {
          issues.push('Emotecraft ' + partName + ' position at tick ' + tick + ' has multiple easing declarations; the last declaration was used for that part/channel only.');
        }
        part.positionEasing = easing;
      }
      if (rotationChanged && easing) {
        if (part.rotationEasing && part.rotationEasing.toLowerCase() !== easing.toLowerCase()) {
          issues.push('Emotecraft ' + partName + ' rotation at tick ' + tick + ' has multiple easing declarations; the last declaration was used for that part/channel only.');
        }
        part.rotationEasing = easing;
      }
      if (transform.bend !== undefined) {
        part.bend = true;
        if (partName === 'head') {
          issues.push('Emotecraft head declares bend at tick ' + tick + '; the source format does not support head bending, so the invalid head bend was ignored.');
        } else {
          const rawBend = isPlainObject(transform.bend) ? transform.bend.value : transform.bend;
          const bendValue = Number(rawBend);
          if (Number.isFinite(bendValue)) {
            // Player Animation Library's legacy loader treats bend as degrees regardless
            // of the degrees flag (that flag applies to pitch/yaw/roll only).
            // PAL's JSON wrapper also permits { value: number }.
            part.bendAngle = bendValue;
            if (easing) part.bendEasing = easing;
          } else {
            issues.push('Emotecraft ' + partName + ' bend at tick ' + tick + ' is not a numeric angle; the channel was not carried.');
          }
        }
      }
      frame.parts.set(partName, part);
    }
  }

  // PlayerAnimator keeps keyframes on their absolute tick timeline. beginTick is
  // transition metadata, not a time offset; endTick is clamped to beginTick + 1.
  const endTick = Number.isFinite(Number(emote.endTick))
    ? Math.max(beginTick + 1, Number(emote.endTick))
    : beginTick + 1;
  const rawStopTick = Number.isFinite(Number(emote.stopTick)) ? Number(emote.stopTick) : 0;
  const wantsLoop = emote.isLoop === true || String(emote.isLoop).toLowerCase() === 'true';
  // The legacy loader treats returnTick as a one-based keyframe position.
  const hasReturnTick = emote.returnTick !== undefined && emote.returnTick !== null;
  const returnTick = hasReturnTick && Number.isFinite(Number(emote.returnTick))
    ? Math.max(Number(emote.returnTick) - 1, 0)
    : 0;
  const validLoop = wantsLoop && hasReturnTick && returnTick >= 0 && returnTick < endTick;
  const animationEndTick = validLoop
    ? endTick
    : rawStopTick <= endTick
      ? endTick + 3
      : rawStopTick;
  if (wantsLoop && !validLoop) {
    issues.push('Emotecraft loop has an invalid returnTick/endTick interval; the clip was kept as a one-shot rather than emitting a broken time loop.');
  }

  const bones: Record<string, Record<string, unknown>> = {};
  const orderedFrames = Array.from(frames.entries()).sort((a, b) => a[0] - b[0]);
  for (const partName of ['head', 'torso', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
    const boneName = ({
      torso: 'body',
      body: 'body',
      rightArm: 'right_arm',
      leftArm: 'left_arm',
      rightLeg: 'right_leg',
      leftLeg: 'left_leg',
    } as Record<string, string>)[partName] ?? partName;
    const partDefaults: Record<string, number[]> = {
      rightArm: [-5, 2, 0],
      leftArm: [5, 2, 0],
      leftLeg: [1.9, 12, 0.1],
      rightLeg: [-1.9, 12, 0.1],
    };
    const isBodyPart = partName === 'torso' || partName === 'body';
    const defaults = partDefaults[partName] ?? [0, 0, 0];
    const positionTrack: Record<string, unknown> = {};
    const rotationTrack: Record<string, unknown> = {};
    const bendTrack: Record<string, unknown> = {};
    const position = [0, 0, 0];
    const rotation = [0, 0, 0];
    let previousPositionTimeKey: string | undefined;
    let previousRotationTimeKey: string | undefined;
    let previousBendTimeKey: string | undefined;

    for (const [tick, frame] of orderedFrames) {
      const part = frame.parts.get(partName);
      if (!part) continue;
      const time = Math.round((tick / 20) * 1000) / 1000;
      const timeKey = String(time);
      const positionAxes = ['x', 'y', 'z'] as const;
      const rotationAxes = ['pitch', 'yaw', 'roll'] as const;
      const positionChanged = positionAxes.some((axis) => part.position[axis] !== undefined);
      const rotationChanged = rotationAxes.some((axis) => part.rotation[axis] !== undefined);

      if (positionChanged) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = part.position[positionAxes[axis]];
          if (value !== undefined) {
            const sourceDefault = defaults[axis];
            let offset = value - sourceDefault;
            // PlayerAnimator stores limb positions relative to their vanilla pivots, in
            // model units; Bedrock animation positions are 1/16-block model units.
            // Its player coordinate convention also negates limb Y and torso X.
            if (axis === 1 && !isBodyPart) offset *= -1;
            if (axis === 0 && isBodyPart) offset *= -1;
            position[axis] = offset * 16;
          }
        }
        if (easeBefore && previousPositionTimeKey && part.positionEasing) {
          const previous = positionTrack[previousPositionTimeKey] as Record<string, unknown>;
          previous.easing = part.positionEasing;
        }
        const easing = easeBefore ? undefined : part.positionEasing;
        positionTrack[timeKey] = { vector: [...position], ...(easing ? { easing } : {}) };
        previousPositionTimeKey = timeKey;
      }
      if (rotationChanged) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = part.rotation[rotationAxes[axis]];
          if (value !== undefined) {
            let angle = degrees ? value : value * (180 / Math.PI);
            // Legacy Emotecraft/PlayerAnimator's body bone uses the opposite X/Y
            // rotation convention; limbs and head keep their authored signs.
            if (isBodyPart && axis < 2) angle *= -1;
            rotation[axis] = angle + (frame.turn ?? 0) * 360;
          }
        }
        if (easeBefore && previousRotationTimeKey && part.rotationEasing) {
          const previous = rotationTrack[previousRotationTimeKey] as Record<string, unknown>;
          previous.easing = part.rotationEasing;
        }
        const easing = easeBefore ? undefined : part.rotationEasing;
        rotationTrack[timeKey] = { vector: [...rotation], ...(easing ? { easing } : {}) };
        previousRotationTimeKey = timeKey;
      }
      if (part.bendAngle !== undefined) {
        const angleRadians = part.bendAngle * (Math.PI / 180);
        const angle = Math.abs(angleRadians);
        if (easeBefore && previousBendTimeKey && part.bendEasing) {
          const previous = bendTrack[previousBendTimeKey] as Record<string, unknown>;
          previous.easing = part.bendEasing;
        }
        const easing = easeBefore ? undefined : part.bendEasing;
        // Match Emotecraft's Bedrock bend rig: the generated child segment rotates
        // around X and follows the two-pixel arc so the split mesh stays connected.
        bendTrack[timeKey] = {
          vector: [part.bendAngle, 0, 0],
          ...(easing ? { easing } : {}),
        };
        const bendPositionTrack = (bones[boneName + '_bend']?.position ?? {}) as Record<string, unknown>;
        bendPositionTrack[timeKey] = {
          vector: [0, 2 * (1 - Math.cos(angle)), -2 * Math.sin(angle)],
          ...(easing ? { easing } : {}),
        };
        bones[boneName + '_bend'] = {
          ...(bones[boneName + '_bend'] ?? {}),
          position: bendPositionTrack,
        };
        previousBendTimeKey = timeKey;
      }
    }

    if (Object.keys(positionTrack).length > 0) {
      if (!validLoop) {
        const resetTime = String(Math.round((animationEndTick / 20) * 1000) / 1000);
        positionTrack[resetTime] = {
          vector: [0, 0, 0],
          easing: easeBefore ? 'easeInOutSine' : previousPositionEasing ?? 'easeInOutSine',
        };
      }
      bones[boneName] = { ...(bones[boneName] ?? {}), position: positionTrack };
    }
    if (Object.keys(rotationTrack).length > 0) {
      if (!validLoop) {
        const resetTime = String(Math.round((animationEndTick / 20) * 1000) / 1000);
        rotationTrack[resetTime] = {
          vector: [0, 0, 0],
          easing: easeBefore ? 'easeInOutSine' : previousRotationEasing ?? 'easeInOutSine',
        };
      }
      bones[boneName] = { ...(bones[boneName] ?? {}), rotation: rotationTrack };
    }
    if (Object.keys(bendTrack).length > 0) {
      const bendBoneName = boneName + '_bend';
      const bendBone = (bones[bendBoneName] ?? {}) as Record<string, unknown>;
      const bendPositionTrack = (bendBone.position ?? {}) as Record<string, unknown>;
      if (!validLoop) {
        const resetTime = String(Math.round((animationEndTick / 20) * 1000) / 1000);
        const resetEasing = easeBefore ? 'easeInOutSine' : previousBendEasing ?? 'easeInOutSine';
        bendTrack[resetTime] = { vector: [0, 0, 0], easing: resetEasing };
        bendPositionTrack[resetTime] = { vector: [0, 0, 0], easing: resetEasing };
      }
      bones[bendBoneName] = {
        ...bendBone,
        rotation: bendTrack,
        ...(Object.keys(bendPositionTrack).length > 0 ? { position: bendPositionTrack } : {}),
      };
    }
  }

  const durationTick = animationEndTick;
  const result: Record<string, unknown> = {
    bones,
    animation_length: Math.max(0, durationTick / 20),
    loop: validLoop,
    __emoteIssues: issues,
  };
  if (validLoop && returnTick > 0) {
    const intro = Math.round((endTick / 20) * 1000) / 1000;
    const loopStart = Math.round((returnTick / 20) * 1000) / 1000;
    const loopDuration = Math.round(((endTick - returnTick) / 20) * 1000) / 1000;
    // Bedrock evaluates anim_time_update every frame. Keeping the source timeline in its
    // original coordinates lets the intro play once, then wraps only the returnTick→endTick
    // interval instead of restarting the entire emote at tick zero.
    result.anim_time_update =
      'query.anim_time < ' + intro + ' ? query.anim_time + query.delta_time : ' +
      loopStart + ' + math.mod(query.anim_time - ' + loopStart + ' + query.delta_time, ' + loopDuration + ')';
  }
  return result;
}

/** Locates the clip map inside any Java/GeckoLib animation document shape. */
function collectClipMap(document: unknown): Record<string, unknown> {
  if (!isPlainObject(document)) return {};
  const containers = [document.animations, document['minecraft:animations'], document.clips];
  for (const container of containers) {
    if (isPlainObject(container) && Object.keys(container).length > 0) return container;
  }
  // Emotecraft's legacy JSON wraps one animation in `emote`; PAL's Blockbench/Blender
  // exports may use the same wrapper while carrying GeckoLib-style animation tracks.
  // Treat it as one clip only when it actually contains a recognised rig-track container.
  if (isPlainObject(document.emote)) {
    const emote = document.emote;
    if (Array.isArray(emote.moves)) {
      const id = typeof document.name === 'string' && document.name.trim() ? document.name : 'emote';
      return { [id]: convertEmotecraftEmote(emote) };
    }
    if (isPlainObject(emote.bones) || isPlainObject(emote.bone) || isPlainObject(emote.animators) || isPlainObject(emote.parts)) {
      const id = typeof document.name === 'string' && document.name.trim() ? document.name : 'emote';
      return { [id]: emote };
    }
  }
  // Some Java exporters place the clip map directly at the document root.
  const rootClips = Object.entries(document).filter(
    ([key, value]) =>
      !CLIP_MEMBERS.has(key) &&
      isPlainObject(value) &&
      (isPlainObject((value as Record<string, unknown>).bones) ||
        isPlainObject((value as Record<string, unknown>).bone) ||
        isPlainObject((value as Record<string, unknown>).animators) ||
        isPlainObject((value as Record<string, unknown>).parts)),
  );
  return Object.fromEntries(rootClips);
}

function normaliseClipId(rawId: string, fallback: string, used: Set<string>): string {
  const clean = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^[_.-]+|[_.-]+$/g, '');
  const body = clean(rawId) || clean(fallback) || 'clip';
  const candidate = body.includes('.') ? body : `animation.${body}`;
  if (!used.has(candidate)) return candidate;
  let index = 2;
  while (used.has(`${candidate}_${index}`)) index += 1;
  return `${candidate}_${index}`;
}

function normaliseLoop(raw: unknown): boolean | 'hold_on_last_frame' | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  if (text === 'hold_on_last_frame') return 'hold_on_last_frame';
  if (text === 'true' || text === 'loop') return true;
  if (text === 'false' || text === 'once' || text === 'play_once') return false;
  return undefined;
}

/** Source sound/particle keyframes → Bedrock effect tracks, including simultaneous cues. */
function translateEffectTrack(
  raw: unknown,
  clipId: string,
  channel: 'sound_effects' | 'particle_effects',
  issues: AnimationTranslationIssue[],
): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) issues.push({ clip: clipId, bone: '', channel, kind: 'malformed', detail: channel + ' must be a timestamp-keyed object; source event data was not carried' });
    return null;
  }
  const track: Record<string, unknown> = {};
  for (const [time, rawEntries] of Object.entries(raw)) {
    if (!/^\s*-?\d+(?:\.\d+)?\s*$/.test(time)) {
      issues.push({ clip: clipId, bone: '', channel, kind: 'malformed', detail: 'event key "' + time + '" is not a numeric timestamp; event was not carried' });
      continue;
    }
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    const translated: Record<string, unknown>[] = [];
    for (const entry of entries) {
      if (typeof entry === 'string') {
        translated.push({ effect: entry });
        continue;
      }
      if (!isPlainObject(entry)) {
        issues.push({ clip: clipId, bone: '', channel, kind: 'malformed', detail: 'event at ' + time + 's is not a string or object; event was not carried' });
        continue;
      }
      const effect = entry.effect ?? entry.sound ?? entry.particle ?? entry.name ?? entry.id;
      if (typeof effect !== 'string' || !effect.trim()) {
        issues.push({ clip: clipId, bone: '', channel, kind: 'unsupported', detail: 'event at ' + time + 's has no effect/sound/particle identifier; source event was not carried' });
        continue;
      }
      const event: Record<string, unknown> = { effect: effect.trim() };
      const supported = channel === 'sound_effects'
        ? ['locator', 'volume', 'pitch']
        : ['locator', 'pre_effect_script', 'bind_to_actor'];
      for (const key of supported) {
        if (entry[key] !== undefined) event[key] = entry[key];
      }
      const known = new Set(['effect', 'sound', 'particle', 'name', 'id', ...supported]);
      for (const key of Object.keys(entry)) {
        if (!known.has(key)) issues.push({ clip: clipId, bone: '', channel, kind: 'unsupported', detail: 'event at ' + time + 's contains unsupported field "' + key + '"; supported event metadata was retained' });
      }
      translated.push(event);
    }
    if (translated.length === 1) track[time] = translated[0];
    else if (translated.length > 1) track[time] = translated;
  }
  return Object.keys(track).length > 0 ? track : null;
}

interface ClipTranslation {
  clip: BedrockAnimationClip | null;
  issues: AnimationTranslationIssue[];
  bones: number;
  channels: number;
  keyframes: number;
  normalised: number;
  unsupported: number;
  durationDerived: boolean;
  maxTime: number;
}

function translateClip(rawClip: unknown, clipId: string): ClipTranslation {
  const issues: AnimationTranslationIssue[] = [];
  const result: ClipTranslation = {
    clip: null,
    issues,
    bones: 0,
    channels: 0,
    keyframes: 0,
    normalised: 0,
    unsupported: 0,
    durationDerived: false,
    maxTime: 0,
  };
  if (!isPlainObject(rawClip)) {
    issues.push({ clip: clipId, bone: '', channel: 'clip', kind: 'malformed', detail: 'the clip is not an object' });
    return result;
  }
  if (Array.isArray(rawClip.__emoteIssues)) {
    for (const detail of rawClip.__emoteIssues) {
      if (typeof detail === 'string' && detail.trim()) {
        issues.push({ clip: clipId, bone: '', channel: 'emotecraft', kind: 'unsupported', detail: detail.trim() });
      }
    }
  }

  const rawBones = isPlainObject(rawClip.bones)
    ? rawClip.bones
    : isPlainObject(rawClip.bone)
      ? rawClip.bone
      : isPlainObject(rawClip.animators)
        ? rawClip.animators
        : isPlainObject(rawClip.parts)
          ? rawClip.parts
          : {};
  const hasEffectTracks = isPlainObject(rawClip.sound_effects) || isPlainObject(rawClip.particle_effects) || isPlainObject(rawClip.timeline);
  if (Object.keys(rawBones).length === 0 && !hasEffectTracks) {
    issues.push({
      clip: clipId,
      bone: '',
      channel: 'bones',
      kind: 'malformed',
      detail: 'the clip declares no bone or timed event tracks, so it animates nothing',
    });
    return result;
  }

  for (const [key, value] of Object.entries(rawClip)) {
    if (CLIP_MEMBERS.has(key) || value === undefined || value === null) continue;
    issues.push({
      clip: clipId,
      bone: '',
      channel: key,
      kind: 'unsupported',
      detail: `clip member "${key}" has no Bedrock animation equivalent; it was reported, not carried`,
    });
    result.unsupported += 1;
  }

  const bones: Record<string, Record<string, unknown>> = {};
  for (const [rawBoneName, rawTrack] of Object.entries(rawBones)) {
    if (!isPlainObject(rawTrack)) {
      issues.push({
        clip: clipId,
        bone: rawBoneName,
        channel: 'track',
        kind: 'malformed',
        detail: 'the bone track is not an object, so no channel could be read from it',
      });
      result.unsupported += 1;
      continue;
    }
    const boneName = rawBoneName.trim() || 'root';
    const track: Record<string, unknown> = {};
    for (const [sourceChannel, rawValue] of Object.entries(rawTrack)) {
      if (sourceChannel.trim().toLowerCase() === 'relative_to') {
        if (isPlainObject(rawValue)) track.relative_to = rawValue;
        continue;
      }
      const analysis = analyzeChannel(sourceChannel, rawValue);
      if (!analysis.channel) {
        const detail = analysis.problems[0]?.detail ?? `channel "${sourceChannel}" has no Bedrock equivalent`;
        issues.push({ clip: clipId, bone: boneName, channel: sourceChannel, kind: 'unsupported', detail });
        result.unsupported += 1;
        continue;
      }
      const channel: BedrockChannel = analysis.channel;
      track[channel] = analysis.value;
      result.channels += 1;
      result.keyframes += analysis.keyframeCount;
      const duration = channelDuration(rawValue);
      if (duration > result.maxTime) result.maxTime = duration;
      for (const problem of analysis.problems) {
        if (problem.kind === 'normalised') result.normalised += 1;
        if (problem.kind === 'unsupported') result.unsupported += 1;
        issues.push({ clip: clipId, bone: boneName, channel, kind: problem.kind, detail: problem.detail });
      }
    }
    if (Object.keys(track).length === 0) continue;
    bones[boneName] = track;
    result.bones += 1;
  }

  if (Object.keys(bones).length === 0 && !hasEffectTracks) {
    issues.push({
      clip: clipId,
      bone: '',
      channel: 'bones',
      kind: 'unsupported',
      detail: 'no bone channel in this clip could be mapped onto a Bedrock rotation/position/scale channel',
    });
    return result;
  }

  const clip: BedrockAnimationClip = { bones };
  const loop = normaliseLoop(rawClip.loop);
  if (loop !== undefined) clip.loop = loop;

  // Timed effect-only clips still have a real duration even when no bone channel exists.
  for (const eventTrack of [rawClip.sound_effects, rawClip.particle_effects, rawClip.timeline]) {
    if (!isPlainObject(eventTrack)) continue;
    for (const timeKey of Object.keys(eventTrack)) {
      const eventTime = Number(timeKey);
      if (Number.isFinite(eventTime) && eventTime >= 0) result.maxTime = Math.max(result.maxTime, eventTime);
    }
  }

  const declared = Number(rawClip.animation_length ?? rawClip.length);
  if (Number.isFinite(declared) && declared > 0) {
    clip.animation_length = declared;
  } else if (result.maxTime > 0) {
    clip.animation_length = Math.round(result.maxTime * 1000) / 1000;
    result.durationDerived = true;
  }

  if (typeof rawClip.start_delay === 'number' || typeof rawClip.start_delay === 'string') clip.start_delay = rawClip.start_delay;
  if (typeof rawClip.loop_delay === 'number' || typeof rawClip.loop_delay === 'string') clip.loop_delay = rawClip.loop_delay;
  if (typeof rawClip.blend_weight === 'number' || typeof rawClip.blend_weight === 'string') clip.blend_weight = rawClip.blend_weight;
  if (typeof rawClip.anim_time_update === 'string' && rawClip.anim_time_update.trim()) clip.anim_time_update = rawClip.anim_time_update.trim();
  if (typeof rawClip.override_previous_animation === 'boolean') clip.override_previous_animation = rawClip.override_previous_animation;

  const sounds = translateEffectTrack(rawClip.sound_effects, clipId, 'sound_effects', issues);
  if (sounds) clip.sound_effects = sounds;
  const particles = translateEffectTrack(rawClip.particle_effects, clipId, 'particle_effects', issues);
  if (particles) clip.particle_effects = particles;
  if (isPlainObject(rawClip.timeline)) {
    const timeline: Record<string, string | string[]> = {};
    for (const [time, rawEvent] of Object.entries(rawClip.timeline)) {
      if (!/^\s*-?\d+(?:\.\d+)?\s*$/.test(time)) {
        issues.push({ clip: clipId, bone: '', channel: 'timeline', kind: 'malformed', detail: 'timeline key "' + time + '" is not a numeric timestamp; event was not carried' });
        continue;
      }
      const events = (Array.isArray(rawEvent) ? rawEvent : [rawEvent]).filter((event): event is string => typeof event === 'string' && event.trim().length > 0);
      if (events.length === 1) timeline[time] = events[0];
      else if (events.length > 1) timeline[time] = events;
    }
    if (Object.keys(timeline).length > 0) clip.timeline = timeline;
  }

  result.clip = clip;
  return result;
}

export interface AnimationTranslateOptions {
  /** File stem used as a fallback clip id prefix. */
  fileHint?: string;
}

/**
 * Converts every clip in one source document into Bedrock animation JSON.
 * Nothing is discarded: a clip that cannot be mapped is counted in `stats.clipsSkipped`
 * and explained in `issues`.
 */
export function translateJavaAnimationSet(
  document: unknown,
  options: AnimationTranslateOptions = {},
): AnimationTranslationResult {
  const sourceClips = collectClipMap(document);
  const stats = emptyStats();
  const issues: AnimationTranslationIssue[] = [];
  const animations: Record<string, BedrockAnimationClip> = {};
  const idMap: Record<string, string> = {};
  const used = new Set<string>();
  const log: string[] = [];
  const hint = options.fileHint ?? 'clip';

  for (const [rawId, rawClip] of Object.entries(sourceClips)) {
    const clipId = normaliseClipId(rawId, hint, used);
    used.add(clipId);
    const translated = translateClip(rawClip, clipId);
    issues.push(...translated.issues);
    stats.channels += translated.channels;
    stats.keyframes += translated.keyframes;
    stats.normalised += translated.normalised;
    stats.unsupported += translated.unsupported;
    stats.bones += translated.bones;
    if (translated.durationDerived) stats.durationsDerived += 1;
    if (!translated.clip) {
      stats.clipsSkipped += 1;
      log.push(`[ANIMATION] Clip "${rawId}" was recorded as NOT CARRIED (no Bedrock-readable bone channel).`);
      continue;
    }
    animations[clipId] = translated.clip;
    idMap[rawId] = clipId;
    stats.clips += 1;
    if (clipId !== rawId) {
      log.push(`[ANIMATION] Clip id "${rawId}" normalised to "${clipId}" so entities and controllers can reference it.`);
    }
  }

  return { animations, issues, stats, log, idMap };
}

/**
 * Re-binds translated bone tracks onto the skeleton the shipped geometry actually declares.
 * A track whose bone does not exist is kept and reported — dropping it would hide a real
 * conversion failure.
 */
export function remapAnimationBones(
  animations: Record<string, unknown>,
  boneNames: string[],
): { animations: Record<string, unknown>; remapped: number; unmapped: string[] } {
  if (boneNames.length === 0) return { animations, remapped: 0, unmapped: [] };
  // Universal retargeter: identical name, canonical form, limb family + side, ordinal index
  // within a family, then unique token overlap. Each step is evidence from the source name
  // itself; an ambiguous source bone stays unmapped and is reported instead of being guessed,
  // because driving the wrong limb reads in game as a corrupt animation.
  const fit = retargetClips(animations, boneNames);
  return { animations: fit.animations, remapped: fit.remapped, unmapped: fit.unmapped };
}