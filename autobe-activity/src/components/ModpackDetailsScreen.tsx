import React from 'react';
import {
  Boxes,
  HardDrive,
  Tag,
  AlertTriangle,
  Check,
  Download,
  Trash2,
  ArrowLeft,
  Calendar,
  Layers,
  ScrollText,
  Palette,
  Wand2
} from 'lucide-react';
import { MergedModpack, MergedOutput } from '@/types/modpack';
import {
  customizeMergedPackBlob,
  customizeSingleMcpackBlob,
  PackCustomization
} from '@/utils/packCustomization';
import { saveModpackToDB } from '@/utils/storage';
import { describeError } from '@/utils/errorLog';
import { PackCustomizeModal } from '@/components/PackCustomizeModal';

interface ModpackDetailsScreenProps {
  modpack: MergedModpack;
  onBack: () => void;
  onDelete: (id: string) => void;
  onDownloadOutput: (output: MergedOutput) => void;
  onReinstall: () => void;
  onUpdateModpack: (modpack: MergedModpack) => void;
}

export const ModpackDetailsScreen: React.FC<ModpackDetailsScreenProps> = ({
  modpack,
  onBack,
  onDelete,
  onDownloadOutput,
  onReinstall,
  onUpdateModpack
}) => {
  const [showCustomize, setShowCustomize] = React.useState(false);

  const handleApplyCustomization = async (custom: PackCustomization) => {
    let updated: MergedModpack = { ...modpack };
    if (modpack.outputBlob) {
      const newBlob = await customizeMergedPackBlob(modpack.outputBlob, custom);
      updated = {
        ...updated,
        outputBlob: newBlob,
        size: newBlob.size,
      };
    }
    updated = { ...updated, outputFileName: `${custom.name.replace(/\s+/g, '_')}.mcaddon` };
    if (updated.outputs && updated.outputs.length > 0) {
      const rewrittenOutputs = await Promise.all(
        updated.outputs.map(async (out) => {
          if (!out.blob) return out;
          try {
            const blob = await customizeSingleMcpackBlob(out.blob, custom);
            return { ...out, blob, size: blob.size };
          } catch (err) {
            console.error('[Aippy] Output rewrite failed:', describeError(err));
            return out;
          }
        })
      );
      updated = { ...updated, outputs: rewrittenOutputs };
    }
    updated = { ...updated, name: custom.name, description: custom.description };
    await saveModpackToDB(updated);
    onUpdateModpack(updated);
    setShowCustomize(false);
  };
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

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white">Project Inspector</h1>
            <p className="text-[11px] text-[#AAA3BB]">Consolidated Bedrock Addon Details</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomize(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#15111F] border border-[#762BFF]/40 text-[#A855F7] hover:bg-[#201A2E] text-xs font-semibold active:scale-95 transition-all"
            aria-label="Customize Pack"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Customize</span>
          </button>
          <button
            type="button"
            onClick={() => onDelete(modpack.id)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#15111F] border border-red-500/30 text-red-400 hover:bg-red-950/40 text-xs font-semibold active:scale-95 transition-all"
          aria-label="Delete Modpack"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Delete</span>
        </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 pb-28 max-w-3xl mx-auto w-full">
        {/* Project Header Card */}
        <div className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-[#15111F] border border-[#762BFF]/40 flex items-center justify-center shrink-0 overflow-hidden shadow-[0_0_15px_rgba(118,43,255,0.2)]">
            {modpack.iconDataUrl ? (
              <img src={modpack.iconDataUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Boxes className="w-7 h-7 text-[#A855F7]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-bold text-white truncate">{modpack.name}</h2>
            <p className="text-xs text-[#AAA3BB] mt-0.5 line-clamp-2">{modpack.description}</p>
            <div className="flex items-center gap-2 text-[10px] text-[#AAA3BB] font-mono mt-2">
              <span className="text-emerald-400 font-semibold">Valid Bedrock Output</span>
              <span>•</span>
              <span>Created {formatDate(modpack.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] text-center">
            <span className="text-[10px] text-[#AAA3BB] uppercase block font-bold">Addons</span>
            <span className="text-base font-bold text-white font-mono mt-0.5 block">
              {modpack.totalPacks}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] text-center">
            <span className="text-[10px] text-[#AAA3BB] uppercase block font-bold">Total Size</span>
            <span className="text-base font-bold text-white font-mono mt-0.5 block">
              {formatSize(modpack.size)}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] text-center">
            <span className="text-[10px] text-[#AAA3BB] uppercase block font-bold">Version</span>
            <span className="text-base font-bold text-white font-mono mt-0.5 block">
              v{modpack.version}
            </span>
          </div>
        </div>

        {/* Merged Outputs */}
        {modpack.outputs && modpack.outputs.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Output Packages
            </h3>
            <div className="space-y-2">
              {modpack.outputs.map((out) => (
                <div
                  key={out.id}
                  className="p-3 rounded-xl bg-[#100D18] border border-[#30263F] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0">
                      {out.type === 'resource' ? (
                        <Palette className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <ScrollText className="w-4 h-4 text-amber-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{out.label}</div>
                      <div className="text-[10px] text-[#AAA3BB] font-mono mt-0.5">
                        {out.fileName} • {formatSize(out.size)}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDownloadOutput(out)}
                    className="p-2 rounded-lg bg-[#15111F] hover:bg-[#201A2E] border border-[#30263F] text-white hover:text-[#A855F7] transition-colors shrink-0"
                    title="Download package"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Included Addons List */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Consolidated Addons ({modpack.includedPacks.length})
          </h3>
          <div className="space-y-1.5">
            {modpack.includedPacks.map((pack, i) => (
              <div
                key={i}
                className="p-2.5 rounded-lg bg-[#100D18] border border-[#30263F]/70 flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded bg-[#15111F] border border-[#30263F] flex items-center justify-center shrink-0 overflow-hidden">
                    {pack.iconDataUrl ? (
                      <img src={pack.iconDataUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Boxes className="w-3.5 h-3.5 text-[#AAA3BB]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-white truncate block">
                      {pack.name}
                    </span>
                    <span className="text-[10px] text-[#716885] font-mono">
                      {pack.type} • {pack.version}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Customize Merged Pack Modal */}
      {showCustomize && (
        <PackCustomizeModal
          modpack={modpack}
          onApply={handleApplyCustomization}
          onClose={() => setShowCustomize(false)}
        />
      )}

      {/* Floating Bottom Reinstall Action */}
      <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 bg-[#100D18]/95 backdrop-blur-md border-t border-[#30263F] z-20 flex justify-end max-w-3xl mx-auto">
        <button
          type="button"
          onClick={onReinstall}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span>Export Again (.mcaddon)</span>
        </button>
      </div>
    </div>
  );
};
