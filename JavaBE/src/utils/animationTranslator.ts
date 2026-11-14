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
  bones: Record<string, Record<string, unknown>>;
  sound_effects?: Record<string, unknown>;
  particle_effects?: Record<string, unknown>;
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

/** GeckoLib sound/particle keyframes → Bedrock `{ "effect": "id" }` effect keyframes. */
function translateEffectTrack(
  raw: unknown,
  clipId: string,
  channel: 'sound_effects' | 'particle_effects',
  issues: AnimationTranslationIssue[],
): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) issues.push({ clip: clipId, bone: '', channel, kind: 'malformed', detail: `${channel} must be a timestamp-keyed object; source event data was not carried` });
    return null;
  }
  const track: Record<string, unknown> = {};
  for (const [time, entry] of Object.entries(raw)) {
    if (!/^\s*-?\d+(?:\.\d+)?\s*$/.test(time)) {
      issues.push({ clip: clipId, bone: '', channel, kind: 'malformed', detail: `event key "${time}" is not a numeric timestamp; event was not carried` });
      continue;
    }
    if (typeof entry === 'string') { track[time] = { effect: entry }; continue; }
    if (!isPlainObject(entry)) {
      issues.push({ clip: clipId, bone: '', channel, kind: 'malformed', detail: `event at ${time}s is not a string or object; event was not carried` });
      continue;
    }
    const effect = entry.effect ?? entry.sound ?? entry.particle ?? entry.name ?? entry.id;
    if (typeof effect !== 'string' || !effect.trim()) {
      issues.push({ clip: clipId, bone: '', channel, kind: 'unsupported', detail: `event at ${time}s has no effect/sound/particle identifier; source event was not carried` });
      continue;
    }
    const event: Record<string, unknown> = { effect: effect.trim() };
    for (const key of ['locator', 'pre_effect_script', 'bind_to_actor']) {
      if (entry[key] !== undefined) event[key] = entry[key];
    }
    const known = new Set(['effect', 'sound', 'particle', 'name', 'id', 'locator', 'pre_effect_script', 'bind_to_actor']);
    for (const key of Object.keys(entry)) {
      if (!known.has(key)) issues.push({ clip: clipId, bone: '', channel, kind: 'unsupported', detail: `event at ${time}s contains unsupported field "${key}"; identifier and supported locator/script fields were retained` });
    }
    track[time] = event;
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

  const rawBones = isPlainObject(rawClip.bones)
    ? rawClip.bones
    : isPlainObject(rawClip.bone)
      ? rawClip.bone
      : isPlainObject(rawClip.animators)
        ? rawClip.animators
        : isPlainObject(rawClip.parts)
          ? rawClip.parts
          : null;
  if (!rawBones) {
    issues.push({
      clip: clipId,
      bone: '',
      channel: 'bones',
      kind: 'malformed',
      detail: 'the clip declares no bone tracks, so it animates nothing',
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

  if (Object.keys(bones).length === 0) {
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

  const declared = Number(rawClip.animation_length ?? rawClip.length);
  if (Number.isFinite(declared) && declared > 0) {
    clip.animation_length = declared;
  } else if (result.maxTime > 0) {
    clip.animation_length = Math.round(result.maxTime * 1000) / 1000;
    result.durationDerived = true;
  }

  const sounds = translateEffectTrack(rawClip.sound_effects, clipId, 'sound_effects', issues);
  if (sounds) clip.sound_effects = sounds;
  const particles = translateEffectTrack(rawClip.particle_effects, clipId, 'particle_effects', issues);
  if (particles) clip.particle_effects = particles;

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