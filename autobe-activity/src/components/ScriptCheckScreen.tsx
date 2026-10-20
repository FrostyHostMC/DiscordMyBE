import React from 'react';
import { MergePlan, formatPlanSummary } from '@/utils/mergeEngine';

interface ScriptCheckScreenProps {
  plan: MergePlan;
  onContinue: () => void;
  onBack: () => void;
}

interface PlanRow {
  icon: string;
  label: string;
  file: string;
  packs: Array<{ id: string; name: string; hasScripts?: boolean; hasExperimental?: boolean }>;
  accentBorder: string;
  accentText: string;
  note?: string;
}

/**
 * Merge-plan review.
 *
 * Equivalent of the Python "Check Packs → script API groups" overlay: it shows
 * exactly which .mcpack files will be produced and which addons land in each.
 */
export const ScriptCheckScreen: React.FC<ScriptCheckScreenProps> = ({
  plan,
  onContinue,
  onBack
}) => {
  const rows: PlanRow[] = [];

  if (plan.rp.length > 0) {
    rows.push({
      icon: '🎨',
      label: 'Resource Pack',
      file: 'resource_pack.mcpack',
      packs: plan.rp,
      accentBorder: 'border-indigo-500/40',
      accentText: 'text-indigo-200'
    });
  }

  if (plan.dataBp.length > 0) {
    rows.push({
      icon: '📦',
      label: 'Behavior (Data only)',
      file: 'behavior_pack_data.mcpack',
      packs: plan.dataBp,
      accentBorder: 'border-purple-500/40',
      accentText: 'text-purple-200',
      note: 'No scripts — achievements stay enabled for this pack.'
    });
  }

  for (const g of plan.scriptGroups) {
    rows.push({
      icon: '📜',
      label: g.unknownVersion
        ? 'Behavior (Scripted — version undeclared)'
        : `Behavior (Script API v${g.major})`,
      file: `behavior_pack_v${g.major || 'unknown'}.mcpack`,
      packs: g.packs,
      accentBorder: g.unknownVersion
        ? 'border-amber-500/40'
        : 'border-fuchsia-500/40',
      accentText: g.unknownVersion ? 'text-amber-200' : 'text-fuchsia-200',
      note: g.unknownVersion
        ? 'These packs declare scripts but no @minecraft/server version, so they are kept in their own pack rather than mixed with versioned scripts.'
        : g.scriptVersion
        ? `Declares @minecraft/server ${g.scriptVersion}. Scripts from other versions never mix into this output.`
        : undefined
    });
  }

  const totalOutputs = rows.length;

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-purple-500/20 bg-[#0B0716]/90">
        <div className="flex items-center gap-3">
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
            <h1 className="text-base font-bold text-white">Merge Plan</h1>
            <p className="text-[11px] text-purple-300">
              {totalOutputs} output file{totalOutputs === 1 ? '' : 's'} will be produced
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 pb-32">
        <p className="text-xs text-zinc-400 leading-relaxed">
          AutoBE splits your addons so every Script API version stays compatible. Nothing is
          dropped — check each output below.
        </p>

        <div className="p-3 rounded-xl bg-[#0D091A] border border-purple-500/25 text-[11px] font-mono text-purple-300 break-words">
          {formatPlanSummary(plan)}
        </div>

        <div className="space-y-2.5">
          {rows.map((row) => {
            const achievementsOff = row.packs.some((p) => p.hasScripts || p.hasExperimental);
            return (
              <div
                key={row.file}
                className={`p-3.5 rounded-2xl bg-[#0D091A] border ${row.accentBorder}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg">{row.icon}</span>
                    <div className="flex flex-col min-w-0">
                      <span className={`text-xs font-bold ${row.accentText} truncate`}>
                        {row.label}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono truncate">
                        {row.file}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-900/50 border border-purple-500/30 text-purple-200 whitespace-nowrap">
                    {row.packs.length} pack{row.packs.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {row.note && (
                  <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">{row.note}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {row.packs.map((p) => (
                    <span
                      key={p.id}
                      className="text-[10px] px-2 py-1 rounded-lg bg-purple-950/60 border border-purple-500/20 text-zinc-300 max-w-full truncate"
                    >
                      {p.name}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 mt-2.5">
                  {achievementsOff ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-950/50 border border-red-500/40 text-red-300">
                      ⚠ Achievements disabled
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-500/40 text-emerald-300">
                      ✓ Achievements active
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-zinc-600 leading-relaxed">
          All outputs are packed into a single .mcaddon, and each .mcpack can also be downloaded on
          its own from the completion screen.
        </p>
      </div>

      {/* Continue button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-[#090614]/95 border-t border-purple-500/20 z-20">
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
        >
          <span>Start Merge</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};