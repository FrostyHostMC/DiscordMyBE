import React from 'react';
import { AddonPack } from '@/types/modpack';

interface LibraryScreenProps {
  packs: AddonPack[];
  onSelectPackForMerge: (packId: string) => void;
  onDeletePack: (packId: string) => void;
  onStartCreate: () => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  packs,
  onSelectPackForMerge,
  onDeletePack,
  onStartCreate
}) => {
  const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const scriptsCount = packs.filter((p) => p.hasScripts).length;
  const obfuscatedCount = packs.filter((p) => p.isObfuscated).length;
  const totalSize = packs.reduce((s, p) => s + (p.fileSize || 0), 0);

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-3 pb-24 overflow-y-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Addons Library</h1>
          <p className="text-xs text-zinc-400">
            {packs.length} pack{packs.length === 1 ? '' : 's'} · {formatSize(totalSize)} stored on
            device
          </p>
        </div>

        <button
          type="button"
          onClick={onStartCreate}
          className="px-3 py-1.5 rounded-xl bg-purple-600 border border-purple-400/40 text-xs font-bold text-white active:scale-95 shadow-[0_0_12px_rgba(147,51,234,0.4)]"
        >
          + Add More
        </button>
      </div>

      {/* Status banners */}
      <div className="space-y-2 mb-4">
        {obfuscatedCount > 0 && (
          <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5">
            <span className="text-base">⛔</span>
            <div>
              <span className="font-bold">{obfuscatedCount} obfuscated pack
              {obfuscatedCount === 1 ? '' : 's'}:</span> these contain closed-source JSON and will
              be blocked from merging until removed.
            </div>
          </div>
        )}

        {scriptsCount > 0 ? (
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
            <span className="text-base">⚠️</span>
            <div>
              <span className="font-bold">Achievements warning:</span> {scriptsCount} pack
              {scriptsCount === 1 ? '' : 's'} declare script modules, which disable Xbox
              achievements in Bedrock worlds.
            </div>
          </div>
        ) : (
          packs.length > 0 && (
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2.5">
              <span className="text-base">🛡️</span>
              <div>
                <span className="font-bold">Achievements safe:</span> no script modules detected.
              </div>
            </div>
          )
        )}
      </div>

      {/* Packs list */}
      <div className="space-y-2.5">
        {packs.length === 0 ? (
          <div className="py-20 text-center text-zinc-500">
            <p className="text-sm font-semibold">Your library is empty</p>
            <p className="text-xs mt-1">Tap “+ Add More” to import your .mcpack files</p>
          </div>
        ) : (
          packs.map((pack) => (
            <div
              key={pack.id}
              className="p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 hover:border-purple-500/40 transition-all flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-purple-950/50 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                    {pack.iconDataUrl ? (
                      <img
                        src={pack.iconDataUrl}
                        alt={pack.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xl">
                        {pack.type === 'Resource Pack' ? '🎨' : '⚙️'}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate max-w-[170px]">
                      {pack.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <span
                        className={
                          pack.type === 'Behavior Pack'
                            ? 'text-amber-400 font-medium'
                            : 'text-blue-400 font-medium'
                        }
                      >
                        {pack.type}
                      </span>
                      <span>•</span>
                      <span className="truncate">{pack.version}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[11px] text-zinc-500 font-mono">{formatSize(pack.fileSize)}</span>
                  <button
                    type="button"
                    onClick={() => onDeletePack(pack.id)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 active:scale-95"
                    aria-label={`Delete ${pack.name}`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              {pack.description && (
                <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                  {pack.description}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {pack.minEngineVersion && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-900/60 border border-zinc-700/50 text-zinc-400 font-mono">
                    engine {pack.minEngineVersion}
                  </span>
                )}
                {pack.scriptApiVersion && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-950/40 border border-fuchsia-500/30 text-fuchsia-300 font-mono">
                    Script API {pack.scriptApiVersion}
                  </span>
                )}
                {(pack.subpacks?.length || 0) > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950/40 border border-sky-500/30 text-sky-300">
                    {pack.subpacks!.length} subpack{pack.subpacks!.length === 1 ? '' : 's'}
                  </span>
                )}
                {pack.isObfuscated && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-red-950/50 border border-red-500/40 text-red-300">
                    ⛔ obfuscated
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => onSelectPackForMerge(pack.id)}
                className="w-full py-2 rounded-xl bg-purple-950/40 border border-purple-500/30 text-[11px] font-bold text-purple-200 active:scale-[0.99] flex items-center justify-center gap-1.5"
              >
                Select for merge
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};