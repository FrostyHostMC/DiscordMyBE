import React, { useState, useRef } from 'react';
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
  Loader2,
  Image as ImageIcon,
  X
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
  onPublish?: (iconDataUrl?: string | null) => void | string | Promise<void | string>;
  isPublishing?: boolean;
  activeTransfer?: 'publish' | 'install' | 'download' | null;
  transferProgress?: number;
  transferStatus?: string;
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
  isPublishing = false,
  activeTransfer = null,
  transferProgress = 0,
  transferStatus = ''
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(modpack.name);
  const [showPublishOptions, setShowPublishOptions] = useState(false);
  const [publishIcon, setPublishIcon] = useState<string | null>(null);
  const [publishIconName, setPublishIconName] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);
  const publishIconInput = useRef<HTMLInputElement>(null);

  const handlePublishIcon = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setPublishError('Choose a PNG, JPG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPublishError('Choose an image smaller than 5 MB. It will be resized for the community listing.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setPublishError('Could not read this image. Try another file.');
        return;
      }
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 256 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          setPublishError('Could not process this image. Try another file.');
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let result = canvas.toDataURL('image/jpeg', 0.78);
        if (result.length > 95_000) result = canvas.toDataURL('image/jpeg', 0.55);
        if (result.length > 100_000) {
          setPublishError('This image could not be compressed enough. Try a simpler image.');
          return;
        }
        setPublishIcon(result);
        setPublishIconName(file.name);
        setPublishError(null);
      };
      image.onerror = () => setPublishError('Could not decode this image. Try another file.');
      image.src = reader.result;
    };
    reader.onerror = () => setPublishError('Could not read this image. Try another file.');
    reader.readAsDataURL(file);
  };

  // Unresolved collisions need attention before the combined add-on can be
  // expected to preserve every feature. Backups are not active definitions.
  let reviewFindings: Array<{ code: string; path: string; message: string }> = [];
  try {
    const report = JSON.parse(modpack.combinedExtras?.reportJson || '{}');
    const reviewCodes = new Set(['DEFINITION_CONFLICT', 'FILE_PATH_CONFLICT', 'SHARED_FILE_CONFLICT', 'CROSS_GROUP_PLAYER_CONFLICT', 'SCRIPT_DEPENDENCY_CONFLICT', 'PACKED_ARCHIVE_NOT_SCANNED']);
    reviewFindings = (report.findings || []).filter((finding: any) => reviewCodes.has(finding.code));
  } catch { /* Older saved projects may not include a report. */ }

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
    <div className="flex flex-col flex-1 min-h-0 bg-[#08070D] text-white select-none overflow-y-auto overscroll-contain px-4 sm:px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] max-w-2xl mx-auto w-full" style={{ WebkitOverflowScrolling: "touch" }}>
      {/* Top Bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between pb-3 pt-1 border-b border-[#30263F]/70 bg-[#08070D]/95 backdrop-blur-sm">
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
          <span>{reviewFindings.length ? 'Review Required' : 'Merge Complete'}</span>
        </span>
      </div>

      {/* Hero Badge */}
      <div className="flex flex-col items-center text-center my-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#762BFF] to-[#4F13C4] border border-[#A855F7] flex items-center justify-center shadow-[0_0_30px_rgba(118,43,255,0.4)] mb-3">
          <CheckCircle2 className="w-8 h-8 text-white stroke-[2.5]" />
        </div>
        <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
          {reviewFindings.length ? 'Pack created with conflicts' : 'Packs Consolidated'}
        </h2>
        <p className="text-xs text-[#AAA3BB] mt-1 max-w-sm">
          Combined {modpack.totalPacks} add-on packs and preserved files wherever possible.
        </p>
      </div>

      {reviewFindings.length > 0 && (
        <div role="alert" className="p-4 rounded-xl bg-amber-950/30 border border-amber-600/70 text-amber-100 mb-4 text-xs space-y-2">
          <div className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {reviewFindings.length} conflict(s) need review</div>
          <p>Some add-on features may be missing or overridden until these conflicts are resolved.</p>
          {reviewFindings.some(finding => ['DEFINITION_CONFLICT', 'FILE_PATH_CONFLICT', 'SHARED_FILE_CONFLICT'].includes(finding.code)) && <p>Alternatives saved under <span className="font-mono">_autobe_conflicts/</span> are not active in Minecraft.</p>}
          <ul className="list-disc pl-5 space-y-1">{reviewFindings.slice(0, 3).map((finding, index) => <li key={index}>{finding.path || finding.code}</li>)}</ul>
          <p>Open <span className="font-mono">_autobe_diagnostics.txt</span> in the combined bundle for details.</p>
        </div>
      )}

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
            {modpack.generateSeparatePacks === false ? 'Individual .mcpack downloads are disabled for this project.' : 'Tap any output to download individual .mcpack'}
          </span>
        </div>

        {/* Combined .mcaddon Main Card */}
        {modpack.generateAddon !== false && <div className="p-3.5 rounded-xl bg-[#15111F] border border-[#762BFF]/60 flex items-center justify-between gap-3 shadow-[0_0_15px_rgba(118,43,255,0.15)]">
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


        </div>}

        {/* Individual Outputs List (.mcpack) */}
        {modpack.generateSeparatePacks !== false && modpack.outputs && modpack.outputs.length > 0 && (
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
                      disabled={activeTransfer !== null}
                      className="p-2 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-white hover:text-[#A855F7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="flex flex-col sm:flex-row gap-2.5 pb-2">
        {modpack.generateAddon !== false && <button
          type="button"
          onClick={onInstallToMinecraft}
          disabled={activeTransfer !== null}
          aria-label={activeTransfer === 'install' ? `${transferStatus} ${transferProgress}%` : 'Install Modpack'}
          className="relative overflow-hidden flex-1 min-w-0 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm bg-[#762BFF] hover:bg-[#853CFF] text-white shadow-[0_0_20px_rgba(118,43,255,0.4)] border border-[#A855F7]/40 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait transition-colors"
        >
          <span className="relative z-10 flex items-center justify-center gap-2 min-w-0">
            {activeTransfer === 'install' ? <><Loader2 className="w-4 h-4 shrink-0 animate-spin" /><span className="truncate">{transferStatus || 'Installing'}...</span></> : <><Download className="w-4 h-4 shrink-0" /><span>Install Modpack</span></>}
          </span>
        </button>}

        {modpack.generateAddon !== false && onPublish && (
          <button
            type="button"
            onClick={() => setShowPublishOptions(true)}
            disabled={activeTransfer !== null}
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
          disabled={activeTransfer !== null}
          className="py-3 px-4 rounded-xl font-semibold text-xs bg-[#100D18] hover:bg-[#15111F] text-[#AAA3BB] hover:text-white border border-[#30263F] flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Share2 className="w-4 h-4 text-[#A855F7]" />
          <span>Share / Save</span>
        </button>
      {showPublishOptions && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#08070D]/95 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[#100D18] border border-[#10B981]/40 shadow-2xl p-5 space-y-4 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">Publish to Community</h3>
                <p className="text-xs text-[#AAA3BB] mt-1">Add a cover image for the public listing. This does not change your saved project.</p>
              </div>
              <button type="button" disabled={isPublishing} onClick={() => setShowPublishOptions(false)} className="p-1.5 text-[#AAA3BB] hover:text-white disabled:opacity-40" aria-label="Close publish options"><X className="w-4 h-4" /></button>
            </div>
            <input ref={publishIconInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePublishIcon} className="hidden" />
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-xl border border-[#30263F] bg-[#15111F] overflow-hidden flex items-center justify-center shrink-0">
                {publishIcon ? <img src={publishIcon} alt="Community cover preview" className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-[#716885]" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-semibold">{publishIconName || 'Optional cover image'}</p>
                <p className="text-[11px] text-[#AAA3BB] mt-1">PNG, JPG, or WebP · resized for a small listing image</p>
                <button type="button" onClick={() => publishIconInput.current?.click()} className="mt-2 px-3 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-xs font-semibold text-white hover:border-[#10B981]">
                  {publishIcon ? 'Change image' : 'Choose image'}
                </button>
                {publishIcon && <button type="button" onClick={() => { setPublishIcon(null); setPublishIconName(''); }} className="ml-2 text-xs text-[#AAA3BB] hover:text-white">Remove</button>}
              </div>
            </div>
            {publishError && <p className="text-xs text-red-400">{publishError}</p>}
            <div className="flex gap-2">
              <button type="button" disabled={isPublishing} onClick={() => setShowPublishOptions(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-[#15111F] border border-[#30263F] text-xs font-semibold text-[#AAA3BB] disabled:opacity-40">Cancel</button>
              <button type="button" disabled={activeTransfer !== null} onClick={async () => { setPublishError(null); const result = await onPublish?.(publishIcon); if (typeof result === 'string' && result) setPublishError(result); }} className="relative overflow-hidden flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-[#10B981] hover:bg-[#059669] text-xs font-bold text-white disabled:opacity-70 disabled:cursor-wait inline-flex items-center justify-center gap-2 whitespace-nowrap">
                {activeTransfer === 'publish' && <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-emerald-300/50 transition-[width] duration-200" style={{ width: `${transferProgress}%` }} />}
                <span className="relative z-10 inline-flex items-center justify-center gap-2 min-w-0">
                  {activeTransfer === 'publish' ? <><Loader2 className="w-4 h-4 shrink-0 animate-spin" /><span className="truncate">{transferStatus || 'Publishing'} {transferProgress}%</span></> : <span>Publish modpack</span>}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};