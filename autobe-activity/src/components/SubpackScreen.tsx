import React, { useState } from 'react';
import { AddonPack } from '@/types/modpack';

interface SubpackScreenProps {
  packs: AddonPack[];
  /** Resolves the chosen subpack index per pack id (or -1 to keep the whole pack). */
  onResolve: (choices: Record<string, number>) => void;
  onBack: () => void;
}

/**
 * Subpack picker — the themed equivalent of the Python `_show_subpack_selection`
 * modal. It handles every pack that ships a `subpacks` list in one pass instead
 * of popping one dialog per file.
 */
export const SubpackScreen: React.FC<SubpackScreenProps> = ({ packs, onResolve, onBack }) => {
  const [choices, setChoices] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of packs) init[p.id] = 0;
    return init;
  });

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none">
      <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-purple-500/20 bg-[#0B0716]/90">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-950/50 border border-purple-500/30 text-purple-200 active:scale-95"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-base font-bold text-white">Choose Subpack</h1>
          <p className="text-[11px] text-purple-300">
            {packs.length} addon{packs.length === 1 ? '' : 's'} ship multiple variants
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 pb-32">
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          Each variant below is a complete, self-contained pack. AutoBE extracts only the one you
          pick so nothing from the other variants leaks into the merge.
        </p>

        {packs.map((pack) => (
          <div
            key={pack.id}
            className="p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 space-y-2"
          >
            <div className="text-xs font-bold text-white truncate">{pack.name}</div>
            <div className="space-y-1.5">
              {pack.subpacks?.map((sp, idx) => {
                const active = (choices[pack.id] ?? 0) === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setChoices((prev) => ({ ...prev, [pack.id]: idx }))}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                      active
                        ? 'bg-purple-950/50 border-purple-400 shadow-[0_0_10px_rgba(147,51,234,0.3)]'
                        : 'bg-[#0A0A0A] border-purple-500/15'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center text-[9px] ${
                        active ? 'border-purple-300' : 'border-zinc-600'
                      }`}
                    >
                      {active ? '●' : ''}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-semibold text-white truncate">
                        {sp.name}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono truncate">
                        subpacks/{sp.folder}
                        {typeof sp.memory_tier === 'number' ? ` · tier ${sp.memory_tier}` : ''}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-[#090614]/95 border-t border-purple-500/20 z-20 flex gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-3.5 rounded-xl font-semibold text-xs bg-[#110B24] text-purple-200 border border-purple-500/30"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onResolve(choices)}
          className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-[0.98]"
        >
          Use These Subpacks
        </button>
      </div>
    </div>
  );
};