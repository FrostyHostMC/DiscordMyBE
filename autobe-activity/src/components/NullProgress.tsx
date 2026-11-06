import React from 'react';

interface NullProgressProps {
  progress: number;
  complete?: boolean;
  status?: string;
  description?: string;
  compact?: boolean;
}

export const NullProgress: React.FC<NullProgressProps> = ({
  progress,
  complete = false,
  status = 'Building your modpack...',
  description = 'Your modpack will be available in Projects when complete, or you can save it directly to your device.',
  compact = false
}) => {
  const value = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const finished = complete;

  return (
    <section className={`w-full ${compact ? 'py-2' : 'py-5'}`} aria-label={`Modpack progress: ${Math.round(value)} percent`}>
      <div className={`text-center ${compact ? 'mb-1' : 'mb-3'}`}>
        <h2 className={`${compact ? 'text-sm' : 'text-xl sm:text-2xl'} font-black tracking-tight text-white`}>
          {finished ? 'Your modpack is ready!' : status}
        </h2>
        {!compact && <p className="mx-auto mt-1 max-w-md text-xs sm:text-sm leading-relaxed text-[#AAA3BB]">{finished ? 'Find it in Projects, or save it directly to your device.' : description}</p>}
      </div>
      <div className="mx-auto w-full max-w-2xl">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className="relative h-5 overflow-hidden rounded-full border border-[#65429a] bg-[#171126] p-1 shadow-[0_0_18px_rgba(139,53,255,0.18)]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#6d28d9] via-[#9333ea] to-[#d8b4fe] shadow-[0_0_12px_rgba(168,85,247,0.65)] transition-[width] duration-300 ease-out" style={{ width: `${value}%` }} />
          <div className="pointer-events-none absolute inset-1 flex justify-between gap-1">
            {Array.from({ length: 12 }, (_, index) => <span key={index} className="h-full w-px bg-[#090611]/45" />)}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[#AAA3BB]">
          <span>{finished ? 'Complete' : 'Building'}</span>
          <span className="font-bold text-white tabular-nums">{Math.round(value)}%</span>
        </div>
      </div>
    </section>
  );
};
