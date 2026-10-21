import React from 'react';
import { X, Layers, ShieldAlert, ShieldCheck, FileCode, HardDrive, Hash, Calendar, Palette, ScrollText } from 'lucide-react';
import { AddonPack } from '@/types/modpack';

interface PackInspectorModalProps {
  pack: AddonPack | null;
  onClose: () => void;
}

export const PackInspectorModal: React.FC<PackInspectorModalProps> = ({ pack, onClose }) => {
  if (!pack) return null;

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl bg-[#100D18] border border-[#30263F] shadow-[0_10px_40px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#30263F]/70 bg-[#15111F]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#201A2E] border border-[#762BFF]/30 flex items-center justify-center shrink-0 overflow-hidden">
              {pack.iconDataUrl ? (
                <img src={pack.iconDataUrl} alt="" className="w-full h-full object-cover" />
              ) : pack.type === 'Resource Pack' ? (
                <Palette className="w-4 h-4 text-[#A855F7]" />
              ) : (
                <ScrollText className="w-4 h-4 text-[#762BFF]" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{pack.name}</h3>
              <div className="flex items-center gap-2 text-[11px] text-[#AAA3BB]">
                <span className={pack.type === 'Behavior Pack' ? 'text-amber-400 font-semibold' : 'text-blue-400 font-semibold'}>
                  {pack.type}
                </span>
                <span>•</span>
                <span>{pack.version}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#AAA3BB] hover:text-white hover:bg-[#201A2E] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable details */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Status Banner */}
          {pack.hasScripts ? (
            <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-xs text-red-200 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Script API Detected:</span> This pack uses @minecraft/server scripts. Xbox achievements will be disabled in the merged world.
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Pure Data / Resources:</span> No scripts detected. Safe for worlds with Xbox achievements enabled.
              </div>
            </div>
          )}

          {/* Description */}
          {pack.description && (
            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="text-[10px] font-bold text-[#AAA3BB] uppercase tracking-wider mb-1">Description</div>
              <p className="text-xs text-[#F7F5FC] leading-relaxed">{pack.description}</p>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#AAA3BB] uppercase mb-1">
                <Hash className="w-3 h-3 text-[#A855F7]" />
                UUID
              </div>
              <div className="text-[11px] font-mono text-white truncate" title={pack.uuid}>
                {pack.uuid}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#AAA3BB] uppercase mb-1">
                <HardDrive className="w-3 h-3 text-[#A855F7]" />
                File Size
              </div>
              <div className="text-[11px] font-mono text-white font-semibold">
                {formatSize(pack.fileSize)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#AAA3BB] uppercase mb-1">
                <Layers className="w-3 h-3 text-[#A855F7]" />
                Target Engine
              </div>
              <div className="text-[11px] font-mono text-white font-semibold">
                {pack.minEngineVersion || '1.20.0'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#AAA3BB] uppercase mb-1">
                <Calendar className="w-3 h-3 text-[#A855F7]" />
                Date Added
              </div>
              <div className="text-[11px] font-mono text-white font-semibold">
                {formatDate(pack.dateAdded)}
              </div>
            </div>
          </div>

          {/* Script Details if applicable */}
          {pack.hasScripts && (
            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#AAA3BB] uppercase mb-1.5">
                <FileCode className="w-3 h-3 text-[#A855F7]" />
                Script API Specifications
              </div>
              <div className="text-xs font-mono text-purple-300 bg-[#100D18] p-2 rounded-lg border border-[#30263F]">
                {pack.scriptVersion || '@minecraft/server runtime module'}
              </div>
            </div>
          )}

          {/* Subpacks if present */}
          {pack.subpacks && pack.subpacks.length > 0 && (
            <div className="p-3 rounded-xl bg-[#15111F] border border-[#30263F]/70">
              <div className="text-[10px] font-bold text-[#AAA3BB] uppercase mb-2">Subpacks ({pack.subpacks.length})</div>
              <div className="space-y-1">
                {pack.subpacks.map((s, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-[#30263F]/40 last:border-0">
                    <span className="text-white font-medium">{s.name}</span>
                    <span className="font-mono text-[10px] text-[#AAA3BB]">{s.folder}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#30263F]/70 bg-[#15111F] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-white text-xs font-bold transition-all active:scale-95"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};