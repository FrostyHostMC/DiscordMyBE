/**
 * Bedrock animation channel math.
 *
 * Java keyframe data (GeckoLib, Blockbench "vector" exports, item/block animators) describes
 * a channel in shapes Bedrock cannot read: a `vector`-wrapped object, a nested array, a
 * `{pre, post, lerp_mode}` object with a Java easing name, or a list of `{time, value}`
 * records. Bedrock reads exactly one shape per channel:
 *
 *   "rotation": { "0.0": [0, 0, 0], "1.0": { "pre": [...], "post": [...], "lerp_mode": "catmullrom" } }
 *
 * where a keyframe value is a number, a Molang string, a 1-3 component array, or an object
 * with pre/post/lerp_mode. This module normalises the Java shapes into that one shape and
 * reports every assumption it had to make, so nothing is silently discarded.
 */

export type BedrockChannel = 'rotation' | 'position' | 'scale';

/** Java channel spellings that map onto a Bedrock rotation/position/scale channel. */
export const CHANNEL_ALIASES: Record<string, BedrockChannel> = {
  rotation: 'rotation',
  rotate: 'rotation',
  rot: 'rotation',
  angles: 'rotation',
  eulerrotation: 'rotation',
  euler: 'rotation',
  rotationdegrees: 'rotation',
  position: 'position',
  pos: 'position',
  loc: 'position',
  offset: 'position',
  translate: 'position',
  translation: 'position',
  scale: 'scale',
  scaling: 'scale',
  uniformscale: 'scale',
};

export type ChannelProblemKind = 'malformed' | 'unsupported' | 'normalised';

export interface ChannelProblem {
  kind: ChannelProblemKind;
  detail: string;
}

export interface ChannelAnalysis {
  /** Bedrock channel this source channel maps onto; null when there is no equivalent. */
  channel: BedrockChannel | null;
  /** True when the source value was already valid Bedrock keyframe data. */
  ok: boolean;
  /** Bedrock-valid replacement for the whole channel value. */
  value: unknown;
  keyframeCount: number;
  problems: ChannelProblem[];
  /** True when values were approximated (padded, truncated, easing remapped). */
  approximated: boolean;
}

type KeyframeValue = number | string | Array<number | string> | Record<string, unknown>;

interface NormalisedKeyframe {
  value: KeyframeValue;
  problems: ChannelProblem[];
  approximated: boolean;
}

