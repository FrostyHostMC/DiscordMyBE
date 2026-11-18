import {
  analyzeChannel,
  channelDuration,
  isPlainObject,
  geckoEase,
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
function convertEmotecraftEmote(emote: Record<string, unknown>, version = 1): Record<string, unknown> {
  const issues: string[] = [];
  const moves = Array.isArray(emote.moves) ? emote.moves.filter(isPlainObject) : [];
  const beginTick = Number.isFinite(Number(emote.beginTick)) ? Number(emote.beginTick) : 0;
  const degrees = emote.degrees !== false;
  const easeBefore = emote.easeBeforeKeyframe === true;
  const endTick = Number.isFinite(Number(emote.endTick))
    ? Math.max(beginTick + 1, Number(emote.endTick))
    : beginTick + 1;
  const rawStopTick = Number.isFinite(Number(emote.stopTick)) ? Number(emote.stopTick) : 0;
  const wantsLoop = emote.isLoop === true || String(emote.isLoop).toLowerCase() === 'true';
  const hasReturnTick = emote.returnTick !== undefined && emote.returnTick !== null;
  const returnTick = hasReturnTick && Number.isFinite(Number(emote.returnTick))
    ? Math.max(Number(emote.returnTick) - 1, 0)
    : 0;
  const validLoop = wantsLoop && hasReturnTick && returnTick >= 0 && returnTick < endTick;
  if (wantsLoop && !validLoop) {
    issues.push('Emotecraft loop has an invalid or missing returnTick/endTick interval; the clip was kept as a one-shot.');
  }
  const animationEndTick = validLoop
    ? endTick
    : rawStopTick <= endTick
      ? endTick + 3
      : rawStopTick;
  const loopDurationTick = validLoop ? endTick - returnTick : 0;
  const timelineEndTick = validLoop ? endTick + loopDurationTick : animationEndTick;

  type PartFrame = {
    position: Record<string, number>;
    rotation: Record<string, number>;
    scale: Record<string, number>;
    bendAngle?: number;
    easing: string;
    turn: number;
  };
  const frames = new Map<number, Map<string, PartFrame>>();
  for (const move of moves) {
    const tick = Number(move.tick);
    if (!Number.isFinite(tick) || tick < 0 || tick > endTick) {
      issues.push('Emotecraft move with an invalid or out-of-range tick was not carried.');
      continue;
    }
    let parts = frames.get(tick);
    if (!parts) {
      parts = new Map();
      frames.set(tick, parts);
    }
    const easing = typeof move.easing === 'string' && move.easing.trim() ? move.easing.trim() : 'linear';
    const turn = Number.isFinite(Number(move.turn)) ? Number(move.turn) : 0;
    for (const sourcePartName of ['head', 'torso', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
      const partName = version < 3 && sourcePartName === 'torso' ? 'body' : sourcePartName;
      const transform = move[sourcePartName];
      if (!isPlainObject(transform)) continue;
      const part = parts.get(partName) ?? { position: {}, rotation: {}, scale: {}, easing, turn };
      part.easing = easing;
      part.turn = turn;
      for (const axis of ['x', 'y', 'z']) {
        if (transform[axis] === undefined) continue;
        const value = Number(transform[axis]);
        if (Number.isFinite(value)) part.position[axis] = value;
        else issues.push('Emotecraft ' + partName + '.' + axis + ' at tick ' + tick + ' is not numeric.');
      }
      for (const axis of ['pitch', 'yaw', 'roll']) {
        if (transform[axis] === undefined) continue;
        const value = Number(transform[axis]);
        if (Number.isFinite(value)) part.rotation[axis] = value;
        else issues.push('Emotecraft ' + partName + '.' + axis + ' at tick ' + tick + ' is not numeric.');
      }
      for (const [sourceAxis, targetAxis] of [['scaleX', 'x'], ['scaleY', 'y'], ['scaleZ', 'z']] as const) {
        if (transform[sourceAxis] === undefined) continue;
        const value = Number(transform[sourceAxis]);
        if (Number.isFinite(value)) part.scale[targetAxis] = value;
        else issues.push('Emotecraft ' + partName + '.' + sourceAxis + ' at tick ' + tick + ' is not numeric.');
      }
      if (transform.bend !== undefined) {
        if (partName === 'head') {
          issues.push('Emotecraft head declares bend at tick ' + tick + '; the source format does not support head bending.');
        } else {
          const rawBend = isPlainObject(transform.bend) ? transform.bend.value : transform.bend;
          const bendValue = Number(rawBend);
          if (Number.isFinite(bendValue)) part.bendAngle = bendValue;
          else issues.push('Emotecraft ' + partName + ' bend at tick ' + tick + ' is not a numeric angle.');
        }
      }
      parts.set(partName, part);
    }
  }

  const orderedFrames = Array.from(frames.entries()).sort((a, b) => a[0] - b[0]);
  const defaults: Record<string, number[]> = {
    rightArm: [-5, 2, 0],
    leftArm: [5, 2, 0],
    leftLeg: [1.9, 12, 0.1],
    rightLeg: [-1.9, 12, 0.1],
  };
  const sampleTicks = new Set<number>();
  for (let tick = 0; tick <= Math.floor(timelineEndTick); tick += 1) sampleTicks.add(tick);
  sampleTicks.add(timelineEndTick);
  for (const [tick] of orderedFrames) sampleTicks.add(tick);
  if (validLoop) {
    const loopEnd = endTick + loopDurationTick;
    sampleTicks.add(loopEnd);
  }
  const sortedSampleTicks = [...sampleTicks].filter((tick) => tick >= 0 && tick <= timelineEndTick).sort((a, b) => a - b);
  const reportedEasings = new Set<string>();

  const evaluateEasing = (name: string, progress: number, label: string): number => {
    const registryName = name.trim().toLowerCase();
    const t = Math.max(0, Math.min(1, progress));
    const supported = new Set([
      'linear', 'constant', 'step',
      'easeinsine', 'easeoutsine', 'easeinoutsine',
      'easeinquad', 'easeoutquad', 'easeinoutquad',
      'easeincubic', 'easeoutcubic', 'easeinoutcubic',
      'easeinquart', 'easeoutquart', 'easeinoutquart',
      'easeinquint', 'easeoutquint', 'easeinoutquint',
      'easeinexpo', 'easeoutexpo', 'easeinoutexpo',
      'easeincirc', 'easeoutcirc', 'easeinoutcirc',
      'easeinback', 'easeoutback', 'easeinoutback',
      'easeinelastic', 'easeoutelastic', 'easeinoutelastic',
      'easeinbounce', 'easeoutbounce', 'easeinoutbounce',
      'catmullrom', 'bezier',
    ]);
    // The legacy move loader supplies no easing arguments. PAL's Catmull-Rom and Bezier
    // transformers therefore use their documented linear defaults.
    if (registryName === 'catmullrom' || registryName === 'bezier') return t;
    // Match PlayerAnimator's STEP implementation (default n=2), including its final
    // plateau at (n-1)/n rather than forcing the final sample to 1.
    if (registryName === 'step') return Math.min(Math.floor(t * 2), 1) / 2;
    if (!supported.has(registryName)) {
      const key = label + ':' + name;
      if (!reportedEasings.has(key)) {
        reportedEasings.add(key);
        issues.push('Emotecraft easing "' + name + '" on ' + label + ' is not in the PlayerAnimator easing registry; the source loader resolves unknown names to linear.');
      }
      return t;
    }
    const value = geckoEase(registryName || 'linear', t);
    return value !== null && Number.isFinite(value) ? value : t;
  };

  const getEntries = (
    partName: string,
    channel: 'position' | 'rotation' | 'scale' | 'bend',
    axis: string,
  ): Array<{ tick: number; value: number; easing: string }> => {
    const entries: Array<{ tick: number; value: number; easing: string }> = [];
    const isBodyPart = partName === 'body';
    const base = defaults[partName] ?? [0, 0, 0];
    for (const [tick, parts] of orderedFrames) {
      const part = parts.get(partName);
      if (!part) continue;
      if (channel === 'bend') {
        if (part.bendAngle !== undefined) entries.push({ tick, value: part.bendAngle, easing: part.easing });
        continue;
      }
      const raw = channel === 'position'
        ? part.position[axis]
        : channel === 'rotation'
          ? part.rotation[axis]
          : part.scale[axis];
      if (raw === undefined) continue;
      let value = raw;
      if (channel === 'position') {
        if (!isBodyPart) value -= base[['x', 'y', 'z'].indexOf(axis)] ?? 0;
        if (axis === 'y' && !isBodyPart) value *= -1;
        if (axis === 'x' && isBodyPart) value *= -1;
        value *= 16;
      } else if (channel === 'rotation') {
        value = degrees ? value : value * (180 / Math.PI);
        if (isBodyPart && (axis === 'pitch' || axis === 'yaw')) value *= -1;
        value += part.turn * 360;
      }
      entries.push({ tick, value, easing: part.easing });
    }
    return entries;
  };

  const sampleSourceTrack = (
    entries: Array<{ tick: number; value: number; easing: string }>,
    tick: number,
    defaultValue: number,
    label: string,
  ): number => {
    if (entries.length === 0) return defaultValue;
    const first = entries[0];
    if (tick < first.tick) {
      if (first.tick <= 0) return first.value;
      const easing = easeBefore ? first.easing : 'easeInOutSine';
      const progress = tick / first.tick;
      return defaultValue + (first.value - defaultValue) * evaluateEasing(easing, progress, label);
    }
    if (tick === first.tick || first.tick === 0 && tick === 0) return first.value;
    for (let index = 1; index < entries.length; index += 1) {
      const current = entries[index];
      const previous = entries[index - 1];
      if (tick <= current.tick) {
        const easing = easeBefore ? current.easing : previous.easing;
        const duration = current.tick - previous.tick;
        if (duration <= 0) return current.value;
        const progress = (tick - previous.tick) / duration;
        return previous.value + (current.value - previous.value) * evaluateEasing(easing, progress, label);
      }
    }
    return entries[entries.length - 1].value;
  };

  const sampleTrack = (
    entries: Array<{ tick: number; value: number; easing: string }>,
    tick: number,
    defaultValue: number,
    label: string,
  ): number => {
    if (entries.length === 0) return defaultValue;
    if (validLoop && tick >= endTick) {
      const firstLoopFrame = entries.find((entry) => entry.tick > returnTick) ?? entries[entries.length - 1];
      const lastValue = sampleSourceTrack(entries, endTick, defaultValue, label);
      const seamDuration = Math.max(0, firstLoopFrame.tick - returnTick);
      if (seamDuration > 0 && tick < endTick + seamDuration) {
        const lastEntry = entries[entries.length - 1];
        const easing = easeBefore ? firstLoopFrame.easing : lastEntry.easing;
        const progress = (tick - endTick) / seamDuration;
        return lastValue + (firstLoopFrame.value - lastValue) * evaluateEasing(easing, progress, label + ' loop seam');
      }
      const localTick = seamDuration > 0
        ? firstLoopFrame.tick + (tick - (endTick + seamDuration))
        : returnTick + (tick - endTick);
      return sampleSourceTrack(entries, Math.min(endTick, localTick), defaultValue, label);
    }
    if (!validLoop && tick > endTick) {
      const startValue = sampleSourceTrack(entries, endTick, defaultValue, label);
      const lastEntry = entries[entries.length - 1];
      const easing = easeBefore ? 'easeInOutSine' : lastEntry.easing;
      const duration = animationEndTick - endTick;
      if (duration <= 0) return defaultValue;
      const progress = (tick - endTick) / duration;
      return startValue + (defaultValue - startValue) * evaluateEasing(easing, progress, label + ' stop reset');
    }
    return sampleSourceTrack(entries, tick, defaultValue, label);
  };

  const constantBoundary = (
    entries: Array<{ tick: number; value: number; easing: string }>,
    tick: number,
    defaultValue: number,
  ): [number, number] | null => {
    if (entries.length === 0) return null;
    if (validLoop && tick >= endTick) {
      const firstLoopFrame = entries.find((entry) => entry.tick > returnTick) ?? entries[entries.length - 1];
      const lastEntry = entries[entries.length - 1];
      const seamDuration = Math.max(0, firstLoopFrame.tick - returnTick);
      const seamEnd = endTick + seamDuration;
      const seamEasing = easeBefore ? firstLoopFrame.easing : lastEntry.easing;
      if (seamDuration > 0 && tick === seamEnd && seamEasing.toLowerCase() === 'constant') {
        return [sampleSourceTrack(entries, endTick, defaultValue, 'loop seam'), firstLoopFrame.value];
      }
    }
    if (!validLoop && tick === animationEndTick) {
      const lastEntry = entries[entries.length - 1];
      const resetEasing = easeBefore ? 'easeInOutSine' : lastEntry.easing;
      if (resetEasing.toLowerCase() === 'constant') {
        return [sampleSourceTrack(entries, endTick, defaultValue, 'stop reset'), defaultValue];
      }
    }
    const index = entries.findIndex((entry) => entry.tick === tick);
    if (index < 0) return null;
    const current = entries[index];
    if (current.tick === 0) return null;
    const previous = index > 0 ? entries[index - 1] : null;
    const easing = easeBefore
      ? current.easing
      : previous?.easing ?? 'easeInOutSine';
    if (easing.toLowerCase() !== 'constant') return null;
    return [previous?.value ?? defaultValue, current.value];
  };

  const bones: Record<string, Record<string, unknown>> = {};
  for (const partName of ['head', 'torso', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) {
    const boneName = ({
      torso: 'body',
      body: version >= 3 ? 'waist' : 'waist',
      rightArm: 'right_arm',
      leftArm: 'left_arm',
      rightLeg: 'right_leg',
      leftLeg: 'left_leg',
    } as Record<string, string>)[partName] ?? partName;
    const positionAxes = ['x', 'y', 'z'];
    const rotationAxes = ['pitch', 'yaw', 'roll'];
    const positionEntries = positionAxes.map((axis) => getEntries(partName, 'position', axis));
    const rotationEntries = rotationAxes.map((axis) => getEntries(partName, 'rotation', axis));
    const scaleEntries = positionAxes.map((axis) => getEntries(partName, 'scale', axis));
    const bendEntries = getEntries(partName, 'bend', 'value');
    const hasPosition = positionEntries.some((entries) => entries.length > 0);
    const hasRotation = rotationEntries.some((entries) => entries.length > 0);
    const hasScale = scaleEntries.some((entries) => entries.length > 0);
    const hasBend = bendEntries.length > 0;
    const positionTrack: Record<string, unknown> = {};
    const rotationTrack: Record<string, unknown> = {};
    const scaleTrack: Record<string, unknown> = {};
    const bendRotationTrack: Record<string, unknown> = {};
    const bendPositionTrack: Record<string, unknown> = {};

    for (const tick of sortedSampleTicks) {
      const time = String(Math.round((tick / 20) * 1000) / 1000);
      if (hasPosition) {
        const post = positionEntries.map((entries) => sampleTrack(entries, tick, 0, partName + ' position'));
        const pre = [...post];
        let stepped = false;
        positionEntries.forEach((entries, axis) => {
          const boundary = constantBoundary(entries, tick, 0);
          if (boundary) { pre[axis] = boundary[0]; stepped = true; }
        });
        positionTrack[time] = stepped ? { pre, post, lerp_mode: 'linear' } : post;
      }
      if (hasRotation) {
        const post = rotationEntries.map((entries) => sampleTrack(entries, tick, 0, partName + ' rotation'));
        const pre = [...post];
        let stepped = false;
        rotationEntries.forEach((entries, axis) => {
          const boundary = constantBoundary(entries, tick, 0);
          if (boundary) { pre[axis] = boundary[0]; stepped = true; }
        });
        rotationTrack[time] = stepped ? { pre, post, lerp_mode: 'linear' } : post;
      }
      if (hasScale) {
        const post = scaleEntries.map((entries) => sampleTrack(entries, tick, 1, partName + ' scale'));
        const pre = [...post];
        let stepped = false;
        scaleEntries.forEach((entries, axis) => {
          const boundary = constantBoundary(entries, tick, 1);
          if (boundary) { pre[axis] = boundary[0]; stepped = true; }
        });
        scaleTrack[time] = stepped ? { pre, post, lerp_mode: 'linear' } : post;
      }
      if (hasBend) {
        const bendAngle = sampleTrack(bendEntries, tick, 0, partName + ' bend');
        const angle = Math.abs(bendAngle * Math.PI / 180);
        const boundary = constantBoundary(bendEntries, tick, 0);
        const bendPre = boundary?.[0] ?? bendAngle;
        const preAngle = Math.abs(bendPre * Math.PI / 180);
        bendRotationTrack[time] = boundary
          ? { pre: [bendPre, 0, 0], post: [bendAngle, 0, 0], lerp_mode: 'linear' }
          : [bendAngle, 0, 0];
        bendPositionTrack[time] = boundary
          ? {
              pre: [0, 2 * (1 - Math.cos(preAngle)), -2 * Math.sin(preAngle)],
              post: [0, 2 * (1 - Math.cos(angle)), -2 * Math.sin(angle)],
              lerp_mode: 'linear',
            }
          : [0, 2 * (1 - Math.cos(angle)), -2 * Math.sin(angle)];
      }
    }

    if (hasPosition) bones[boneName] = { ...(bones[boneName] ?? {}), position: positionTrack };
    if (hasRotation) bones[boneName] = { ...(bones[boneName] ?? {}), rotation: rotationTrack };
    if (hasScale) bones[boneName] = { ...(bones[boneName] ?? {}), scale: scaleTrack };
    if (hasBend) {
      const bendBoneName = partName === 'body' || partName === 'torso' ? 'body_bend' : boneName + '_bend';
      bones[bendBoneName] = {
        ...(bones[bendBoneName] ?? {}),
        rotation: bendRotationTrack,
        position: bendPositionTrack,
      };
    }
  }

  const result: Record<string, unknown> = {
    bones,
    animation_length: Math.max(0, timelineEndTick / 20),
    loop: validLoop,
    __emoteIssues: issues,
  };
  if (validLoop) {
    const intro = Math.round((endTick / 20) * 1000) / 1000;
    const loopStart = intro;
    const loopDuration = Math.round((loopDurationTick / 20) * 1000) / 1000;
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
      const version = Number.isFinite(Number(document.version)) ? Number(document.version) : 1;
      return { [id]: convertEmotecraftEmote(emote, version) };
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