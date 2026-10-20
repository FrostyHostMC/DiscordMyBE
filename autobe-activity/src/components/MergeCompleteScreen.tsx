import React, { useState } from 'react';
import { MergedModpack, MergedOutput } from '@/types/modpack';

interface MergeCompleteScreenProps {
  modpack: MergedModpack;
  onInstallToMinecraft: () => void;
  onSaveToFiles: () => void;
  onShare: () => void;
  onDownloadOutput: (output: MergedOutput) => void;
  onDownloadManifest: () => void;
  onDone: () => void;
  onRename: (newName: string) => void;
}

const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const MergeCompleteScreen: React.FC<MergeCompleteScreenProps> = ({
  modpack,
  onInstallToMinecraft,
  onSaveToFiles,
  onShare,
  onDownloadOutput,
  onDownloadManifest,
  onDone,
  onRename
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(modpack.name);

  const outputs = modpack.outputs || [];
  const packCount = outputs.length;
  const canDownload = !!modpack.outputBlob;

  const handleSaveName = () => {
    if (nameVal.trim()) onRename(nameVal.trim());
    setIsEditingName(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-4 pb-8 overflow-y-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onDone}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-950/50 border border-purple-500/30 text-purple-200 active:scale-95"
            aria-label="Back to Home"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-bold text-white">Merge Complete</h1>
        </div>
      </div>

      {/* Success Hero */}
      <div className="flex flex-col items-center text-center mt-2 mb-3">
        <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-purple-600 via-indigo-600 to-purple-900 border-2 border-purple-400/80 flex items-center justify-center shadow-[0_0_40px_rgba(168,85,247,0.7)]">
          <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-300/40 flex items-center justify-center text-purple-300 shadow-inner">
            <svg className="w-7 h-7 text-purple-200 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <h2 className="text-xl font-extrabold text-white tracking-tight mt-3">
          Your Modpack is Ready!
        </h2>
        <p className="text-xs text-purple-300/90 mt-1">
          {packCount} pack{packCount === 1 ? '' : 's'} bundled into one file
        </p>
      </div>

      {/* Summary Card */}
      <div className="w-full p-4 rounded-2xl bg-[#0D091A] border border-purple-500/25 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-purple-500/15 gap-2">
          <span className="text-xs text-zinc-400 shrink-0">Modpack Name</span>
          {isEditingName ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                }}
                className="bg-purple-950/60 border border-purple-400/50 rounded px-2 py-0.5 text-xs text-white outline-none w-32"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveName}
                className="text-xs text-purple-300 font-bold px-1.5 py-0.5 bg-purple-900 rounded"
              >
                ✓
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="flex items-center gap-1 text-xs font-bold text-white hover:text-purple-300 transition-colors min-w-0"
            >
              <span className="truncate">{modpack.name}</span>
              <span className="text-purple-400 text-[10px] flex-shrink-0">✏️</span>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Source Addons</span>
          <span className="font-semibold text-white">{modpack.totalPacks}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Size</span>
          <span className="font-semibold text-white">{formatSize(modpack.size)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Version</span>
          <span className="font-semibold text-white">{modpack.version}</span>
        </div>
      </div>

      {/* The .mcaddon banner — the one file the user actually needs */}
      <div className="mt-3 p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/60 to-indigo-950/50 border border-purple-400/40">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-purple-600/30 border border-purple-400/40 flex items-center justify-center text-purple-200 flex-shrink-0">
            <svg className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white font-mono truncate">
              {modpack.outputFileName}
            </div>
            <div className="text-[10px] text-purple-300/80 leading-tight">
              Contains all {packCount} pack{packCount === 1 ? '' : 's'} — installs in one tap
            </div>
          </div>
        </div>
      </div>

      {/* Per-output list (secondary) */}
      {outputs.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-bold text-purple-300 text-left px-1 mb-1.5">
            Inside the .mcaddon
          </h3>
          <div className="space-y-2">
            {outputs.map((out) => (
              <button
                key={out.id}
                type="button"
                onClick={() => onDownloadOutput(out)}
                className="w-full p-3 rounded-xl bg-[#0D091A] border border-purple-500/25 flex items-center justify-between active:scale-[0.98] transition-transform text-left"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white truncate">{out.label}</span>
                  <span className="text-[10px] text-zinc-400 font-mono truncate">
                    {out.fileName} · {out.packCount} pack{out.packCount !== 1 ? 's' : ''} ·{' '}
                    {formatSize(out.size)}
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
          <p className="text-[10px] text-zinc-600 mt-1.5 px-1 leading-relaxed">
            Only need one of these? Tap a row to download that .mcpack on its own.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col gap-2.5 w-full mt-4">
        <button
          type="button"
          onClick={onInstallToMinecraft}
          disabled={!canDownload}
          className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>
            {canDownload
              ? `Install ${packCount} Pack${packCount === 1 ? '' : 's'} to Minecraft`
              : 'No File Stored'}
          </span>
        </button>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onSaveToFiles}
            disabled={!canDownload}
            className="py-3 rounded-xl font-semibold text-xs bg-[#110B24] text-purple-200 border border-purple-500/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform hover:border-purple-500/50 disabled:opacity-40"
          >
            <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>Save .mcaddon</span>
          </button>

          <button
            type="button"
            onClick={onShare}
            className="py-3 rounded-xl font-semibold text-xs bg-[#110B24] text-purple-200 border border-purple-500/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform hover:border-purple-500/50"
          >
            <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            <span>Share</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onDownloadManifest}
          className="py-2.5 rounded-xl text-[10px] font-semibold text-zinc-500 hover:text-purple-300 border border-transparent hover:border-purple-500/20 active:scale-[0.99]"
        >
          Download merge metadata (.json)
        </button>

        {!canDownload && (
          <p className="text-[10px] text-amber-300/80 text-center leading-relaxed">
            This entry has no stored archive. Re-create the merge to get a downloadable .mcaddon.
          </p>
        )}
      </div>
    </div>
  );
};