const IDENTITY: Record<BedrockChannel, number> = { rotation: 0, position: 0, scale: 1 };
const LERP_MODES = new Set<string>(['linear', 'catmullrom']);
const JAVA_LEAK = /Math\.|MathHelper|this\.|->|\bnew\s+[A-Z]|\bget[A-Z]\w*\(|\b(?:float|double)\b/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNumericKey(key: string): boolean {
  return /^\s*-?\d+(?:\.\d+)?\s*$/.test(key);
}

function balancedMolang(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function formatSeconds(time: number): string {
  if (!Number.isFinite(time) || time < 0) return '0';
  return String(Math.round(time * 1000) / 1000);
}

export function identityVector(channel: BedrockChannel): number[] {
  return [IDENTITY[channel], IDENTITY[channel], IDENTITY[channel]];
}

/** One keyframe component: a finite number, or a Molang expression Bedrock can evaluate. */
export function asMolangComponent(entry: unknown): number | string | null {
  if (typeof entry === 'number') return Number.isFinite(entry) ? entry : null;
  if (typeof entry === 'boolean') return entry ? 1 : 0;
  if (typeof entry !== 'string') return null;
  const text = entry.trim().replace(/;+\s*$/, '');
  if (!text) return null;
  if (JAVA_LEAK.test(text)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (!balancedMolang(text)) return null;
  return text;
}

function normaliseLerpMode(raw: unknown, problems: ChannelProblem[]): 'linear' | 'catmullrom' {
  if (raw === undefined || raw === null || raw === '') return 'linear';
  const text = String(raw).trim().toLowerCase();
  if (LERP_MODES.has(text)) return text as 'linear' | 'catmullrom';
  // GeckoLib / Java easing names have no Bedrock keyframe equivalent; smooth easings are
  // approximated with the engine's own smooth interpolation, linear/step ones stay linear.
  const smooth = /catmull|bezier|smooth|sine|quad|easeinout|easeoutin|elastic|circular|back/.test(text);
  problems.push({
    kind: 'normalised',
    detail: `interpolation "${String(raw)}" has no Bedrock keyframe equivalent; mapped to ${smooth ? 'catmullrom' : 'linear'} interpolation`,
  });
  return smooth ? 'catmullrom' : 'linear';
}

function normaliseVector(
  list: unknown[],
  channel: BedrockChannel,
  problems: ChannelProblem[],
): KeyframeValue {
  const flat: unknown[] = [];
  for (const entry of list) {
    if (Array.isArray(entry)) flat.push(...entry);
    else flat.push(entry);
  }
  if (flat.length === 0) {
    problems.push({ kind: 'malformed', detail: 'channel value is an empty array' });
    return identityVector(channel);
  }
  const components: Array<number | string> = [];
  for (const entry of flat) {
    const component = asMolangComponent(entry);
    if (component === null) {
      problems.push({ kind: 'unsupported', detail: `${JSON.stringify(entry)} is not a number or a Molang expression` });
      return identityVector(channel);
    }
    components.push(component);
  }
  if (components.length === 1) {
    problems.push({ kind: 'normalised', detail: 'single-component vector collapsed to a uniform channel value' });
    return components[0];
  }
  if (components.length === 2) {
    problems.push({
      kind: 'normalised',
      detail: 'two-component vector padded with the channel identity value so Bedrock can read three components',
    });
    return [components[0], components[1], IDENTITY[channel]];
  }
  if (components.length > 3) {
    problems.push({
      kind: 'normalised',
      detail: `vector holds ${components.length} components; Bedrock reads three, the extras were dropped`,
    });
    return components.slice(0, 3);
  }
  return components;
}

function normaliseKeyframeObject(
  raw: Record<string, unknown>,
  channel: BedrockChannel,
  problems: ChannelProblem[],
): NormalisedKeyframe {
  // GeckoLib wraps the actual value in a "vector" (or value/values/offset) member.
  for (const holder of ['vector', 'value', 'values', 'vec', 'offset']) {
    if (raw[holder] !== undefined && raw[holder] !== null) {
      const nested = normaliseKeyframe(raw[holder], channel);
      problems.push(...nested.problems);
      if (nested.approximated) {
        problems.push({ kind: 'normalised', detail: `"${holder}"-wrapped keyframe unwrapped into a Bedrock channel value` });
      }
      return { value: nested.value, problems, approximated: true };
    }
  }
  if (raw.x !== undefined || raw.y !== undefined || raw.z !== undefined) {
    const vector = normaliseVector(
      [raw.x ?? IDENTITY[channel], raw.y ?? IDENTITY[channel], raw.z ?? IDENTITY[channel]],
      channel,
      problems,
    );
    problems.push({ kind: 'normalised', detail: 'x/y/z keyframe converted into a Bedrock component vector' });
    return { value: vector, problems, approximated: true };
  }
  if (raw.pre !== undefined || raw.post !== undefined) {
    const post = normaliseKeyframe(raw.post ?? raw.pre, channel);
    const pre = normaliseKeyframe(raw.pre ?? raw.post, channel);
    problems.push(...post.problems, ...pre.problems);
    const lerp = normaliseLerpMode(raw.lerp_mode ?? raw.easing ?? raw.interpolation ?? raw.ease, problems);
    const sameValue = JSON.stringify(pre.value) === JSON.stringify(post.value);
    const approximated = post.approximated || pre.approximated || problems.some((p) => p.kind === 'normalised');
    // A keyframe whose pre/post are identical only needs the array form unless the source
    // asked for a specific interpolation curve.
    if (sameValue && lerp === 'linear') return { value: post.value, problems, approximated };
    return { value: { pre: pre.value, post: post.value, lerp_mode: lerp }, problems, approximated };
  }
  problems.push({ kind: 'malformed', detail: `keyframe object ${JSON.stringify(raw)} declares no readable value` });
  return { value: identityVector(channel), problems, approximated: false };
}

function normaliseKeyframe(raw: unknown, channel: BedrockChannel): NormalisedKeyframe {
  const problems: ChannelProblem[] = [];
  let value = raw;
  // Java exporters emit the vector itself wrapped in one or more single-element arrays.
  while (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) value = value[0];

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      problems.push({ kind: 'malformed', detail: 'keyframe is not a finite number' });
      return { value: IDENTITY[channel], problems, approximated: false };
    }
    return { value, problems, approximated: false };
  }
  if (typeof value === 'string') {
    const component = asMolangComponent(value);
    if (component === null) {
      problems.push({ kind: 'unsupported', detail: `"${value}" cannot be evaluated as Molang` });
      return { value: identityVector(channel), problems, approximated: false };
    }
    if (typeof component === 'string' && component !== value) {
      problems.push({ kind: 'normalised', detail: `Molang "${value}" normalised to "${component}"` });
    }
    return { value: component, problems, approximated: false };
  }
  if (Array.isArray(value)) {
    const vector = normaliseVector(value, channel, problems);
    return { value: vector, problems, approximated: problems.length > 0 };
  }
  if (isPlainObject(value)) return normaliseKeyframeObject(value, channel, problems);
  problems.push({ kind: 'malformed', detail: `${JSON.stringify(value ?? null)} is not a keyframe value` });
  return { value: identityVector(channel), problems, approximated: false };
}

interface KeyframeEntry {
  time: number;
  raw: unknown;
  label: string;
}

function looksLikeKeyframeObject(value: Record<string, unknown>): boolean {
  return ['pre', 'post', 'vector', 'value', 'values', 'vec', 'offset', 'lerp_mode', 'easing', 'x', 'y', 'z'].some(
    (key) => value[key] !== undefined,
  );
}

function collectKeyframeEntries(
  raw: unknown,
  problems: ChannelProblem[],
): { entries: KeyframeEntry[]; constant: boolean } {
  // A Java list of framed keyframes: [{ "time": 0.5, "vector": [...] }, ...]
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((entry) => isPlainObject(entry) && (entry.time !== undefined || entry.timestamp !== undefined))
  ) {
    const entries: KeyframeEntry[] = [];
    for (const entry of raw) {
      const record = entry as Record<string, unknown>;
      const time = Number(record.time ?? record.timestamp);
      if (!Number.isFinite(time)) {
        problems.push({ kind: 'malformed', detail: 'framed keyframe declares no numeric time' });
        continue;
      }
      entries.push({
        time,
        raw: record.value ?? record.vector ?? record.post ?? record,
        label: `@${formatSeconds(time)}s`,
      });
    }
    return { entries, constant: false };
  }
  if (isPlainObject(raw) && !looksLikeKeyframeObject(raw)) {
    const entries: KeyframeEntry[] = [];
    for (const [key, value] of Object.entries(raw)) {
      if (!isNumericKey(key)) {
        problems.push({ kind: 'malformed', detail: `"${key}" is not a keyframe timestamp` });
        continue;
      }
      entries.push({ time: Number(key), raw: value, label: `@${formatSeconds(Number(key))}s` });
    }
    return { entries, constant: false };
  }
  return { entries: [{ time: 0, raw, label: 'constant' }], constant: true };
}

