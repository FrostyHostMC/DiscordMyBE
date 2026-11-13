/**
 * Keyframe arithmetic shared by the skeleton reconstruction stage.
 *
 * A source skeleton is frequently finer than the rig the destination renders: a mod animates
 * `left_lower_arm`, `left_hand` and `left_thumb` while the Bedrock player rig only declares
 * `left_arm`. Renaming those tracks onto `left_arm` would let the last one overwrite the first,
 * which is a silent loss of motion. The correct operation is a *hierarchy collapse*: the child
 * transform is composed onto its resolved ancestor, exactly like FK accumulation in a rig.
 *
 * That requires real keyframe arithmetic — union of key times, interpolation of both curves at
 * every time, component-wise composition — which is what this module provides. Everything here
 * is format-agnostic: a channel may be a constant vector, a keyframe map, or a `pre`/`post`
 * easing object, and any channel that cannot be read arithmetically is reported instead of
 * being approximated blindly.
 */

export interface SampledKeyframe {
  time: number;
  value: number[];
}

export const ANIMATION_CHANNELS = ['rotation', 'position', 'scale'] as const;
export type AnimationChannelName = (typeof ANIMATION_CHANNELS)[number];

function toNumbers(raw: unknown): number[] | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw];
  if (Array.isArray(raw) && raw.length > 0 && raw.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return raw as number[];
  }
  return null;
}

function toTime(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads one Bedrock channel into sampled keyframes. Returns null for an expression channel
 * (Molang string) or any shape whose arithmetic meaning is not knowable — the caller then keeps
 * the original channel untouched rather than inventing a curve.
 */
export function readChannel(channel: unknown): SampledKeyframe[] | null {
  const constant = toNumbers(channel);
  if (constant) return [{ time: 0, value: constant }];
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return null;
  const record = channel as Record<string, unknown>;
  if ('post' in record || 'pre' in record) return readChannel(record.post ?? record.pre);
  const frames: SampledKeyframe[] = [];
  for (const [key, value] of Object.entries(record)) {
    const time = toTime(key);
    if (time === null) return null;
    const numbers = toNumbers(value);
    if (numbers) {
      frames.push({ time, value: numbers });
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const eased = toNumbers(nested.post ?? nested.pre);
      if (eased) {
        frames.push({ time, value: eased });
        continue;
      }
    }
    return null;
  }
  if (frames.length === 0) return null;
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

function round(value: number): number {
  return Math.round(value * 100000) / 100000;
}

/** Linear sample of a channel at one time. Values are padded with 0 when lengths differ. */
export function sampleChannel(frames: SampledKeyframe[], time: number): number[] {
  if (frames.length === 0) return [];
  if (frames.length === 1) return frames[0].value;
  if (time <= frames[0].time) return frames[0].value;
  const last = frames[frames.length - 1];
  if (time >= last.time) return last.value;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const next = frames[index];
    if (time > next.time) continue;
    const span = next.time - previous.time;
    const ratio = span <= 0 ? 0 : (time - previous.time) / span;
    const length = Math.max(previous.value.length, next.value.length);
    const sampled: number[] = [];
    for (let component = 0; component < length; component += 1) {
      const from = previous.value[component] ?? 0;
      const to = next.value[component] ?? 0;
      sampled.push(from + (to - from) * ratio);
    }
    return sampled;
  }
  return last.value;
}

function formatTime(time: number): string {
  const rounded = Math.round(time * 1000) / 1000;
  return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
}

/** Writes sampled keyframes back into the Bedrock channel shape. */
export function writeChannel(frames: SampledKeyframe[]): unknown {
  if (frames.length === 0) return undefined;
  if (frames.length === 1) return frames[0].value.map(round);
  const output: Record<string, number[]> = {};
  for (const frame of frames) output[formatTime(frame.time)] = frame.value.map(round);
  return output;
}

/**
 * Composes two channels additively (FK accumulation): the union of both key times is sampled on
 * both curves and summed. Returns null when either side is not arithmetic, so the caller can
 * report the channel it kept instead of silently dropping a track.
 */
export function composeChannels(base: unknown, extra: unknown): unknown | null {
  const baseFrames = readChannel(base);
  const extraFrames = readChannel(extra);
  if (!baseFrames || !extraFrames) return null;
  const times = [...new Set([...baseFrames.map((frame) => frame.time), ...extraFrames.map((frame) => frame.time)])].sort(
    (a, b) => a - b,
  );
  const composed: SampledKeyframe[] = times.map((time) => {
    const left = sampleChannel(baseFrames, time);
    const right = sampleChannel(extraFrames, time);
    const length = Math.max(left.length, right.length);
    const value: number[] = [];
    for (let component = 0; component < length; component += 1) {
      value.push((left[component] ?? 0) + (right[component] ?? 0));
    }
    return { time, value };
  });
  return writeChannel(composed) ?? base;
}

export interface TrackComposition {
  track: Record<string, unknown>;
  composed: AnimationChannelName[];
  kept: AnimationChannelName[];
}

/**
 * Merges one bone track into another. Channels both sides declare are composed; a channel only
 * the incoming track declares is carried over; a channel that cannot be composed keeps the base
 * value and is listed in `kept` so the loss is visible in the report.
 */
export function composeTracks(base: unknown, extra: unknown): TrackComposition {
  const baseTrack = base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};
  const extraTrack = extra && typeof extra === 'object' && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {};
  const composed: AnimationChannelName[] = [];
  const kept: AnimationChannelName[] = [];

  for (const channel of ANIMATION_CHANNELS) {
    const incoming = extraTrack[channel];
    if (incoming === undefined) continue;
    const existing = baseTrack[channel];
    if (existing === undefined) {
      baseTrack[channel] = incoming;
      continue;
    }
    const merged = composeChannels(existing, incoming);
    if (merged === null) {
      kept.push(channel);
      continue;
    }
    baseTrack[channel] = merged;
    composed.push(channel);
  }

  return { track: baseTrack, composed, kept };
}