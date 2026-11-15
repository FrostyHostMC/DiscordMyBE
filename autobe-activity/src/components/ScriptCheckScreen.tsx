import React from 'react';
import { Palette, Package, ScrollText, AlertTriangle, Check, ArrowLeft, ArrowRight } from 'lucide-react';
import { AddonPack } from '@/types/modpack';
import { MergePlan, formatPlanSummary } from '@/utils/mergeEngine';

interface ScriptCheckScreenProps {
  plan: MergePlan;
  selectedPacks: AddonPack[];
  onContinue: () => void;
  onBack: () => void;
}

interface PlanRow {
  icon: React.ReactNode;
  label: string;
  file: string;
  packs: AddonPack[];
  accent: string;
}

export const ScriptCheckScreen: React.FC<ScriptCheckScreenProps> = ({
  plan,
  onContinue,
  onBack
}) => {
  const rows: PlanRow[] = [];
  if (plan.rp.length > 0) {
    rows.push({
      icon: <Palette className="w-4 h-4 text-indigo-400" />,
      label: 'Resource Pack',
      file: 'resource_pack.mcpack',
      packs: plan.rp,
      accent: 'border-indigo-500/30'
    });
  }
  if (plan.dataBp.length > 0) {
    rows.push({
      icon: <Package className="w-4 h-4 text-purple-400" />,
      label: 'Behavior (Data)',
      file: 'behavior_pack_data.mcpack',
      packs: plan.dataBp,
      accent: 'border-purple-500/30'
    });
  }
  for (const g of plan.scriptGroups) {
    rows.push({
      icon: <ScrollText className="w-4 h-4 text-fuchsia-400" />,
      label: `Behavior (Script API v${g.major})`,
      file: `behavior_pack_v${g.major}.mcpack`,
      packs: g.packs,
      accent: 'border-fuchsia-500/30'
    });
  }

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white">Script API & Output Plan</h1>
            <p className="text-[11px] text-[#AAA3BB]">Pack splitting verification</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 pb-32 max-w-3xl mx-auto w-full">
        <p className="text-xs text-[#AAA3BB] leading-relaxed">
          Your addons will be partitioned into isolated packages so differing Script API versions remain fully compatible without runtime collisions.
        </p>

        {/* Summary pill */}
        <div className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] text-xs font-mono text-purple-300">
          {formatPlanSummary(plan)}
        </div>

        {/* Output plan cards */}
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.file}
              className={`p-3.5 rounded-xl bg-[#100D18] border ${row.accent}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="p-2 rounded-lg bg-[#15111F] border border-[#30263F] shrink-0">
                    {row.icon}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs sm:text-sm font-bold text-white">{row.label}</span>
                    <span className="text-[10px] text-[#AAA3BB] font-mono truncate">{row.file}</span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#15111F] border border-[#30263F] text-purple-300">
                  {row.packs.length} pack{row.packs.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Per-pack chips */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {row.packs.map((p) => (
                  <span
                    key={p.id}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-[#15111F] border border-[#30263F] text-[#AAA3BB] max-w-full truncate"
                  >
                    {p.name}
                  </span>
                ))}
              </div>

              {/* Achievements badge */}
              <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-[#30263F]/50">
                {row.packs.some((p) => p.hasScripts || p.hasExperimental) ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400">
                    <AlertTriangle className="w-3 h-3" />
                    Achievements disabled in worlds using this pack
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                    <Check className="w-3 h-3" />
                    Xbox achievements supported
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Warning for unassigned scripted packs */}
        {plan.unassigned.length > 0 && (
          <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/30">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-xs font-bold text-red-300">Unrecognized Script API Version</span>
            </div>
            <p className="text-[11px] text-red-200/80 mb-2 leading-relaxed">
              These packs contain scripts without a recognizable @minecraft/server version in manifest dependencies.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {plan.unassigned.map((p) => (
                <span
                  key={p.id}
                  className="text-[10px] px-2 py-0.5 rounded bg-red-950/50 border border-red-500/30 text-red-200"
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Continue button */}
      <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 bg-[#100D18]/95 backdrop-blur-md border-t border-[#30263F] z-20 flex justify-end max-w-3xl mx-auto">
        <button
          type="button"
          onClick={onContinue}
          className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <span>Confirm & Start Merge</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};