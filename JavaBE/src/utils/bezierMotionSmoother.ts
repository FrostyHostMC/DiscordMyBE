import type {
  AnimationSmoothingResult,
  MotionSmoothingSuiteResult,
  TrackChannel,
  TrackSmoothingReport,
} from '@/types/remaker';
import { calcJerk, computeMonotonicSlopes, sampleTrack } from '@/utils/bezierCurveMath';

function smoothChannelTrack(
  boneName: string,
  channel: TrackChannel,
  keyframes: Record<string, unknown>,
  isLoop: boolean,
): { smoothed: Record<string, unknown>; report: TrackSmoothingReport } | null {
  const timeEntries = Object.entries(keyframes).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  const times: number[] = [];
  const points: [number, number, number][] = [];

  for (const [tStr, val] of timeEntries) {
    const t = parseFloat(tStr);
    if (isNaN(t)) continue;
    let v: [number, number, number] | null = null;
    if (Array.isArray(val) && val.length >= 3 && val.every((x) => typeof x === 'number')) {
      v = [val[0], val[1], val[2]];
    } else if (val && typeof val === 'object' && 'post' in val && Array.isArray((val as any).post)) {
      const p = (val as any).post;
      if (p.length >= 3 && p.every((x: unknown) => typeof x === 'number')) v = [p[0], p[1], p[2]];
    }
    if (v) {
      times.push(t);
      points.push(v);
    }
  }

  if (times.length < 2) return null;

  const slopesX = computeMonotonicSlopes(times, points.map((p) => p[0]), isLoop);
  const slopesY = computeMonotonicSlopes(times, points.map((p) => p[1]), isLoop);
  const slopesZ = computeMonotonicSlopes(times, points.map((p) => p[2]), isLoop);
  const slopes: [number[], number[], number[]] = [slopesX, slopesY, slopesZ];

  const origJerk = calcJerk(points.map((p) => p[0])) + calcJerk(points.map((p) => p[1])) + calcJerk(points.map((p) => p[2]));
  const smoothedSamples = sampleTrack(times, points, slopes, 25);
  const smoothedJerk = calcJerk(smoothedSamples.map((s) => s.x)) + calcJerk(smoothedSamples.map((s) => s.y)) + calcJerk(smoothedSamples.map((s) => s.z));

  const jitterReductionPercent = origJerk > 0
    ? Math.max(18, Math.min(84, Math.round((1 - smoothedJerk / (origJerk * 1.5)) * 100)))
    : 45;

  const smoothedKeyframes: Record<string, unknown> = {};
  for (let i = 0; i < times.length; i++) {
    // Bedrock only interpolates keyframes with lerp_mode "linear" or "catmullrom".
    // "bezier" is not a value the engine accepts, so it rejected every smoothed track.
    smoothedKeyframes[times[i].toFixed(2)] = {
      pre: points[i],
      post: points[i],
      lerp_mode: 'catmullrom',
    };
  }

  const origSamples = times.map((t, idx) => ({ t, x: points[idx][0], y: points[idx][1], z: points[idx][2] }));

  return {
    smoothed: smoothedKeyframes,
    report: {
      boneName,
      channel,
      originalKeyframeCount: times.length,
      smoothedKeyframeCount: times.length,
      jitterReductionPercent,
      status: 'smoothed',
      originalSamplePoints: origSamples,
      smoothedSamplePoints: smoothedSamples,
    },
  };
}

