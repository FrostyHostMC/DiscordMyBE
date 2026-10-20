import React from 'react';
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
  onDeleteModpack,
  onStartCreate
}) => {
  const formatSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-3 pb-24 overflow-y-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">My Modpacks</h1>
          <p className="text-xs text-zinc-400">
            {modpacks.length} merged modpack{modpacks.length === 1 ? '' : 's'} ready
          </p>
        </div>

        <button
          type="button"
          onClick={onStartCreate}
          className="px-3 py-1.5 rounded-xl bg-purple-600 border border-purple-400/40 text-xs font-bold text-white active:scale-95 shadow-[0_0_12px_rgba(147,51,234,0.4)]"
        >
          + New Merge
        </button>
      </div>

      {/* Modpacks List */}
      <div className="space-y-3">
        {modpacks.length === 0 ? (
          <div className="py-20 text-center text-zinc-500">
            <div className="w-16 h-16 rounded-2xl bg-purple-950/40 border border-purple-500/20 flex items-center justify-center text-2xl mx-auto mb-3">
              📦
            </div>
            <p className="text-sm font-semibold text-white">No merged modpacks yet</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto">
              Combine your behavior and resource packs to create your first all-in-one .mcaddon file!
            </p>
          </div>
        ) : (
          modpacks.map((mp) => (
            <div
              key={mp.id}
              onClick={() => onSelectModpack(mp)}
              className="p-4 rounded-2xl bg-[#0D091A] border border-purple-500/20 hover:border-purple-500/40 transition-all flex flex-col gap-3 cursor-pointer group shadow-[0_0_15px_rgba(124,58,237,0.1)] active:scale-[0.99]"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-700 to-indigo-900 border border-purple-400/50 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                    <span className="text-xl">📦</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white group-hover:text-purple-300 transition-colors">
                      {mp.name}
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5">
                      <span className="text-purple-400 font-semibold">{mp.totalPacks} Packs</span>
                      <span>•</span>
                      <span>{formatSize(mp.size)}</span>
                      <span>•</span>
                      <span>v{mp.version}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteModpack(mp.id);
                  }}
                  className="p-1.5 text-zinc-500 hover:text-red-400 active:scale-95 transition-colors"
                  aria-label="Delete"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Included packs mini pills */}
              <div className="flex flex-wrap gap-1.5">
                {mp.includedPacks.slice(0, 3).map((p, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-500/20 text-purple-200 truncate max-w-[140px]"
                  >
                    {p.name}
                  </span>
                ))}
                {mp.includedPacks.length > 3 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-950/40 text-purple-400 font-bold">
                    +{mp.includedPacks.length - 3} more
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};