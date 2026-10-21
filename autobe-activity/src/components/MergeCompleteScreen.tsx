import React, { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Share2,
  Check,
  Pencil,
  AlertTriangle,
  ArrowLeft,
  FileArchive,
  Layers,
  ScrollText,
  Palette,
  Globe,
  Loader2
} from 'lucide-react';
import { MergedModpack, MergedOutput } from '@/types/modpack';

interface MergeCompleteScreenProps {
  modpack: MergedModpack;
  onInstallToMinecraft: () => void;
  onSaveToFiles: () => void;
  onShare: () => void;
  onDownloadOutput: (output: MergedOutput) => void;
  onDone: () => void;
  onRename: (newName: string) => void;
  onPublish?: () => void;
  isPublishing?: boolean;
}

export const MergeCompleteScreen: React.FC<MergeCompleteScreenProps> = ({
  modpack,
  onInstallToMinecraft,
  onSaveToFiles,
  onShare,
  onDownloadOutput,
  onDone,
  onRename,
  onPublish,
  isPublishing = false
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(modpack.name);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const handleSaveName = () => {
    if (nameVal.trim()) {
      onRename(nameVal.trim());
    }
    setIsEditingName(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-y-auto px-4 sm:px-6 pt-5 pb-24 max-w-2xl mx-auto w-full">
      {/* Top Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-[#30263F]/70">
        <button
          type="button"
          onClick={onDone}
          className="flex items-center gap-1.5 text-xs text-[#AAA3BB] hover:text-white px-2 py-1 rounded-lg hover:bg-[#15111F] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Projects</span>
        </button>
        <span className="text-xs font-mono text-emerald-400 font-semibold flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Merge Successful</span>
        </span>
      </div>

      {/* Hero Badge */}
      <div className="flex flex-col items-center text-center my-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#762BFF] to-[#4F13C4] border border-[#A855F7] flex items-center justify-center shadow-[0_0_30px_rgba(118,43,255,0.4)] mb-3">
          <CheckCircle2 className="w-8 h-8 text-white stroke-[2.5]" />
        </div>
        <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
          Packs Consolidated Successfully
        </h2>
        <p className="text-xs text-[#AAA3BB] mt-1 max-w-sm">
          Merged {modpack.totalPacks} addons with automatic manifest, UUID and namespace resolution.
        </p>
      </div>

      {/* Summary Card */}
      <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3 mb-4">
        {/* Project Name row */}
        <div className="flex items-center justify-between pb-2 border-b border-[#30263F]/50">
          <span className="text-xs text-[#AAA3BB]">Modpack Name</span>
          {isEditingName ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                className="bg-[#15111F] border border-[#762BFF] rounded px-2 py-0.5 text-xs text-white outline-none w-48 font-bold"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveName}
                className="p-1 rounded bg-[#762BFF] text-white"
                aria-label="Save Name"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="flex items-center gap-1.5 text-xs font-bold text-white hover:text-[#A855F7] transition-colors"
            >
              <span>{modpack.name}</span>
              <Pencil className="w-3 h-3 text-[#AAA3BB]" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-[10px] text-[#AAA3BB] uppercase block font-bold">Total Addons</span>
            <span className="font-mono font-bold text-white mt-0.5 block">{modpack.totalPacks}</span>
          </div>
          <div>
            <span className="text-[10px] text-[#AAA3BB] uppercase block font-bold">Archive Size</span>
            <span className="font-mono font-bold text-white mt-0.5 block">{formatSize(modpack.size)}</span>
          </div>
          <div>
            <span className="text-[10px] text-[#AAA3BB] uppercase block font-bold">Format Version</span>
            <span className="font-mono font-bold text-white mt-0.5 block">v{modpack.version}</span>
          </div>
        </div>
      </div>

      {/* Generated Outputs Section (Section 9: Consolidated BP, RP, Combined .mcaddon) */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between text-xs px-1">
          <span className="font-bold text-white uppercase tracking-wider text-[11px]">
            Generated Outputs
          </span>
          <span className="text-[#AAA3BB] text-[10px]">
            Tap any output to download individual .mcpack
          </span>
        </div>

        {/* Combined .mcaddon Main Card */}
        <div className="p-3.5 rounded-xl bg-[#15111F] border border-[#762BFF]/60 flex items-center justify-between gap-3 shadow-[0_0_15px_rgba(118,43,255,0.15)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[#762BFF]/20 border border-[#762BFF]/40 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5 text-[#A855F7]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white truncate">Combined Addon Bundle</span>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-purple-950 border border-purple-500/40 text-purple-300">
                  .MCADDON
                </span>
              </div>
              <span className="text-[10px] text-[#AAA3BB] font-mono truncate block mt-0.5">
                {modpack.outputFileName} • {formatSize(modpack.size)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onInstallToMinecraft}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white transition-all shadow-[0_0_10px_rgba(118,43,255,0.3)] active:scale-95 shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>

        {/* Individual Outputs List (.mcpack) */}
        {modpack.outputs && modpack.outputs.length > 0 && (
          <div className="space-y-2 pt-1">
            {modpack.outputs.map((out) => {
              const isResource = out.type === 'resource';
              return (
                <div
                  key={out.id}
                  className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0">
                      {isResource ? (
                        <Palette className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <ScrollText className="w-4 h-4 text-amber-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">{out.label}</span>
                        <span className="text-[9px] font-mono text-[#AAA3BB]">.MCPACK</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[#AAA3BB] font-mono mt-0.5">
                        <span>{out.fileName}</span>
                        <span>•</span>
                        <span>{formatSize(out.size)}</span>
                        <span>•</span>
                        <span>{out.packCount} pack{out.packCount !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {out.achievementsDisabled ? (
                      <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded bg-red-950/40 border border-red-500/30 text-red-300">
                        <AlertTriangle className="w-2.5 h-2.5" /> Scripts
                      </span>
                    ) : (
                      <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">
                        <Check className="w-2.5 h-2.5" /> Clean
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onDownloadOutput(out)}
                      className="p-2 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-white hover:text-[#A855F7] transition-colors"
                      title={`Download ${out.fileName}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <button
          type="button"
          onClick={onInstallToMinecraft}
          className="flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-[#762BFF] hover:bg-[#853CFF] text-white shadow-[0_0_20px_rgba(118,43,255,0.4)] border border-[#A855F7]/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Download className="w-4 h-4" />
          <span>Install to Minecraft (.mcaddon)</span>
        </button>

        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            disabled={isPublishing}
            className="py-3 px-4 rounded-xl font-semibold text-xs bg-[#10B981] hover:bg-[#059669] text-white border border-[#34D399]/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPublishing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Publishing...</span>
              </>
            ) : (
              <>
                <Globe className="w-4 h-4" />
                <span>Publish to Community</span>
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onShare}
          className="py-3 px-4 rounded-xl font-semibold text-xs bg-[#100D18] hover:bg-[#15111F] text-[#AAA3BB] hover:text-white border border-[#30263F] flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
        >
          <Share2 className="w-4 h-4 text-[#A855F7]" />
          <span>Share / Save</span>
        </button>
      </div>
    </div>
  );
};