import React, { useState } from 'react';
import { Boxes, Trash2, ArrowUpRight, Search } from 'lucide-react';
import { MergedModpack } from '@/types/modpack';

interface MyPacksScreenProps {
  modpacks: MergedModpack[];
  onSelectModpack: (modpack: MergedModpack) => void;
  onDeleteModpack: (id: string) => void;
  onStartCreate: () => void;
}

export const MyPacksScreen: React.FC<MyPacksScreenProps> = ({
  modpacks,
  onSelectModpack,
  onDeleteModpack
}) => {
  const [search, setSearch] = useState('');

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

  const filtered = modpacks.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-white">My Merged Projects</h1>
            <p className="text-xs text-[#AAA3BB] mt-0.5">
              {modpacks.length} consolidated modpack{modpacks.length === 1 ? '' : 's'} saved to storage
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="mt-3 pt-3 border-t border-[#30263F]/50">
          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 text-[#AAA3BB] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter projects by name..."
              className="bg-[#15111F] border border-[#30263F] rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-[#716885] outline-none focus:border-[#762BFF] w-full"
            />
          </div>
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 space-y-3 max-w-4xl mx-auto w-full">
        {filtered.length === 0 ? (
          <div className="py-20 text-center text-xs text-[#AAA3BB]">
            <Boxes className="w-10 h-10 text-[#30263F] mx-auto mb-3" />
            <p className="font-semibold text-white text-sm">No Projects Found</p>
            <p className="text-[#716885] text-xs mt-1 max-w-xs mx-auto">
              Combine your behavior and resource packs in the Merge Workspace to create your first consolidated .mcaddon.
            </p>
          </div>
        ) : (
          filtered.map((mp) => {
            const bpCount = mp.includedPacks.filter((p) => p.type === 'Behavior Pack').length;
            const rpCount = mp.includedPacks.filter((p) => p.type === 'Resource Pack').length;

            return (
              <div
                key={mp.id}
                onClick={() => onSelectModpack(mp)}
                className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] hover:border-[#762BFF]/50 transition-all cursor-pointer flex flex-col gap-3 group active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0 overflow-hidden">
                      {mp.iconDataUrl ? (
                        <img src={mp.iconDataUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Boxes className="w-5 h-5 text-[#A855F7]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white group-hover:text-[#A855F7] transition-colors truncate">
                        {mp.name}
                      </h3>
                      <div className="flex items-center gap-2 text-[11px] text-[#AAA3BB] font-mono mt-0.5">
                        <span className="text-amber-400">{bpCount} BP</span>
                        <span>•</span>
                        <span className="text-indigo-400">{rpCount} RP</span>
                        <span>•</span>
                        <span>{formatSize(mp.size)}</span>
                        <span>•</span>
                        <span>{formatDate(mp.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      Ready
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteModpack(mp.id);
                      }}
                      className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-red-400 hover:bg-[#15111F] transition-colors"
                      title="Delete Project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Sub-packs preview strip */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-[#30263F]/40">
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {mp.includedPacks.slice(0, 3).map((p, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#15111F] border border-[#30263F] text-[#AAA3BB] truncate max-w-[130px]"
                      >
                        {p.name}
                      </span>
                    ))}
                    {mp.includedPacks.length > 3 && (
                      <span className="text-[10px] text-[#716885] px-1 py-0.5">
                        +{mp.includedPacks.length - 3} more
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-[#A855F7] font-semibold shrink-0">
                    <span>Inspect</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};