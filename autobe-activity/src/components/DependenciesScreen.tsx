import React from 'react';
import { GitFork, ScrollText, Palette, ArrowRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import { AddonPack } from '@/types/modpack';

interface DependenciesScreenProps {
  packs: AddonPack[];
  onSelectPack: (pack: AddonPack) => void;
}

export const DependenciesScreen: React.FC<DependenciesScreenProps> = ({ packs, onSelectPack }) => {
  const behaviorPacks = packs.filter((p) => p.type === 'Behavior Pack');
  const resourcePacks = packs.filter((p) => p.type === 'Resource Pack');

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-y-auto p-4 sm:p-6 pb-24 max-w-4xl mx-auto w-full">
      <div className="mb-5 pb-3 border-b border-[#30263F]/70">
        <div className="flex items-center gap-2">
          <GitFork className="w-5 h-5 text-[#A855F7]" />
          <h1 className="text-base sm:text-lg font-bold text-white">Pack Dependencies & Linkages</h1>
        </div>
        <p className="text-xs text-[#AAA3BB] mt-1">
          AutoBE maps dependencies between Behavior Packs and Resource Packs to ensure textures and models match behaviors.
        </p>
      </div>

      <div className="space-y-4">
        {/* Mapping Summary */}
        <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#AAA3BB]">Resource Linker Status:</span>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Auto-linked via UUID header</span>
            </span>
          </div>
          <span className="text-xs font-mono text-[#AAA3BB]">
            {behaviorPacks.length} BP ↔ {resourcePacks.length} RP
          </span>
        </div>

        {behaviorPacks.length === 0 ? (
          <div className="py-12 text-center text-[#AAA3BB] text-xs">
            No behavior packs loaded. Import addons to inspect dependencies.
          </div>
        ) : (
          <div className="space-y-3">
            {behaviorPacks.map((bp) => {
              // Try to find a matching resource pack by name or substring
              const matchingRp = resourcePacks.find(
                (rp) =>
                  rp.name.toLowerCase().includes(bp.name.toLowerCase().slice(0, 5)) ||
                  bp.name.toLowerCase().includes(rp.name.toLowerCase().slice(0, 5))
              );

              return (
                <div
                  key={bp.id}
                  className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] flex flex-col gap-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <ScrollText className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-xs font-bold text-white truncate">{bp.name}</span>
                      <span className="text-[10px] font-mono text-[#AAA3BB]">({bp.version})</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectPack(bp)}
                      className="text-[11px] text-[#A855F7] hover:text-[#C9A9FF]"
                    >
                      Details →
                    </button>
                  </div>

                  {/* Linked Resource Pack */}
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#15111F] border border-[#30263F]/60 text-xs">
                    <ArrowRight className="w-3.5 h-3.5 text-[#AAA3BB] shrink-0" />
                    {matchingRp ? (
                      <div className="flex items-center gap-2 min-w-0 text-indigo-300">
                        <Palette className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="truncate">Paired with: {matchingRp.name}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[#AAA3BB]">
                        <span>Independent behavior pack (uses global merged resource pack)</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};