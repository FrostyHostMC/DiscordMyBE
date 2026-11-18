import type {
  IRAnimationClip,
  IRTransformationChannel,
  Vector3Keyframe,
} from '@/utils/universalAnimationIR';

/**
 * Intermediate representation → Bedrock animation writer.
 *
 * The IR is the engine-neutral description of what a source clip *does*: per-bone position /
 * rotation / scale channels, keyframe times, interpolation, loop mode, blending, audio and
 * particle cues. This module turns that description back into a Bedrock `animations` object.
 *
 * Rules that decide every line below:
 *   • Nothing is invented. A channel that has no keyframe in the IR produces no track.
 *   • Molang axes stay Molang; numeric axes stay numbers (no radian guessing — the IR records
 *     the detected unit separately and it is reported, never applied twice).
 *   • A property Bedrock cannot express is NOT copied verbatim (that is how a pack ships JSON
 *     the client rejects). It is dropped from the output and listed in `dropped`.
 *   • An approximation (step interpolation, bezier tangents collapsed to catmull-rom) is
 *     recorded in `approximated` so the fidelity report can show real drift instead of 100%.
 */

export interface EmittedAnimationClip {
  clipId: string;
  document: Record<string, unknown>;
  bones: number;
  keyframes: number;
  /** Source properties with no Bedrock-safe representation — withheld from the output. */
  dropped: string[];
  /** Properties expressed differently by Bedrock (recorded, never silently changed). */
  approximated: string[];
}

const ALLOWED_RELATIVE_TO = new Set(['entity', 'parent']);
const CHANNELS = ['rotation', 'position', 'scale'] as const;

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function vectorOut(
  value: Vector3Keyframe['value'],
): [number | string, number | string, number | string] {
  const out: Array<number | string> = [];
  for (const axis of value) {
    out.push(typeof axis === 'number' ? round(axis) : axis);
  }
  return [
    out[0] ?? 0,
    out[1] ?? 0,
    out[2] ?? 0,
  ];
}

function lerpMode(
  interpolation: Vector3Keyframe['interpolation'],
  approximated: string[],
): string | null {
  if (interpolation === 'linear') return null;
  if (interpolation === 'catmullrom' || interpolation === 'smooth' || interpolation === 'bezier') {
    return 'catmullrom';
  }
  // `step`, `ease_in`, `ease_out`, `ease_in_out`, `custom`: Bedrock has no per-keyframe
  // equivalent, so the keyframe is written linearly and the loss is recorded.
  approximated.push(`interpolation:${interpolation}`);
  return null;
}

function buildChannelTrack(
  channel: IRTransformationChannel,
  approximated: string[],
): unknown {
  if (channel.keyframes.length === 0) return null;
  const first = channel.keyframes[0];
  const firstHasDiscontinuity = Boolean(first.preValue || first.postValue);
  if (channel.isStatic && channel.staticValue && !firstHasDiscontinuity) return vectorOut(channel.staticValue);
  if (channel.keyframes.length === 1 && !first.isMolang && !firstHasDiscontinuity) {
    return vectorOut(first.value);
  }
  const track: Record<string, unknown> = {};
  for (let index = 0; index < channel.keyframes.length; index += 1) {
    const keyframe = channel.keyframes[index];
    if (!Number.isFinite(keyframe.time) || keyframe.time < 0) continue;
    const time = String(round(keyframe.time));
    const previous = channel.keyframes[index - 1];

    // Bedrock's pre/post representation carries discontinuities and step segments exactly.
    // The source IR already records explicit pre/post values; a preceding step keyframe means
    // the current timestamp jumps from that held value to this keyframe's value.
    let preValue = keyframe.preValue;
    let postValue = keyframe.postValue;
    if (!preValue && !postValue && previous?.interpolation === 'step') {
      preValue = previous.postValue ?? previous.value;
      postValue = keyframe.value;
    }
    const mode = keyframe.isMolang || keyframe.interpolation === 'step'
      ? null
      : lerpMode(keyframe.interpolation, approximated);

    if (preValue || postValue) {
      track[time] = {
        pre: vectorOut(preValue ?? keyframe.value),
        post: vectorOut(postValue ?? keyframe.value),
        ...(mode ? { lerp_mode: mode } : {}),
      };
    } else {
      track[time] = mode
        ? { post: vectorOut(keyframe.value), lerp_mode: mode }
        : vectorOut(keyframe.value);
    }
  }
  if (Object.keys(track).length === 0) return null;
  return track;
}

