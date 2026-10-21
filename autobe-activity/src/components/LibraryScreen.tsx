import React, { useState } from 'react';
import {
  Package,
  ScrollText,
  Palette,
  Search,
  UploadCloud,
  Trash2,
  Info,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { AddonPack } from '@/types/modpack';
import { PackInspectorModal } from './PackInspectorModal';

interface LibraryScreenProps {
  packs: AddonPack[];
  onSelectPackForMerge: (packId: string) => void;
  onDeletePack: (packId: string) => void;
  onStartCreate: () => void;
  filterType?: 'all' | 'bp' | 'rp';
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  packs,
  onSelectPackForMerge,
  onDeletePack,
  filterType: initialFilter = 'all'
}) => {
  const [filter, setFilter] = useState<'all' | 'bp' | 'rp'>(initialFilter);
  const [search, setSearch] = useState('');
  const [inspectingPack, setInspectingPack] = useState<AddonPack | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const filteredPacks = packs.filter((p) => {
    if (filter === 'bp' && p.type !== 'Behavior Pack') return false;
    if (filter === 'rp' && p.type !== 'Resource Pack') return false;
    if (search.trim() && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Header & Controls */}
      <div className="px-4 sm:px-6 py-4 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-white">
              {filter === 'bp'
                ? 'Behavior Packs Library'
                : filter === 'rp'
                ? 'Resource Packs Library'
                : 'Addon Library & History'}
            </h1>
            <p className="text-xs text-[#AAA3BB] mt-0.5">
              {packs.length} addon pack{packs.length === 1 ? '' : 's'} loaded in client storage
            </p>
          </div>
        </div>

        {/* Filter Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 mt-3 pt-3 border-t border-[#30263F]/50">
          <div className="flex p-0.5 bg-[#15111F] rounded-lg border border-[#30263F] text-xs">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                filter === 'all' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
              }`}
            >
              All ({packs.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('bp')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                filter === 'bp' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
              }`}
            >
              Behavior ({packs.filter((p) => p.type === 'Behavior Pack').length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('rp')}
              className={`px-2.5 py-1 rounded-md font-semibold ${
                filter === 'rp' ? 'bg-[#762BFF] text-white' : 'text-[#AAA3BB] hover:text-white'
              }`}
            >
              Resource ({packs.filter((p) => p.type === 'Resource Pack').length})
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#AAA3BB] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name..."
              className="bg-[#15111F] border border-[#30263F] rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-[#716885] outline-none focus:border-[#762BFF] w-40 sm:w-56"
            />
          </div>
        </div>
      </div>

      {/* Packs List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 space-y-2.5 max-w-4xl mx-auto w-full">
        {filteredPacks.length === 0 ? (
          <div className="py-16 text-center text-xs text-[#AAA3BB]">
            <Package className="w-8 h-8 text-[#30263F] mx-auto mb-2" />
            <p className="font-semibold text-white">No addons found</p>
            <p className="text-[11px] text-[#716885] mt-1">Import .mcpack or .mcaddon archives to populate this list.</p>
          </div>
        ) : (
          filteredPacks.map((pack) => {
            const isBp = pack.type === 'Behavior Pack';
            return (
              <div
                key={pack.id}
                className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] hover:border-[#762BFF]/40 transition-all flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0">
                    {pack.iconDataUrl ? (
                      <img src={pack.iconDataUrl} alt="" className="w-full h-full object-cover" />
                    ) : isBp ? (
                      <ScrollText className="w-5 h-5 text-amber-400" />
                    ) : (
                      <Palette className="w-5 h-5 text-indigo-400" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-[180px] sm:max-w-xs">
                        {pack.name}
                      </h3>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded font-mono uppercase ${
                          isBp
                            ? 'bg-amber-950/40 text-amber-300 border border-amber-500/30'
                            : 'bg-indigo-950/40 text-indigo-300 border border-indigo-500/30'
                        }`}
                      >
                        {isBp ? 'BP' : 'RP'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-[#AAA3BB] font-mono mt-0.5">
                      <span>{pack.version}</span>
                      <span>•</span>
                      <span>{formatSize(pack.fileSize)}</span>
                      {pack.hasScripts && (
                        <>
                          <span>•</span>
                          <span className="text-red-400 font-semibold">Script API</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setInspectingPack(pack)}
                    className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-white hover:bg-[#15111F] transition-colors"
                    title="Inspect manifest"
                  >
                    <Info className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectPackForMerge(pack.id)}
                    className="px-2.5 py-1 rounded-lg bg-[#762BFF]/20 hover:bg-[#762BFF]/35 text-[#A855F7] hover:text-white border border-[#762BFF]/40 text-xs font-semibold transition-all active:scale-95"
                  >
                    Merge
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeletePack(pack.id)}
                    className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-red-400 hover:bg-[#15111F] transition-colors"
                    title="Delete pack"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Inspector Modal */}
      {inspectingPack && (
        <PackInspectorModal pack={inspectingPack} onClose={() => setInspectingPack(null)} />
      )}
    </div>
  );
};