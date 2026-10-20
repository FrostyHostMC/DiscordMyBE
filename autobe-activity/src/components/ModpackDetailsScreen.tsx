import assetsData from "@/config/assets";
import React from 'react';
import { MergedModpack, MergedOutput } from '@/types/modpack';
interface ModpackDetailsScreenProps {
  modpack: MergedModpack;
  onBack: () => void;
  onDelete: (id: string) => void;
  onDownloadOutput: (output: MergedOutput) => void;
  /** Saves the single .mcaddon bundle containing every output. */
  onDownloadAddon: () => void;
  onReinstall: () => void;
}
export const ModpackDetailsScreen: React.FC<ModpackDetailsScreenProps> = ({
  modpack,
  onBack,
  onDelete,
  onDownloadOutput,
  onDownloadAddon,
  onReinstall
}) => {
  const formatSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  return <div className="flex flex-col h-full bg-[#07050F] text-white select-none">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-purple-500/20 bg-[#0B0716]/90">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-950/50 border border-purple-500/30 text-purple-200 active:scale-95" aria-label="Back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-white">Modpack Details</h1>
        </div>

        <button type="button" onClick={() => onDelete(modpack.id)} className="flex items-center justify-center w-9 h-9 rounded-full bg-red-950/40 border border-red-500/30 text-red-300 active:scale-95" aria-label="Delete Modpack">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 pb-28">
        {/* Banner with StoneByte branding and landscape */}
        <div className="relative w-full h-36 rounded-2xl overflow-hidden border border-purple-500/30 bg-[#120B24] flex items-center justify-center shadow-[0_0_25px_rgba(147,51,234,0.3)]">
          {/* Background image */}
          <div className="absolute inset-0 bg-cover bg-center opacity-50" style={{
          backgroundImage: `url('https://cdn.aippy.ai/asset/ded715de6f58468487e7243e4e5b7060.jpg?x-oss-process=image/format,webp')`
        }} />
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-[0_0_20px_rgba(168,85,247,0.6)] border border-purple-400/40 p-1 bg-[#090614]/80">
              <img src={assetsData.IMAGE_DNFM} alt="StoneByte Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-xs font-black tracking-widest text-white mt-1 font-mono">
              STONE<span className="text-purple-400">BYTE</span>
            </span>
          </div>
        </div>

        {/* Title and Badge */}
        <div>
          <h2 className="text-lg font-extrabold text-white">{modpack.name}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-900/50 text-purple-300 border border-purple-500/30">
              Custom Pack
            </span>
            <span className="text-xs text-zinc-400 font-mono">
              Created {new Date(modpack.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Stat Pills */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#0D091A] border border-purple-500/20 text-xs text-zinc-300 font-medium">
          <div className="flex items-center gap-1.5">
            <span className="text-purple-400">📦</span>
            <span>{modpack.totalPacks} Packs</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-purple-400">💾</span>
            <span>{formatSize(modpack.size)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-purple-400">🏷️</span>
            <span>v{modpack.version}</span>
          </div>
        </div>

        {/* Merged Outputs List */}
        {modpack.outputs && modpack.outputs.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-white mb-2.5">Merged Outputs</h3>
            <div className="space-y-2">
              {modpack.outputs.map((out) => (
                <button
                  key={out.id}
                  type="button"
                  onClick={() => onDownloadOutput(out)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-[#0D091A] border border-purple-500/15 active:scale-[0.98] transition-transform text-left"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-white truncate">{out.label}</span>
                    <span className="text-[10px] text-zinc-400 font-mono truncate">
                      {out.fileName} · {out.packCount} pack{out.packCount !== 1 ? 's' : ''} · {formatSize(out.size)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {out.achievementsDisabled ? (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-950/60 border border-red-500/40 text-red-300">
                        ⚠ No ach.
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                        ✓ Ach.
                      </span>
                    )}
                    <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Included Packs List */}
        <div>
          <h3 className="text-sm font-bold text-white mb-2.5">Included Packs</h3>
          <div className="space-y-2">
            {modpack.includedPacks.map((pack, i) => <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#0D091A] border border-purple-500/15">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg overflow-hidden bg-purple-950/60 border border-purple-500/25 flex items-center justify-center flex-shrink-0">
                    {pack.iconDataUrl ? <img src={pack.iconDataUrl} alt={pack.name} className="w-full h-full object-cover" /> : <span className="text-sm">📦</span>}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-white truncate max-w-[190px]">
                      {pack.name}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {pack.type} • {pack.version}
                    </span>
                  </div>
                </div>

                <svg className="w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>)}
          </div>
        </div>
      </div>

      {/* Floating action bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-[#090614]/95 backdrop-blur-lg border-t border-purple-500/20 z-20 space-y-2">
        <button
          type="button"
          onClick={onDownloadAddon}
          disabled={!modpack.outputBlob}
          className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>
            {modpack.outputBlob
              ? `Install ${modpack.outputs?.length || 1} Pack${(modpack.outputs?.length || 1) === 1 ? '' : 's'} (.mcaddon)`
              : 'No File Stored'}
          </span>
        </button>
        <button type="button" onClick={onReinstall} className="w-full py-2.5 rounded-xl text-[11px] font-semibold text-purple-300 bg-[#110B24] border border-purple-500/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Reinstall / Update</span>
        </button>
      </div>
    </div>;
};