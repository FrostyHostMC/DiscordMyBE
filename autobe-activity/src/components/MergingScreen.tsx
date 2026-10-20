import assetsData from '@/config/assets';
import React from 'react';

interface MergingScreenProps {
  currentStep: string;
  progress: number;
  packCount: number;
}

/** Ordered thresholds that match the progress values emitted by mergeEngine. */
const STEPS: Array<{ label: string; threshold: number }> = [
  { label: 'Reading addons', threshold: 10 },
  { label: 'Processing resource packs', threshold: 30 },
  { label: 'Processing behavior packs', threshold: 45 },
  { label: 'Splitting by script API version', threshold: 55 },
  { label: 'Resolving conflicts', threshold: 70 },
  { label: 'Building final pack', threshold: 85 },
  { label: 'Finalizing', threshold: 100 }
];

export const MergingScreen: React.FC<MergingScreenProps> = ({
  currentStep,
  progress,
  packCount
}) => {
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-6 pt-6 pb-12 justify-between">
      {/* Top Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-white tracking-wide">Merging Packs</h1>
      </div>

      {/* Center Animated Visual */}
      <div className="flex flex-col items-center justify-center my-auto">
        <div className="flex items-center justify-center gap-4 mb-3">
          <div className="relative w-14 h-14 rounded-2xl bg-[#140D2B] border border-purple-500/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(168,85,247,0.3)] animate-pulse">
            📦
            <span className="absolute -bottom-1 -right-1 text-[9px] font-bold px-1 rounded bg-purple-900 border border-purple-500 text-purple-200">
              BP
            </span>
          </div>

          <span className="text-xl font-bold text-purple-400">+</span>

          <div className="relative w-14 h-14 rounded-2xl bg-[#140D2B] border border-purple-500/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(168,85,247,0.3)] animate-pulse">
            🎨
            <span className="absolute -bottom-1 -right-1 text-[9px] font-bold px-1 rounded bg-indigo-900 border border-indigo-500 text-indigo-200">
              RP
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center my-1 text-purple-400 animate-bounce">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>

        <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-purple-700 to-indigo-900 border-2 border-purple-400 flex items-center justify-center text-3xl shadow-[0_0_35px_rgba(168,85,247,0.6)]">
          <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center p-1">
            <img
              src={assetsData.IMAGE_DNFM}
              alt="StoneByte Merged Pack"
              className="w-full h-full object-contain animate-spin"
              style={{ animationDuration: '10s' }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = assetsData.IMAGE_DNFM_FALLBACK;
              }}
            />
          </div>
        </div>

        <p className="text-xs text-purple-300 font-medium mt-3 text-center">
          Combining {packCount} selected addon{packCount === 1 ? '' : 's'} into a single .mcaddon
        </p>
      </div>

      {/* Checklist items */}
      <div className="w-full space-y-3 px-2 mb-4">
        {STEPS.map((st, i) => {
          const prevThreshold = i === 0 ? 0 : STEPS[i - 1].threshold;
          const isDone = clamped >= st.threshold;
          const isCurrent = !isDone && clamped >= prevThreshold;
          return (
            <div key={st.label} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                    isDone
                      ? 'bg-purple-600 border-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.6)] text-white'
                      : isCurrent
                      ? 'border-purple-400 bg-purple-950/40 animate-pulse text-purple-300'
                      : 'border-zinc-700 bg-zinc-900/40 text-transparent'
                  }`}
                >
                  {isDone ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="w-2 h-2 rounded-full bg-purple-400" />
                  ) : null}
                </div>
                <span
                  className={
                    isDone
                      ? 'text-white font-medium'
                      : isCurrent
                      ? 'text-purple-300 font-semibold'
                      : 'text-zinc-500'
                  }
                >
                  {st.label}
                </span>
              </div>

              <span className="font-mono text-[11px] text-zinc-400">
                {isDone ? 'done' : isCurrent ? `${Math.round(clamped)}%` : 'pending'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Overall Progress Bar */}
      <div className="w-full space-y-2">
        <div className="w-full h-2.5 bg-purple-950/60 rounded-full border border-purple-500/30 overflow-hidden p-0.5 shadow-[0_0_12px_rgba(147,51,234,0.3)]">
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-400 to-purple-300 rounded-full transition-all duration-300"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-purple-300/80 font-mono">
          <span className="truncate">{currentStep}</span>
          <span className="font-bold text-white ml-2">{Math.round(clamped)}%</span>
        </div>
      </div>
    </div>
  );
};