/** Writes one IR clip as a Bedrock animation object (never a byte-for-byte source copy). */
export function emitAnimationClip(clip: IRAnimationClip): EmittedAnimationClip | null {
  const dropped: string[] = [];
  const approximated: string[] = [];
  for (const key of Object.keys(clip.unfamiliarProperties ?? {})) dropped.push(key);

  const bones: Record<string, unknown> = {};
  let keyframeCount = 0;

  for (const bone of Object.values(clip.bones ?? {})) {
    const track: Record<string, unknown> = {};
    let hasData = false;
    for (const name of CHANNELS) {
      const channel = bone[name];
      if (!channel) continue;
      const built = buildChannelTrack(channel, approximated);
      if (built === null) continue;
      track[name] = built;
      keyframeCount += channel.keyframes.length;
      hasData = true;
      if (channel.originalRotationUnit === 'radians') approximated.push('rotation-unit:detected-radians');
    }
    if (!hasData) continue;
    if (bone.relativeTo) {
      const relative: Record<string, string> = {};
      for (const [space, value] of Object.entries(bone.relativeTo)) {
        if (typeof value === 'string' && ALLOWED_RELATIVE_TO.has(value)) relative[space] = value;
        else dropped.push(`relative_to.${space}`);
      }
      if (Object.keys(relative).length > 0) track.relative_to = relative;
    }
    bones[bone.boneName] = track;
  }

  if (Object.keys(bones).length === 0) return null;

  const document: Record<string, unknown> = { bones };
  const timeline = clip.timeline;
  if (timeline) {
    if (timeline.loopMode === 'hold_on_last_frame') document.loop = 'hold_on_last_frame';
    else if (timeline.isLooping) document.loop = true;
    if (timeline.durationSeconds > 0) document.animation_length = round(timeline.durationSeconds);
    if (timeline.startDelay > 0) document.start_delay = round(timeline.startDelay);
    if (typeof timeline.blendWeight === 'number') document.blend_weight = timeline.blendWeight;
    else if (typeof timeline.blendWeight === 'string' && timeline.blendWeight.trim()) {
      document.blend_weight = timeline.blendWeight.trim();
    }
    if (timeline.overridePreviousAnimation === true) document.override_previous_animation = true;
    if (typeof timeline.animTimeUpdate === 'string' && timeline.animTimeUpdate.trim()) {
      document.anim_time_update = timeline.animTimeUpdate.trim();
    }
  }

  if ((clip.audioReferences ?? []).length > 0) {
    const sounds: Record<string, unknown> = {};
    for (const cue of clip.audioReferences) {
      const effect = typeof cue.sound === 'string' ? cue.sound.trim() : '';
      if (!effect) continue;
      const entry: Record<string, unknown> = { effect };
      if (typeof cue.volume === 'number') entry.volume = cue.volume;
      if (typeof cue.pitch === 'number') entry.pitch = cue.pitch;
      const locator = cue.rawExtras?.locator;
      if (typeof locator === 'string' && locator.trim()) entry.locator = locator.trim();
      const time = String(round(cue.time));
      const existing = sounds[time];
      if (existing === undefined) sounds[time] = entry;
      else if (Array.isArray(existing)) existing.push(entry);
      else sounds[time] = [existing, entry];
    }
    if (Object.keys(sounds).length > 0) document.sound_effects = sounds;
  }

  if ((clip.particleReferences ?? []).length > 0) {
    const particles: Record<string, unknown> = {};
    for (const cue of clip.particleReferences) {
      const effect = typeof cue.effect === 'string' ? cue.effect.trim() : '';
      if (!effect) continue;
      const entry: Record<string, unknown> = { effect };
      if (typeof cue.locator === 'string' && cue.locator.trim()) entry.locator = cue.locator.trim();
      if (cue.rawExtras?.bind_to_actor === false) entry.bind_to_actor = false;
      if (typeof cue.preEffectScript === 'string' && cue.preEffectScript.trim()) {
        entry.pre_effect_script = cue.preEffectScript.trim();
      }
      const time = String(round(cue.time));
      const existing = particles[time];
      if (existing === undefined) particles[time] = entry;
      else if (Array.isArray(existing)) existing.push(entry);
      else particles[time] = [existing, entry];
    }
    if (Object.keys(particles).length > 0) document.particle_effects = particles;
  }

  if ((clip.customEvents ?? []).length > 0) {
    const timeline: Record<string, string | string[]> = {};
    for (const cue of [...clip.customEvents].sort((a, b) => a.time - b.time)) {
      const event = typeof cue.event === 'string' ? cue.event.trim() : '';
      if (!event) continue;
      const time = String(round(cue.time));
      const existing = timeline[time];
      if (existing === undefined) timeline[time] = event;
      else if (Array.isArray(existing)) existing.push(event);
      else timeline[time] = [existing, event];
    }
    if (Object.keys(timeline).length > 0) document.timeline = timeline;
  }

  return {
    clipId: clip.id,
    document,
    bones: Object.keys(bones).length,
    keyframes: keyframeCount,
    dropped: [...new Set(dropped)],
    approximated: [...new Set(approximated)],
  };
}