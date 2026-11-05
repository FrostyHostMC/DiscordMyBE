import React, { useState, useEffect } from 'react';
import { ScrollText, Palette, Loader2, Clock, Sparkles, CheckCircle2 } from 'lucide-react';
import { NullProgress } from './NullProgress';

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

  const safeProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-[#08070D] text-white select-none px-4 sm:px-6 pt-6 pb-8 justify-between max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between border-b border-[#30263F]/70 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-5 h-5 text-[#A855F7] shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base font-bold text-white">AutoBE Modpack Builder</h1>
            <p className="text-[11px] text-[#AAA3BB]">
              Building from {packCount} addon{packCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#15111F] border border-[#30263F] text-xs font-mono text-[#AAA3BB] shrink-0">
          <Clock className="w-3.5 h-3.5 text-[#A855F7]" />
          <span>{formatTimer(elapsedSeconds)}</span>
        </div>
      </div>

      <div className="my-auto py-5">
        <NullProgress
          progress={safeProgress}
          status="Building your modpack..."
          description="Your modpack will be available in Projects when complete, or you can save it directly to your device."
        />

        <div className="mt-4 flex items-center justify-center gap-3 sm:gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#15111F] border border-[#30263F] flex flex-col items-center justify-center shadow-[0_0_20px_rgba(118,43,255,0.2)]">
            <ScrollText className="w-5 h-5 text-amber-400" />
            <span className="text-[9px] font-mono font-bold text-amber-300 mt-0.5">BP</span>
          </div>
          <span className="text-sm font-bold text-[#A855F7]">+</span>
          <div className="w-14 h-14 rounded-2xl bg-[#15111F] border border-[#30263F] flex flex-col items-center justify-center shadow-[0_0_20px_rgba(118,43,255,0.2)]">
            <Palette className="w-5 h-5 text-indigo-400" />
            <span className="text-[9px] font-mono font-bold text-indigo-300 mt-0.5">RP</span>
          </div>
          <span className="text-sm font-bold text-[#A855F7]">→</span>
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#762BFF] to-[#4F13C4] border border-[#A855F7] flex flex-col items-center justify-center shadow-[0_0_30px_rgba(118,43,255,0.5)]">
            <Sparkles className="w-6 h-6 text-white" />
            <span className="text-[9px] font-mono font-bold text-white mt-0.5">MODPACK</span>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-[#AAA3BB]">
          <Loader2 className="w-3.5 h-3.5 text-[#A855F7] animate-spin" />
          <span>{currentStep}...</span>
        </div>
      </div>

      <div className="rounded-xl bg-[#100D18] border border-[#30263F] p-3.5 space-y-2 mb-4">
        {steps.map((step, index) => {
          const isDone = safeProgress >= step.threshold;
          const isCurrent = !isDone && (steps[index - 1]?.threshold || 0) <= safeProgress;
          return (
            <div key={step.label} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : isCurrent ? <Loader2 className="w-4 h-4 text-[#A855F7] animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-[#30263F] shrink-0" />}
                <span className={`truncate ${isDone ? 'text-white font-medium' : isCurrent ? 'text-[#A855F7] font-bold' : 'text-[#716885]'}`}>{step.label}</span>
              </div>
              <span className="text-[10px] font-mono text-[#AAA3BB] shrink-0">{isDone ? 'Done' : isCurrent ? `${Math.round(safeProgress)}%` : 'Queued'}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-[#AAA3BB]">
        <span className="truncate">{currentStep}</span>
        {onCancel && <button type="button" onClick={onCancel} className="shrink-0 text-xs text-[#AAA3BB] hover:text-red-400 transition-colors">Cancel Operation</button>}
      </div>
    </div>
  );
};