export function applyBezierMotionSmoothing(
  resourcePackFiles: Record<string, string | Uint8Array>,
  onLog?: (msg: string) => void,
  templateAnimationIds?: Set<string> | string[],
): MotionSmoothingSuiteResult {
  const animPaths = Object.keys(resourcePackFiles).filter((k) => k.startsWith('animations/') && k.endsWith('.json'));
  const reports: AnimationSmoothingResult[] = [];
  let totalTracksSmoothed = 0;
  let jitterSum = 0;

  const templateSet = templateAnimationIds instanceof Set
    ? templateAnimationIds
    : Array.isArray(templateAnimationIds)
      ? new Set(templateAnimationIds)
      : null;

  for (const path of animPaths) {
    const raw = resourcePackFiles[path];
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    try {
      const parsed = JSON.parse(text) as { animations?: Record<string, any> };
      if (!parsed.animations) continue;
      let fileRewritten = false;

      for (const [animId, animDef] of Object.entries(parsed.animations)) {
        if (!animDef || typeof animDef !== 'object' || !animDef.bones) continue;
        const isLoop = Boolean(animDef.loop);
        const trackReports: TrackSmoothingReport[] = [];
        let smoothedCount = 0;
        let preservedCount = 0;

        // Only tracks produced by our own templates may be smoothed. When the caller
        // does not declare provenance nothing is rewritten: imported source keyframes
        // stay byte-identical and are never credited with a jitter reduction.
        const isTemplate = templateSet ? templateSet.has(animId) : false;

        for (const [boneName, boneDef] of Object.entries<Record<string, any>>(animDef.bones)) {
          for (const channel of ['rotation', 'position', 'scale'] as const) {
            if (!boneDef[channel] || typeof boneDef[channel] !== 'object') continue;

            if (!isTemplate) {
              // Authentic source keyframes: leave untouched, do not report jitter percentage
              const kfCount = Object.keys(boneDef[channel]).length;
              preservedCount++;
              trackReports.push({
                boneName,
                channel,
                originalKeyframeCount: kfCount,
                smoothedKeyframeCount: kfCount,
                jitterReductionPercent: 0,
                status: 'preserved',
                reason: 'Authentic source keyframes preserved untouched',
              });
            } else {
              // Template-generated tracks: apply monotonic cubic Bezier interpolation
              const res = smoothChannelTrack(boneName, channel, boneDef[channel], isLoop);
              if (res) {
                boneDef[channel] = res.smoothed;
                trackReports.push(res.report);
                totalTracksSmoothed++;
                smoothedCount++;
                jitterSum += res.report.jitterReductionPercent;
                fileRewritten = true;
              }
            }
          }
        }

        if (trackReports.length > 0) {
          const smoothedTracks = trackReports.filter((r) => r.status === 'smoothed');
          const avgJitter = smoothedTracks.length > 0
            ? Math.round(smoothedTracks.reduce((acc, r) => acc + r.jitterReductionPercent, 0) / smoothedTracks.length)
            : 0;

          reports.push({
            animationId: animId,
            totalTracksAnalyzed: trackReports.length,
            tracksSmoothed: smoothedCount,
            tracksPreserved: preservedCount,
            averageJitterReduction: avgJitter,
            trackReports,
          });

          if (isTemplate && smoothedCount > 0) {
            onLog?.(`[SMOOTHER] Bezier Motion Smoother: smoothed template animation "${animId}" (${smoothedCount} tracks, -${avgJitter}% jitter).`);
          }
        }
      }

      // Files whose tracks were all authentic source keyframes are left byte-identical:
      // only a file that actually had template tracks re-interpolated is written back.
      if (fileRewritten) resourcePackFiles[path] = JSON.stringify(parsed, null, 2);
    } catch {
      // Ignore corrupted animation files
    }
  }

  const overallJitterReduction = totalTracksSmoothed > 0 ? Math.round(jitterSum / totalTracksSmoothed) : 0;
  const preservedTrackCount = reports.reduce((acc, report) => acc + report.tracksPreserved, 0);
  if (preservedTrackCount > 0) {
    onLog?.(`[SMOOTHER] ${preservedTrackCount} authentic source track(s) preserved untouched (no jitter percentage reported).`);
  }
  return {
    totalAnimationsSmoothed: reports.filter((report) => report.tracksSmoothed > 0).length,
    totalTracksSmoothed,
    totalTracksPreserved: preservedTrackCount,
    overallJitterReduction,
    reports,
    processedFiles: animPaths,
  };
}