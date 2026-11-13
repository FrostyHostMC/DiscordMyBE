import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Activity } from 'lucide-react';
import type { TrajectoryPoint } from '@/types/remaker';

interface Props {
  originalPoints: TrajectoryPoint[];
  smoothedPoints: TrajectoryPoint[];
  jitterReductionPercent: number;
  axis?: 'x' | 'y' | 'z';
}

export function MotionSmoothingGraph({
  originalPoints,
  smoothedPoints,
  jitterReductionPercent,
  axis = 'x',
}: Props) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 1 ? 0 : prev + 0.02));
    }, 40);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const allValues = [...originalPoints, ...smoothedPoints].map((p) => p[axis]);
  const minVal = Math.min(...allValues, -10);
  const maxVal = Math.max(...allValues, 10);
  const range = Math.max(1, maxVal - minVal);

  const tMin = originalPoints[0]?.t ?? 0;
  const tMax = originalPoints[originalPoints.length - 1]?.t ?? 1;
  const tRange = Math.max(0.01, tMax - tMin);

  const toCoords = (p: TrajectoryPoint) => {
    const x = 20 + ((p.t - tMin) / tRange) * 280;
    const y = 140 - ((p[axis] - minVal) / range) * 110;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const origPoly = originalPoints.map(toCoords).join(' ');
  const smoothPoly = smoothedPoints.map(toCoords).join(' ');

  const currentT = tMin + progress * tRange;
  const currentSmoothIdx = Math.min(
    smoothedPoints.length - 1,
    Math.max(0, Math.floor(progress * (smoothedPoints.length - 1))),
  );
  const currentVal = smoothedPoints[currentSmoothIdx]?.[axis] ?? 0;
  const cursorX = (20 + progress * 280).toFixed(1);
  const cursorY = (140 - ((currentVal - minVal) / range) * 110).toFixed(1);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/90 p-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-cyan-400" />
          <span className="font-bold text-slate-200">Curve Interpolation ({axis.toUpperCase()}-axis)</span>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300">
          -{jitterReductionPercent}% Jitter Reduction
        </span>
      </div>

      <div className="relative h-40 w-full overflow-hidden rounded-lg border border-slate-800/80 bg-slate-900/60 p-1">
        <svg viewBox="0 0 320 160" className="h-full w-full">
          <line x1="20" y1="140" x2="300" y2="140" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="20" y1="30" x2="300" y2="30" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="20" y1="85" x2="300" y2="85" stroke="#1e293b" strokeWidth="1" />

          {/* Original Linear Jitter Path (Red/Orange dashed) */}
          <polyline points={origPoly} fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />
          {originalPoints.map((p, i) => {
            const [cx, cy] = toCoords(p).split(',');
            return <circle key={`orig-${i}`} cx={cx} cy={cy} r="2.5" fill="#f43f5e" />;
          })}

          {/* Smoothed Cubic Bezier Path (Cyan/Emerald solid) */}
          <polyline points={smoothPoly} fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" />

          {/* Real-time playback cursor */}
          <line x1={cursorX} y1="20" x2={cursorX} y2="150" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={cursorX} cy={cursorY} r="4.5" fill="#38bdf8" className="animate-pulse" />
        </svg>

        <div className="absolute bottom-2 left-3 flex gap-3 text-[10px]">
          <span className="flex items-center gap-1 font-semibold text-rose-400">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Original Linear (Jittery)
          </span>
          <span className="flex items-center gap-1 font-semibold text-cyan-400">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" /> Smoothed Bezier (Jitter-Free)
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className="flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-200 active:scale-95"
          >
            {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => setProgress(0)}
            className="flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 active:scale-95"
            title="Rewind"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300">
          <span>Time: {currentT.toFixed(2)}s</span>
          <span className="text-cyan-400">Val: {currentVal.toFixed(1)}°</span>
        </div>
      </div>
    </div>
  );
}