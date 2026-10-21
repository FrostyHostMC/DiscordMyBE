import React, { useState, useEffect } from 'react';
import {
  Layers,
  ScrollText,
  Palette,
  Loader2,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface MergingScreenProps {
  currentStep: string;
  progress: number;
  packCount: number;
  onCancel?: () => void;
}

export const MergingScreen: React.FC<MergingScreenProps> = ({
  currentStep,
  progress,
  packCount,
  onCancel
}) => {
  // Elapsed time counter
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const steps = [
    { label: 'Reading addons & validating manifests', threshold: 10 },
    { label: 'Processing resource packs', threshold: 30 },
    { label: 'Processing behavior packs', threshold: 45 },
    { label: 'Splitting by script API version', threshold: 55 },
    { label: 'Resolving identifier conflicts', threshold: 70 },
    { label: 'Building final pack structure', threshold: 85 },
    { label: 'Finalizing consolidated outputs', threshold: 100 }
  ];

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none px-4 sm:px-6 pt-6 pb-10 justify-between max-w-xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-[#30263F]/70 pb-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-5 h-5 text-[#A855F7]" />
          <div>
            <h1 className="text-base font-bold text-white">Merging Addon Packs</h1>
            <p className="text-[11px] text-[#AAA3BB]">
              Consolidating {packCount} addon{packCount !== 1 ? 's' : ''} into Bedrock packs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#15111F] border border-[#30263F] text-xs font-mono text-[#AAA3BB]">
          <Clock className="w-3.5 h-3.5 text-[#A855F7]" />
          <span>{formatTimer(elapsedSeconds)}</span>
        </div>
      </div>

      {/* Center Merging Animation */}
      <div className="my-auto flex flex-col items-center justify-center text-center py-6">
        {/* Animated Visual Merging Nodes */}
        <div className="relative flex items-center justify-center gap-3 sm:gap-5 mb-5">
          {/* BP Node */}
          <div className="w-14 h-14 rounded-2xl bg-[#15111F] border border-[#30263F] flex flex-col items-center justify-center shadow-[0_0_20px_rgba(118,43,255,0.2)]">
            <ScrollText className="w-5 h-5 text-amber-400" />
            <span className="text-[9px] font-mono font-bold text-amber-300 mt-0.5">BP</span>
          </div>

          <span className="text-sm font-bold text-[#A855F7]">+</span>

          {/* RP Node */}
          <div className="w-14 h-14 rounded-2xl bg-[#15111F] border border-[#30263F] flex flex-col items-center justify-center shadow-[0_0_20px_rgba(118,43,255,0.2)]">
            <Palette className="w-5 h-5 text-indigo-400" />
            <span className="text-[9px] font-mono font-bold text-indigo-300 mt-0.5">RP</span>
          </div>

          <span className="text-sm font-bold text-[#A855F7]">→</span>

          {/* Combined Output Node */}
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[#762BFF] to-[#4F13C4] border border-[#A855F7] flex flex-col items-center justify-center shadow-[0_0_30px_rgba(118,43,255,0.5)]">
            <Layers className="w-6 h-6 text-white" />
            <span className="text-[9px] font-mono font-bold text-white mt-0.5">.MCADDON</span>
            <div className="absolute -inset-1 rounded-2xl border border-[#A855F7]/40 animate-ping pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Loader2 className="w-4 h-4 text-[#A855F7] animate-spin" />
          <span>{currentStep}...</span>
        </div>
        <p className="text-xs text-[#AAA3BB] mt-1 max-w-xs">
          Merging manifests, lang strings, textures, and Script API handlers.
        </p>
      </div>

      {/* Pipeline Checklist */}
      <div className="rounded-xl bg-[#100D18] border border-[#30263F] p-3.5 space-y-2 mb-4">
        {steps.map((st) => {
          const isDone = progress >= st.threshold;
          const isCurrent =
            progress < st.threshold &&
            (steps[steps.indexOf(st) - 1]?.threshold || 0) <= progress;

          return (
            <div key={st.label} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 text-[#A855F7] animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-[#30263F] shrink-0" />
                )}
                <span
                  className={`truncate ${
                    isDone
                      ? 'text-white font-medium'
                      : isCurrent
                      ? 'text-[#A855F7] font-bold'
                      : 'text-[#716885]'
                  }`}
                >
                  {st.label}
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#AAA3BB] shrink-0">
                {isDone ? 'Done' : isCurrent ? `${Math.round(progress)}%` : 'Queued'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress Bar & Footer */}
      <div className="space-y-2">
        <div className="w-full h-2.5 bg-[#15111F] rounded-full border border-[#30263F] overflow-hidden p-0.5">
          <div
            className="h-full bg-gradient-to-r from-[#762BFF] to-[#A855F7] rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs font-mono text-[#AAA3BB]">
          <span>{currentStep}</span>
          <span className="font-bold text-white">{Math.round(progress)}%</span>
        </div>

        {onCancel && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-[#AAA3BB] hover:text-red-400 transition-colors"
            >
              Cancel Operation
            </button>
          </div>
        )}
      </div>
    </div>
  );
};