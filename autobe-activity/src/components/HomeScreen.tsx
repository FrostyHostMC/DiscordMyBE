import React from 'react';
import {
  Layers,
  ScrollText,
  Palette,
  Boxes,
  ArrowRight,
  Clock,
  Download
} from 'lucide-react';
import { TabType, MergedModpack, AddonPack } from '@/types/modpack';

interface HomeScreenProps {
  onStartCreate: () => void;
  onNavigateTab: (tab: TabType) => void;
  onOpenAbout: () => void;
  onOpenModpack: (mp: MergedModpack) => void;
  onExportModpack: (mp: MergedModpack) => void;
  onImportClick: () => void;
  modpackCount: number;
  libraryCount: number;
  modpacks: MergedModpack[];
  installedPacks: AddonPack[];
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigateTab,
  onOpenModpack,
  onExportModpack,
  modpackCount,
  libraryCount,
  modpacks,
  installedPacks
}) => {
  const behaviorCount = installedPacks.filter((p) => p.type === 'Behavior Pack').length;
  const resourceCount = installedPacks.filter((p) => p.type === 'Resource Pack').length;

  const sortedModpacks = [...modpacks].sort((a, b) => b.createdAt - a.createdAt);
  const recentModpacks = sortedModpacks.slice(0, 4);

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-6 pt-5 pb-24 max-w-5xl w-full mx-auto select-none">
      {/* Overview Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl bg-[#100D18] border border-[#30263F]/70 shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#A855F7]" />
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Overview</h1>
          </div>
          <p className="text-xs sm:text-sm text-[#AAA3BB] mt-1">
            Combine your Minecraft Bedrock addons into consolidated packs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab('workspace')}
          className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-white text-xs font-bold transition-all shadow-[0_0_12px_rgba(118,43,255,0.3)] active:scale-95"
        >
          <ArrowRight className="w-4 h-4" />
          <span>Start New Merge</span>
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onNavigateTab('bp_library')}
          className="p-4 rounded-xl bg-[#15111F] border border-[#30263F]/70 hover:border-[#762BFF]/50 transition-all text-left flex flex-col gap-1 active:scale-[0.98]"
        >
          <div className="flex items-center justify-between text-[#AAA3BB]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Behavior Packs</span>
            <ScrollText className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white font-mono mt-1">
            {behaviorCount}
          </div>
          <span className="text-[10px] text-[#716885]">Up to 100 supported</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('rp_library')}
          className="p-4 rounded-xl bg-[#15111F] border border-[#30263F]/70 hover:border-[#762BFF]/50 transition-all text-left flex flex-col gap-1 active:scale-[0.98]"
        >
          <div className="flex items-center justify-between text-[#AAA3BB]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Resource Packs</span>
            <Palette className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white font-mono mt-1">
            {resourceCount}
          </div>
          <span className="text-[10px] text-[#716885]">Up to 100 supported</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('mypacks')}
          className="col-span-2 lg:col-span-1 p-4 rounded-xl bg-[#15111F] border border-[#30263F]/70 hover:border-[#762BFF]/50 transition-all text-left flex flex-col gap-1 active:scale-[0.98]"
        >
          <div className="flex items-center justify-between text-[#AAA3BB]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Projects / Merges</span>
            <Boxes className="w-4 h-4 text-[#A855F7]" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-white font-mono mt-1">
            {modpackCount}
          </div>
          <span className="text-[10px] text-[#716885]">Saved Bedrock outputs</span>
        </button>

      </div>

      {/* Recent Work / Projects */}
      <div className="rounded-xl bg-[#100D18] border border-[#30263F]/70 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#A855F7]" />
            <span className="text-sm font-bold text-white">Recent Work & Merge Sessions</span>
          </div>
          {recentModpacks.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigateTab('mypacks')}
              className="text-xs font-semibold text-[#A855F7] hover:text-[#C9A9FF] flex items-center gap-1 transition-colors"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {recentModpacks.length === 0 ? (
          <div className="py-12 text-center text-[#AAA3BB]">
            <Boxes className="w-8 h-8 text-[#30263F] mx-auto mb-2" />
            <p className="text-xs font-semibold text-white">No merged projects yet</p>
            <p className="text-[11px] text-[#716885] mt-0.5 max-w-xs mx-auto">
              Select behavior and resource packs in the Merge Workspace to build your first consolidated pack.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#30263F]/50">
            {recentModpacks.map((mp) => {
              const bpInMp = mp.includedPacks.filter((p) => p.type === 'Behavior Pack').length;
              const rpInMp = mp.includedPacks.filter((p) => p.type === 'Resource Pack').length;

              return (
                <div
                  key={mp.id}
                  className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0 overflow-hidden">
                      {mp.iconDataUrl ? (
                        <img src={mp.iconDataUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Boxes className="w-5 h-5 text-[#A855F7]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-bold text-white truncate">
                        {mp.name}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#AAA3BB] font-mono mt-0.5">
                        <span className="text-amber-400">{bpInMp} BP</span>
                        <span>•</span>
                        <span className="text-indigo-400">{rpInMp} RP</span>
                        <span>•</span>
                        <span>{formatBytes(mp.size)}</span>
                        <span>•</span>
                        <span>{formatDate(mp.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      Ready
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenModpack(mp)}
                      className="px-2.5 py-1 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-xs font-semibold text-white transition-all active:scale-95"
                    >
                      Reopen
                    </button>
                    <button
                      type="button"
                      onClick={() => onExportModpack(mp)}
                      className="px-2.5 py-1 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white transition-all shadow-[0_0_10px_rgba(118,43,255,0.3)] active:scale-95 flex items-center gap-1"
                      title="Download .mcaddon"
                    >
                      <Download className="w-3 h-3" />
                      <span className="hidden xs:inline">Export</span>
                    </button>
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