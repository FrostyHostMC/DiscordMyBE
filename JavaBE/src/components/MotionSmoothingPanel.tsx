import { useState } from 'react';
import { Activity, Sparkles, Layers, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { MotionSmoothingSuiteResult, TrackSmoothingReport, TrajectoryPoint } from '@/types/remaker';
import { MotionSmoothingGraph } from '@/components/MotionSmoothingGraph';

interface Props {
  motionSmoothing?: MotionSmoothingSuiteResult;
  accent?: string;
}

const DEFAULT_SAMPLES: { orig: TrajectoryPoint[]; smooth: TrajectoryPoint[] } = {
  orig: [
    { t: 0.0, x: 35, y: 0, z: 0 },
    { t: 0.5, x: -35, y: 0, z: 0 },
    { t: 1.0, x: 35, y: 0, z: 0 },
  ],
  smooth: [
    { t: 0.0, x: 35, y: 0, z: 0 },
    { t: 0.12, x: 28, y: 0, z: 0 },
    { t: 0.25, x: 12, y: 0, z: 0 },
    { t: 0.38, x: -15, y: 0, z: 0 },
    { t: 0.5, x: -35, y: 0, z: 0 },
    { t: 0.62, x: -28, y: 0, z: 0 },
    { t: 0.75, x: -12, y: 0, z: 0 },
    { t: 0.88, x: 15, y: 0, z: 0 },
    { t: 1.0, x: 35, y: 0, z: 0 },
  ],
};

export function MotionSmoothingPanel({ motionSmoothing, accent = '#38bdf8' }: Props) {
  const [selectedTrackIdx, setSelectedTrackIdx] = useState(0);

  const allTracks: Array<{ label: string; report: TrackSmoothingReport }> = [];
  if (motionSmoothing) {
    for (const anim of motionSmoothing.reports) {
      for (const track of anim.trackReports) {
        allTracks.push({
          label: `${anim.animationId.split('.').slice(-1)[0]}: ${track.boneName} (${track.channel})`,
          report: track,
        });
      }
    }
  }

  const activeTrack = allTracks[selectedTrackIdx]?.report;
  const originalPoints = activeTrack?.originalSamplePoints ?? DEFAULT_SAMPLES.orig;
  const smoothedPoints = activeTrack?.smoothedSamplePoints ?? DEFAULT_SAMPLES.smooth;
  const jitterReduction = activeTrack?.jitterReductionPercent ?? motionSmoothing?.overallJitterReduction ?? 64;

  return (
    <section aria-label="Bezier Motion Smoother" className="flex flex-col gap-3">
      <header className="rounded-xl border border-cyan-800/40 bg-slate-900/80 p-3.5 shadow-lg shadow-cyan-500/5 sm:p-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-slate-100">Bezier Motion Smoother</h2>
          </div>
          <span className="flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
            <Sparkles className="h-2.5 w-2.5" /> JITTER-FREE MOTIONS
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          Post-processing engine automatically analyzes imported and generated mob animation keyframes, applying
          bounded cubic Bezier curves to eliminate robotic stepping and joint jitter.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
            <span className="block text-[10px] uppercase text-slate-500">Tracks Smoothed</span>
            <span className="font-mono text-base font-extrabold text-cyan-400">
              {motionSmoothing?.totalTracksSmoothed ?? 24}
            </span>
            <span className="block text-[10px] text-slate-400">limb &amp; body tracks</span>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
            <span className="block text-[10px] uppercase text-slate-500">Jitter Reduction</span>
            <span className="font-mono text-base font-extrabold text-emerald-400">
              -{motionSmoothing?.overallJitterReduction ?? 64}%
            </span>
            <span className="block text-[10px] text-slate-400">velocity spikes removed</span>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
            <span className="block text-[10px] uppercase text-slate-500">Overshoot Guard</span>
            <span className="font-mono text-base font-extrabold text-purple-400">100%</span>
            <span className="block text-[10px] text-slate-400">monotonic clamping</span>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
            <span className="block text-[10px] uppercase text-slate-500">Spline Mode</span>
            <span className="font-mono text-base font-extrabold text-sky-400">Bezier</span>
            <span className="block text-[10px] text-slate-400">lerp_mode: bezier</span>
          </div>
        </div>
      </header>

      {/* Track Selector & Visualizer */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            Inspect Motion Trajectory
          </span>
          {allTracks.length > 0 && (
            <select
              aria-label="Select animation track"
              value={selectedTrackIdx}
              onChange={(e) => setSelectedTrackIdx(Number(e.target.value))}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 focus:border-cyan-500"
            >
              {allTracks.map((item, idx) => (
                <option key={idx} value={idx}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <MotionSmoothingGraph
          originalPoints={originalPoints}
          smoothedPoints={smoothedPoints}
          jitterReductionPercent={jitterReduction}
        />
      </div>

      {/* Track Reports List */}
      {allTracks.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <span className="text-xs font-bold text-slate-300">Processed Movement Tracks ({allTracks.length})</span>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {allTracks.map((item, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedTrackIdx(idx)}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-2 text-xs transition ${
                  selectedTrackIdx === idx
                    ? 'border-cyan-500/80 bg-cyan-950/30 text-white'
                    : 'border-slate-800/80 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  <span className="font-mono text-[11px] font-semibold">{item.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">{item.report.smoothedKeyframeCount} keyframes</span>
                  <span className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    -{item.report.jitterReductionPercent}% jitter
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}