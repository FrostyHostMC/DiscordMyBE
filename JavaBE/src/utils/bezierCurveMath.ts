import type { TrajectoryPoint } from '@/types/remaker';

export function evalBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function calcJerk(values: number[]): number {
  if (values.length < 3) return 0;
  let total = 0;
  for (let i = 1; i < values.length - 1; i++) {
    total += Math.abs(values[i + 1] - 2 * values[i] + values[i - 1]);
  }
  return total;
}

export function computeMonotonicSlopes(times: number[], values: number[], loop: boolean): number[] {
  const n = values.length;
  if (n <= 1) return [0];
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dt = Math.max(0.0001, times[i + 1] - times[i]);
    secants.push((values[i + 1] - values[i]) / dt);
  }
  const slopes = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const s0 = secants[i - 1];
    const s1 = secants[i];
    if (s0 * s1 <= 0) {
      slopes[i] = 0;
    } else {
      slopes[i] = (2 * s0 * s1) / (s0 + s1);
    }
  }
  if (loop && Math.abs(values[0] - values[n - 1]) < 0.01) {
    const s0 = secants[secants.length - 1];
    const s1 = secants[0];
    const wrap = s0 * s1 <= 0 ? 0 : (2 * s0 * s1) / (s0 + s1);
    slopes[0] = wrap;
    slopes[n - 1] = wrap;
  } else {
    slopes[0] = secants[0] ?? 0;
    slopes[n - 1] = secants[secants.length - 1] ?? 0;
  }
  return slopes;
}

export function sampleTrack(
  times: number[],
  points: [number, number, number][],
  slopes: [number[], number[], number[]],
  count = 25,
): TrajectoryPoint[] {
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const dt = (tMax - tMin) / Math.max(1, count - 1);
  const out: TrajectoryPoint[] = [];

  for (let step = 0; step < count; step++) {
    const t = step === count - 1 ? tMax : tMin + step * dt;
    let idx = times.findIndex((time, i) => i < times.length - 1 && t >= time && t <= times[i + 1]);
    if (idx === -1) idx = Math.max(0, times.length - 2);

    const span = Math.max(0.0001, times[idx + 1] - times[idx]);
    const u = Math.min(1, Math.max(0, (t - times[idx]) / span));

    const evalAxis = (axis: 0 | 1 | 2) => {
      const p0 = points[idx][axis];
      const p3 = points[idx + 1][axis];
      const c1 = p0 + (slopes[axis][idx] * span) / 3;
      const c2 = p3 - (slopes[axis][idx + 1] * span) / 3;
      return Number(evalBezier(p0, c1, c2, p3, u).toFixed(2));
    };

    out.push({ t: Number(t.toFixed(2)), x: evalAxis(0), y: evalAxis(1), z: evalAxis(2) });
  }
  return out;
}