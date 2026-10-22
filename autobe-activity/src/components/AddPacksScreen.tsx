import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  ScrollText,
  Palette,
  Check,
  FolderOpen,
  ArrowLeft,
  ArrowRight,
  Package,
  Trash2
} from 'lucide-react';
import { AddonPack } from '@/types/modpack';
import { parseAddonArchive } from '@/utils/addonParser';

interface AddPacksScreenProps {
  installedPacks: AddonPack[];
  selectedPackIds: string[];
  onTogglePack: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteAll: () => void;
  onContinue: () => void;
  onImportPacks: (newPacks: AddonPack[]) => Promise<number> | void;
  onBack: () => void;
}

export const AddPacksScreen: React.FC<AddPacksScreenProps> = ({
  installedPacks,
  selectedPackIds,
  onTogglePack,
  onSelectAll,
  onClearSelection,
  onDeleteAll,
  onContinue,
  onImportPacks,
  onBack
}) => {
  const [activeTab, setActiveTab] = useState<'installed' | 'files' | 'folders'>('installed');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const allSelected =
    installedPacks.length > 0 && selectedPackIds.length === installedPacks.length;

  const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Reset so choosing the same file again (e.g. after deleting it) still triggers onChange.
    e.target.value = '';
    if (files.length === 0) return;
    setIsImporting(true);
    setImportStatus(`Analyzing ${files.length} archive(s)...`);
    const allParsed: AddonPack[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setImportStatus(`Parsing ${file.name}...`);
      try {
        const res = await parseAddonArchive(file, file.name);
        allParsed.push(...res.packs);
      } catch (err) {
        console.error('Import error:', err);
      }
    }

    if (allParsed.length > 0) {
      setImportStatus(`Saving ${allParsed.length} pack(s)...`);
      let saved = allParsed.length;
      try {
        const result = await onImportPacks(allParsed);
        if (typeof result === 'number') saved = result;
      } catch (err) {
        console.error('Import save error:', err);
        saved = 0;
      }
      if (saved > 0) {
        setImportStatus(`Imported ${saved} pack(s) successfully!`);
        setActiveTab('installed');
      } else {
        setImportStatus('Nothing new was saved (duplicates, or a storage error — see the message above).');
      }
    } else {
      setImportStatus('No valid Bedrock addon manifests found.');
    }
    setIsImporting(false);
    setTimeout(() => setImportStatus(null), 3500);
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mcpack,.mcaddon,.zip"
        onChange={handleFilesChosen}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory support
        webkitdirectory="true"
        directory="true"
        onChange={handleFilesChosen}
        className="hidden"
      />

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
          <h1 className="text-sm sm:text-base font-bold text-white tracking-wide">
            Select Addons for Merge
          </h1>
        </div>

        {activeTab === 'installed' && installedPacks.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={allSelected ? onClearSelection : onSelectAll}
              className="text-xs font-semibold text-[#A855F7] hover:text-[#C9A9FF] active:scale-95 transition-all"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            {allSelected && (
              <button
                type="button"
                onClick={onDeleteAll}
                className="text-xs font-semibold text-red-400 hover:text-red-300 active:scale-95 transition-all flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="px-4 sm:px-6 pt-3 pb-2 bg-[#100D18]/50 border-b border-[#30263F]/50">
        <div className="flex p-0.5 bg-[#15111F] rounded-lg border border-[#30263F] max-w-sm">
          <button
            type="button"
            onClick={() => setActiveTab('installed')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'installed'
                ? 'bg-[#762BFF] text-white shadow-[0_0_10px_rgba(118,43,255,0.4)]'
                : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            Installed ({installedPacks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'files'
                ? 'bg-[#762BFF] text-white shadow-[0_0_10px_rgba(118,43,255,0.4)]'
                : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            Import Files
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'folders'
                ? 'bg-[#762BFF] text-white shadow-[0_0_10px_rgba(118,43,255,0.4)]'
                : 'text-[#AAA3BB] hover:text-white'
            }`}
          >
            Import Folder
          </button>
        </div>
      </div>

      {/* Status banner */}
      {importStatus && (
        <div className="mx-4 sm:mx-6 mt-3 px-3.5 py-2 rounded-xl bg-[#15111F] border border-[#762BFF]/40 text-xs text-purple-200 flex items-center gap-2">
          {isImporting && (
            <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          )}
          <span>{importStatus}</span>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2.5 pb-28 max-w-3xl mx-auto w-full">
        {activeTab === 'installed' && (
          <>
            {installedPacks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-[#AAA3BB]">
                <Package className="w-12 h-12 text-[#30263F] mb-3" />
                <p className="text-sm font-semibold text-white">No addons loaded yet</p>
                <p className="text-xs text-[#AAA3BB] mt-1 max-w-xs">
                  Switch to the "Import Files" tab to select .mcpack, .mcaddon or .zip files.
                </p>
              </div>
            ) : (
              installedPacks.map((pack) => {
                const isSelected = selectedPackIds.includes(pack.id);
                const isBp = pack.type === 'Behavior Pack';
                return (
                  <div
                    key={pack.id}
                    onClick={() => onTogglePack(pack.id)}
                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#15111F] border-[#762BFF]/60 shadow-[0_0_15px_rgba(118,43,255,0.15)]'
                        : 'bg-[#100D18] border-[#30263F] hover:border-[#30263F]/90'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Checkbox */}
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all shrink-0 ${
                          isSelected
                            ? 'bg-[#762BFF] border-[#A855F7] shadow-[0_0_8px_rgba(118,43,255,0.6)] text-white'
                            : 'border-[#30263F] bg-[#08070D]'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                      </div>

                      {/* Icon */}
                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#08070D] border border-[#30263F] flex items-center justify-center shrink-0">
                        {pack.iconDataUrl ? (
                          <img src={pack.iconDataUrl} alt="" className="w-full h-full object-cover" />
                        ) : isBp ? (
                          <ScrollText className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Palette className="w-4 h-4 text-indigo-400" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0">
                        <span className="text-xs sm:text-sm font-bold text-white truncate block">
                          {pack.name}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-[#AAA3BB] font-mono mt-0.5">
                          <span className={isBp ? 'text-amber-300 font-semibold' : 'text-indigo-300 font-semibold'}>
                            {pack.type}
                          </span>
                          <span>•</span>
                          <span>{pack.version}</span>
                          <span>•</span>
                          <span>{formatSize(pack.fileSize)}</span>
                        </div>
                      </div>
                    </div>

                    {pack.hasScripts && (
                      <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-red-950/50 border border-red-500/30 text-red-300 shrink-0">
                        Scripts
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === 'files' && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#15111F] border border-[#30263F] flex items-center justify-center mb-4">
              <UploadCloud className="w-7 h-7 text-[#A855F7]" />
            </div>
            <h3 className="text-base font-bold text-white">Import Addon Archives</h3>
            <p className="text-xs text-[#AAA3BB] mt-1 max-w-xs mb-6">
              Pick one or multiple <span className="text-purple-300 font-mono">.mcpack</span>, <span className="text-purple-300 font-mono">.mcaddon</span>, or <span className="text-purple-300 font-mono">.zip</span> archives from your device.
            </p>

            <button
              type="button"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-[#762BFF] hover:bg-[#853CFF] rounded-xl font-bold text-xs sm:text-sm text-white shadow-[0_0_20px_rgba(118,43,255,0.4)] border border-[#A855F7]/40 active:scale-95 transition-all"
            >
              {isImporting ? 'Parsing Archives...' : 'Choose Files'}
            </button>
          </div>
        )}

        {activeTab === 'folders' && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#15111F] border border-[#30263F] flex items-center justify-center mb-4">
              <FolderOpen className="w-7 h-7 text-[#A855F7]" />
            </div>
            <h3 className="text-base font-bold text-white">Import Folder</h3>
            <p className="text-xs text-[#AAA3BB] mt-1 max-w-xs mb-6">
              Select an unzipped addon directory containing <span className="text-purple-300 font-mono">manifest.json</span>.
            </p>

            <button
              type="button"
              disabled={isImporting}
              onClick={() => folderInputRef.current?.click()}
              className="px-6 py-3 bg-[#762BFF] hover:bg-[#853CFF] rounded-xl font-bold text-xs sm:text-sm text-white shadow-[0_0_20px_rgba(118,43,255,0.4)] border border-[#A855F7]/40 active:scale-95 transition-all"
            >
              {isImporting ? 'Reading Directory...' : 'Choose Folder'}
            </button>
          </div>
        )}
      </div>

      {/* Floating Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 bg-[#100D18]/95 backdrop-blur-md border-t border-[#30263F] z-20 flex justify-between items-center max-w-3xl mx-auto">
        <span className="text-xs text-[#AAA3BB] font-mono">
          {selectedPackIds.length} pack{selectedPackIds.length !== 1 ? 's' : ''} selected
        </span>

        <button
          type="button"
          disabled={selectedPackIds.length === 0}
          onClick={onContinue}
          className="px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 transition-all bg-[#762BFF] hover:bg-[#853CFF] disabled:opacity-40 text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95"
        >
          <span>Continue to Analysis</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};