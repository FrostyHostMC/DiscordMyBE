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
  /** GeckoLib easing belongs to the destination keyframe for the segment leading into it. */
  easing?: string;
  easingArgs?: number[];
  easingArgsInvalid?: boolean;
}

const IDENTITY: Record<BedrockChannel, number> = { rotation: 0, position: 0, scale: 1 };
const LERP_MODES = new Set<string>(['linear', 'catmullrom']);
const JAVA_LEAK = /Math\.|MathHelper|this\.|\bnew\s+[A-Z]|\bget[A-Z]\w*\(|\b(?:float|double)\b/;

function isJavaLeak(text: string): boolean {
  if (JAVA_LEAK.test(text)) return true;
  // Bedrock Molang uses -> to access another entity's query/variable/temp/context scope.
  // A Java lambda is rejected unless the right side is a recognised Molang scope member.
  return text.includes('->') && !/(?:^|[\w.)\]])\s*->\s*(?:query|q|variable|v|temp|t|context|c)\./i.test(text);
}

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
  if (isJavaLeak(text)) return null;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (!balancedMolang(text)) return null;
  return text;
}

function normaliseLerpMode(raw: unknown, problems: ChannelProblem[]): 'linear' | 'catmullrom' {
  if (raw === undefined || raw === null || raw === '') return 'linear';
  const text = String(raw).trim().toLowerCase();
  if (LERP_MODES.has(text)) return text as 'linear' | 'catmullrom';
  problems.push({
    kind: 'normalised',
    detail: `interpolation "${String(raw)}" has no Bedrock keyframe equivalent; retained endpoints with linear interpolation instead of substituting an unrelated curve`,
  });
  return 'linear';
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

function easingMetadata(raw: Record<string, unknown>): Pick<NormalisedKeyframe, 'easing' | 'easingArgs'> {
  const interpolation = typeof raw.interpolation === 'string' ? raw.interpolation.trim() : '';
  const lerpMode = typeof raw.lerp_mode === 'string' ? raw.lerp_mode.trim() : '';
  const rawEasing = raw.easing ?? raw.easing_type ?? raw.easingType ?? raw.ease ??
    (interpolation && !LERP_MODES.has(interpolation.toLowerCase()) ? interpolation : undefined) ??
    (lerpMode.toLowerCase() === 'step' ? 'step' : undefined);
  const easingText = typeof rawEasing === 'string' && rawEasing.trim() ? rawEasing.trim() : undefined;
  const easing = easingText?.toLowerCase() === 'catmullrom' ? undefined : easingText;
  const rawArgs = raw.easing_args ?? raw.easingArgs;
  const parsedArgs = Array.isArray(rawArgs) ? rawArgs.map((value) => Number(value)) : [];
  const easingArgsInvalid = rawArgs !== undefined && (!Array.isArray(rawArgs) || parsedArgs.some((value) => !Number.isFinite(value)));
  const easingArgs = easingArgsInvalid ? undefined : (Array.isArray(rawArgs) ? parsedArgs : undefined);
  return { easing, easingArgs, easingArgsInvalid };
}

function normaliseKeyframeObject(
  raw: Record<string, unknown>,
  channel: BedrockChannel,
  problems: ChannelProblem[],
): NormalisedKeyframe {
  const easing = easingMetadata(raw);
  // GeckoLib wraps the actual value in a "vector" (or value/values/offset) member.
  for (const holder of ['vector', 'value', 'values', 'vec', 'offset']) {
    if (raw[holder] !== undefined && raw[holder] !== null) {
      const nested = normaliseKeyframe(raw[holder], channel);
      problems.push(...nested.problems);
      if (nested.approximated) {
        problems.push({ kind: 'normalised', detail: `"${holder}"-wrapped keyframe unwrapped into a Bedrock channel value` });
      }
      return { value: nested.value, problems, approximated: true, ...easing };
    }
  }
  if (raw.x !== undefined || raw.y !== undefined || raw.z !== undefined) {
    const vector = normaliseVector(
      [raw.x ?? IDENTITY[channel], raw.y ?? IDENTITY[channel], raw.z ?? IDENTITY[channel]],
      channel,
      problems,
    );
    problems.push({ kind: 'normalised', detail: 'x/y/z keyframe converted into a Bedrock component vector' });
    return { value: vector, problems, approximated: true, ...easing };
  }
  if (raw.pre !== undefined || raw.post !== undefined) {
    const post = normaliseKeyframe(raw.post ?? raw.pre, channel);
    const pre = normaliseKeyframe(raw.pre ?? raw.post, channel);
    problems.push(...post.problems, ...pre.problems);
    const rawLerp = raw.lerp_mode ??
      (String(raw.interpolation ?? '').toLowerCase() === 'catmullrom' ? raw.interpolation : undefined) ??
      (String(raw.easing ?? '').toLowerCase() === 'catmullrom' ? 'catmullrom' : undefined);
    const lerp = normaliseLerpMode(rawLerp, problems);
    const sameValue = JSON.stringify(pre.value) === JSON.stringify(post.value);
    const approximated = post.approximated || pre.approximated || problems.some((p) => p.kind === 'normalised');
    // A keyframe whose pre/post are identical only needs the array form unless the source
    // asked for a specific interpolation curve.
    if (sameValue && lerp === 'linear') return { value: post.value, problems, approximated, ...easing };
    return { value: { pre: pre.value, post: post.value, lerp_mode: lerp }, problems, approximated, ...easing };
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
  return ['pre', 'post', 'vector', 'value', 'values', 'vec', 'offset', 'lerp_mode', 'easing', 'easing_args', 'easingArgs', 'easingType', 'easing_type', 'ease', 'interpolation', 'x', 'y', 'z'].some(
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
        raw: record,
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


/** GeckoLib 5 built-in easing functions, sampled into linear Bedrock keyframes. */
function geckoEase(name: string, progress: number, args: number[] = []): number | null {
  const key = name.toLowerCase().replace(/[-_\s]/g, '');
  const t = Math.max(0, Math.min(1, progress));
  const arg = args[0];
  const easeIn = (kind: string, value: number): number => {
    switch (kind) {
      case 'sine': return 1 - Math.cos(value * Math.PI / 2);
      case 'quad': return value * value;
      case 'cubic': return value * value * value;
      case 'quart': return Math.pow(value, 4);
      case 'quint': return Math.pow(value, 5);
      case 'expo': return Math.pow(2, 10 * (value - 1));
      case 'circ': return 1 - Math.sqrt(Math.max(0, 1 - value * value));
      case 'back': {
        const scale = arg === undefined ? 1.70158 : arg * 1.70158;
        return value * value * ((scale + 1) * value - scale);
      }
      case 'elastic': {
        const bounciness = arg === undefined ? 1 : arg;
        return 1 - Math.pow(Math.cos(value * Math.PI / 2), 3) * Math.cos(value * bounciness * Math.PI);
      }
      case 'bounce': {
        const b = arg === undefined ? 0.5 : arg;
        const one = (x: number) => (121 / 16) * x * x;
        const two = (x: number) => (121 / 4) * b * Math.pow(x - 6 / 11, 2) + 1 - b;
        const three = (x: number) => 121 * b * b * Math.pow(x - 9 / 11, 2) + 1 - b * b;
        const four = (x: number) => 484 * b * b * b * Math.pow(x - 10.5 / 11, 2) + 1 - b * b * b;
        return Math.min(one(value), two(value), three(value), four(value));
      }
      default: return NaN;
    }
  };
  if (key === 'linear' || key === 'none') return t;
  if (key === 'constant') return t >= 1 ? 1 : 0;
  if (key === 'step') {
    const steps = arg === undefined ? 2 : Math.floor(arg);
    if (steps < 2) return null;
    return t >= 1 ? 1 : Math.floor(t * steps) / steps;
  }
  const match = /^(?:ease)?(inout|in|out)(sine|quad|cubic|quart|quint|expo|circ|back|elastic|bounce)$/.exec(key);
  if (!match) return null;
  const mode = match[1];
  const kind = match[2];
  if (mode === 'in') return easeIn(kind, t);
  if (mode === 'out') return 1 - easeIn(kind, 1 - t);
  if (t < 0.5) return easeIn(kind, t * 2) / 2;
  return 1 - easeIn(kind, (1 - t) * 2) / 2;
}

function numericVector(value: KeyframeValue, channel: BedrockChannel): number[] | null {
  let raw: unknown = value;
  if (isPlainObject(raw)) raw = raw.post ?? raw.pre ?? raw.vector ?? raw.value;
  if (typeof raw === 'number') return [raw, raw, raw];
  if (!Array.isArray(raw)) return null;
  const values = raw.flat(Infinity as never).slice(0, 3);
  if (values.length === 0 || values.some((part) => typeof part !== 'number' || !Number.isFinite(part))) return null;
  if (values.length === 1) return [values[0] as number, values[0] as number, values[0] as number];
  if (values.length === 2) return [values[0] as number, values[1] as number, IDENTITY[channel]];
  return values as number[];
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

  const shaped: Array<{ time: number; value: KeyframeValue; easing?: string; easingArgs?: number[]; easingArgsInvalid?: boolean }> = [];
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
    shaped.push({ time: entry.time, value: keyframe.value, easing: keyframe.easing, easingArgs: keyframe.easingArgs, easingArgsInvalid: keyframe.easingArgsInvalid });
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
  const originalTimes = new Set(shaped.map((entry) => formatSeconds(entry.time)));
  const constantTransitions = new Map<string, unknown>();
  const sampleStep = 1 / 20; // GeckoLib evaluates animation state on Minecraft's 20 TPS clock.

  for (let index = 1; index < shaped.length; index += 1) {
    const current = shaped[index];
    if (!current.easing || ['linear', 'none'].includes(current.easing.toLowerCase())) continue;
    const previous = shaped[index - 1];
    if (current.easingArgsInvalid) {
      problems.push({
        kind: 'unsupported',
        detail: `GeckoLib easing "${current.easing}" has non-literal easing arguments; its source expressions were retained in diagnostics but cannot be evaluated during conversion`,
      });
      approximated = true;
      continue;
    }
    const from = numericVector(previous.value, channel);
    const to = numericVector(current.value, channel);
    if (!from || !to) {
      problems.push({
        kind: 'unsupported',
        detail: `GeckoLib easing "${current.easing}" could not be baked because one or both endpoint vectors contain dynamic Molang expressions; the original endpoints were retained`,
      });
      approximated = true;
      continue;
    }
    const duration = current.time - previous.time;
    if (!(duration > 0)) continue;
    if (current.easing.toLowerCase() === 'constant') {
      constantTransitions.set(formatSeconds(current.time), { pre: from, post: to, lerp_mode: 'linear' });
      problems.push({ kind: 'normalised', detail: 'constant easing was represented as an exact Bedrock pre/post discontinuity' });
      approximated = true;
      continue;
    }
    let recognized = true;
    for (let time = previous.time + sampleStep; time < current.time - 0.000001; time += sampleStep) {
      const easingProgress = Math.max(0, Math.min(1, Math.round(((time - previous.time) / duration) * 1e9) / 1e9));
      const eased = geckoEase(current.easing, easingProgress, current.easingArgs ?? []);
      if (eased === null || !Number.isFinite(eased)) {
        recognized = false;
        break;
      }
      const timeKey = formatSeconds(time);
      if (originalTimes.has(timeKey)) continue;
      keyframeMap[timeKey] = from.map((value, axis) => value + (to[axis] - value) * eased);
    }
    if (!recognized) {
      problems.push({
        kind: 'unsupported',
        detail: `GeckoLib easing "${current.easing}" is custom or has invalid arguments; its Java easing function must be recovered from the mod source, so only its endpoints were retained`,
      });
      approximated = true;
      continue;
    }
    problems.push({
      kind: 'normalised',
      detail: `GeckoLib easing "${current.easing}" was baked into linear Bedrock keyframes at 20 samples per second`,
    });
    approximated = true;
  }

  for (const entry of shaped) keyframeMap[formatSeconds(entry.time)] = entry.value;
  for (const [time, value] of constantTransitions) keyframeMap[time] = value;

  return {
    channel,
    ok: problems.length === 0,
    value: keyframeMap,
    keyframeCount: Object.keys(keyframeMap).length,
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