/**
 * Normalises one source channel into a Bedrock channel value and records every problem.
 * The returned `value` is always safe to write into a shipped animation document, so a
 * caller can either report it or repair the file with it.
 */
export function analyzeChannel(sourceChannel: string, raw: unknown): ChannelAnalysis {
  const channel = CHANNEL_ALIASES[sourceChannel.trim().toLowerCase()] ?? null;
  if (!channel) {
    return {
      channel: null,
      ok: false,
      value: raw,
      keyframeCount: 0,
      problems: [{ kind: 'unsupported', detail: `channel "${sourceChannel}" has no Bedrock animation equivalent` }],
      approximated: false,
    };
  }

  const problems: ChannelProblem[] = [];
  const { entries, constant } = collectKeyframeEntries(raw, problems);

  if (entryIsEmpty(entries)) {
    problems.push({ kind: 'malformed', detail: 'the channel declares no keyframes' });
    return { channel, ok: false, value: identityVector(channel), keyframeCount: 0, problems, approximated: false };
  }

  const shaped: Array<{ time: number; value: KeyframeValue }> = [];
  let approximated = false;
  for (const entry of entries) {
    const keyframe = normaliseKeyframe(entry.raw, channel);
    problems.push(
      ...keyframe.problems.map((problem) => ({
        ...problem,
        detail: `${entry.label} ${problem.detail}`,
      })),
    );
    approximated = approximated || keyframe.approximated;
    shaped.push({ time: entry.time, value: keyframe.value });
  }

  if (constant) {
    return {
      channel,
      ok: problems.length === 0,
      value: shaped[0].value,
      keyframeCount: 1,
      problems,
      approximated,
    };
  }

  shaped.sort((a, b) => a.time - b.time);
  const keyframeMap: Record<string, unknown> = {};
  for (const entry of shaped) keyframeMap[formatSeconds(entry.time)] = entry.value;

  return {
    channel,
    ok: problems.length === 0,
    value: keyframeMap,
    keyframeCount: shaped.length,
    problems,
    approximated,
  };
}

function entryIsEmpty(entries: KeyframeEntry[]): boolean {
  return entries.length === 0;
}

/** Highest keyframe timestamp declared by a channel value, used to derive a clip length. */
export function channelDuration(channelValue: unknown): number {
  const analysis = collectKeyframeEntries(channelValue, []);
  if (analysis.constant) return 0;
  return analysis.entries.reduce((max, entry) => (Number.isFinite(entry.time) && entry.time > max ? entry.time : max), 0);
}