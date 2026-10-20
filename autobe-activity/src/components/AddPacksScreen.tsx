import React, { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import { AddonPack } from '@/types/modpack';
import { parseAddonArchive } from '@/utils/addonParser';

interface AddPacksScreenProps {
  installedPacks: AddonPack[];
  selectedPackIds: string[];
  onTogglePack: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onContinue: () => void;
  onImportPacks: (newPacks: AddonPack[]) => void;
  onBack: () => void;
}

type Tab = 'installed' | 'files' | 'folders';

/**
 * Zips a directory pick into one .mcpack per pack root.
 *
 * `webkitdirectory` hands us a flat FileList whose `webkitRelativePath` starts
 * with the chosen folder name. Treating each File as its own archive (which the
 * previous version did) always failed, because none of them is a zip.
 */
async function zipDirectorySelection(files: File[]): Promise<Array<{ blob: Blob; name: string }>> {
  interface Entry {
    path: string;
    root: string;
    file: File;
  }

  const entries: Entry[] = [];
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    // `parts[0]` is the wrapper folder the picker always includes.
    const root = parts[0] || '';
    entries.push({ path: rel, root, file: f });
  }

  const byRoot = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byRoot.get(e.root) || [];
    list.push(e);
    byRoot.set(e.root, list);
  }

  const out: Array<{ blob: Blob; name: string }> = [];

  for (const [root, list] of byRoot.entries()) {
    // Single level deep => the picked folder itself is one pack.
    const zip = new JSZip();
    let hasManifest = false;
    let depthBeyondRoot = 0;

    for (const e of list) {
      const rel = e.path.slice(root.length + 1);
      if (!rel) continue;
      if (/manifest\.json$/i.test(rel)) hasManifest = true;
      if (rel.split('/').length > 1) depthBeyondRoot++;
      // Flatten one wrapper level so the manifest ends up at the zip root.
      zip.file(rel, e.file);
    }

    if (!hasManifest && depthBeyondRoot > 0) {
      // The picked folder holds several packs: split them out.
      const subRoots = new Set<string>();
      for (const e of list) {
        const rel = e.path.slice(root.length + 1);
        const top = rel.split('/')[0];
        if (top) subRoots.add(top);
      }
      for (const sub of subRoots) {
        const subZip = new JSZip();
        let subManifest = false;
        for (const e of list) {
          const rel = e.path.slice(root.length + 1);
          if (!rel.startsWith(`${sub}/`)) continue;
          const inner = rel.slice(sub.length + 1);
          if (!inner) continue;
          if (/manifest\.json$/i.test(inner)) subManifest = true;
          subZip.file(inner, e.file);
        }
        if (subManifest) {
          out.push({
            blob: await subZip.generateAsync({ type: 'blob' }),
            name: `${root}__${sub}.mcpack`
          });
        }
      }
      continue;
    }

    if (!hasManifest) continue;
    out.push({ blob: await zip.generateAsync({ type: 'blob' }), name: `${root}.mcpack` });
  }

  return out;
}

export const AddPacksScreen: React.FC<AddPacksScreenProps> = ({
  installedPacks,
  selectedPackIds,
  onTogglePack,
  onSelectAll,
  onClearSelection,
  onContinue,
  onImportPacks,
  onBack
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('installed');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const allSelected =
    installedPacks.length > 0 && selectedPackIds.length === installedPacks.length;

  const finishImport = (allParsed: AddonPack[], errors: string[], label: string) => {
    if (allParsed.length > 0) {
      onImportPacks(allParsed);
      setImportStatus(`${label}: ${allParsed.length} pack${allParsed.length === 1 ? '' : 's'} ready.`);
      setActiveTab('installed');
    } else {
      setImportStatus(`No valid Bedrock addon manifests found in ${label}.`);
    }
    setImportErrors(errors.slice(0, 4));
    setIsImporting(false);
    setTimeout(() => setImportStatus(null), 5000);
  };

  const handleArchiveFiles = useCallback(
    async (files: File[], kind: 'archive' | 'folder') => {
      if (!files || files.length === 0) return;
      setIsImporting(true);
      setImportErrors([]);
      setImportStatus(
        kind === 'folder' ? `Reading ${files.length} files...` : `Analyzing ${files.length} file(s)...`
      );

      const allParsed: AddonPack[] = [];
      const allErrors: string[] = [];

      try {
        if (kind === 'folder') {
          const zipped = await zipDirectorySelection(files);
          if (zipped.length === 0) {
            finishImport([], ['No folder contained a manifest.json.'], 'Folder');
            return;
          }
          for (let i = 0; i < zipped.length; i++) {
            const z = zipped[i];
            setImportStatus(`Reading ${z.name} (${i + 1}/${zipped.length})…`);
            const res = await parseAddonArchive(z.blob, z.name);
            allParsed.push(...res.packs);
            allErrors.push(...res.errors);
          }
        } else {
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setImportStatus(`Parsing ${file.name} (${i + 1}/${files.length})…`);
            try {
              const res = await parseAddonArchive(file, file.name);
              allParsed.push(...res.packs);
              allErrors.push(...res.errors);
            } catch (err: any) {
              allErrors.push(`${file.name}: ${err?.message || err}`);
            }
          }
        }
      } catch (err: any) {
        allErrors.push(err?.message || String(err));
      }

      finishImport(allParsed, allErrors, kind === 'folder' ? 'Folder' : 'Files');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onImportPacks]
  );

  // `input.files` is a LIVE FileList: assigning `input.value = ''` clears it
  // (HTML spec -> "set the selected files to the empty list"), which silently
  // truncated multi-select imports to the first file. Snapshot into a real
  // array before resetting the input.
  const snapshotFiles = (input: HTMLInputElement): File[] =>
    input.files ? Array.from(input.files) : [];

  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = snapshotFiles(e.target);
    // Reset so re-picking the exact same file fires onChange again.
    e.target.value = '';
    handleArchiveFiles(files, 'archive');
  };

  const handleFolderChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = snapshotFiles(e.target);
    e.target.value = '';
    handleArchiveFiles(files, 'folder');
  };

  const tabButton = (tab: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
        activeTab === tab
          ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.4)]'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-purple-500/20 bg-[#0B0716]/90">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-950/50 border border-purple-500/30 text-purple-200 active:scale-95"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-white tracking-wide">Add Packs</h1>
        </div>

        {activeTab === 'installed' && installedPacks.length > 0 && (
          <button
            type="button"
            onClick={allSelected ? onClearSelection : onSelectAll}
            className="text-xs font-semibold text-purple-300 hover:text-purple-200 active:scale-95 transition-all"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="px-5 pt-3 pb-2">
        <div className="flex p-1 bg-[#120B24] rounded-xl border border-purple-500/20">
          {tabButton('installed', 'Installed')}
          {tabButton('files', 'Files')}
          {tabButton('folders', 'Folders')}
        </div>
      </div>

      {/* Hidden inputs */}
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
        // @ts-expect-error webkitdirectory is Chromium/Android only
        webkitdirectory="true"
        directory="true"
        onChange={handleFolderChosen}
        className="hidden"
      />

      {/* Status banner */}
      {importStatus && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-xl bg-purple-950/80 border border-purple-400/40 text-xs text-purple-200 flex items-center gap-2">
          {isImporting ? (
            <div className="w-3.5 h-3.5 border-2 border-purple-300 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          ) : (
            <span>✨</span>
          )}
          <span className="flex-1">{importStatus}</span>
        </div>
      )}
      {importErrors.length > 0 && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-[10px] text-amber-200 space-y-0.5">
          {importErrors.map((err, i) => (
            <div key={i} className="truncate">
              • {err}
            </div>
          ))}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5 pb-24">
        {activeTab === 'installed' && (
          <>
            {installedPacks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-400">
                <div className="w-16 h-16 rounded-2xl bg-purple-950/40 border border-purple-500/20 flex items-center justify-center text-2xl mb-3">
                  📦
                </div>
                <p className="text-sm font-semibold text-white">No addons installed</p>
                <p className="text-xs text-zinc-400 mt-1 max-w-xs">
                  Use the <span className="text-purple-300">Files</span> or{' '}
                  <span className="text-purple-300">Folders</span> tab to import .mcpack,
                  .mcaddon or .zip files.
                </p>
              </div>
            ) : (
              installedPacks.map((pack) => {
                const isSelected = selectedPackIds.includes(pack.id);
                return (
                  <div
                    key={pack.id}
                    onClick={() => onTogglePack(pack.id)}
                    className={`flex items-center justify-between gap-2 p-3 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-purple-950/40 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                        : 'bg-[#0D091A] border-purple-500/20 hover:border-purple-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all flex-shrink-0 ${
                          isSelected
                            ? 'bg-purple-600 border-purple-400 shadow-[0_0_8px_rgba(147,51,234,0.6)]'
                            : 'border-purple-400/40 bg-purple-950/30'
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3.5 h-3.5 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>

                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-purple-900/40 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                        {pack.iconDataUrl ? (
                          <img
                            src={pack.iconDataUrl}
                            alt={pack.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-lg">
                            {pack.type === 'Resource Pack' ? '🎨' : '⚙️'}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-white truncate max-w-[170px]">
                          {pack.name}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                          <span
                            className={
                              pack.type === 'Behavior Pack'
                                ? 'text-amber-400/90 font-medium'
                                : 'text-blue-400/90 font-medium'
                            }
                          >
                            {pack.type}
                          </span>
                          <span>•</span>
                          <span className="truncate">{pack.version}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {pack.isObfuscated ? (
                        <span
                          title="Contains closed-source / obfuscated JSON. Merging will corrupt the output."
                          className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-red-950/70 border border-red-500/50 text-red-300"
                        >
                          ⛔ Obfuscated
                        </span>
                      ) : pack.hasScripts ? (
                        <span
                          title="Contains scripts (may disable achievements)"
                          className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-amber-950/70 border border-amber-500/40 text-amber-300"
                        >
                          Scripts
                        </span>
                      ) : null}
                      {pack.scriptApiVersion && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-fuchsia-950/60 border border-fuchsia-500/40 text-fuchsia-300">
                          v{pack.scriptApiVersion}
                        </span>
                      )}
                      {!pack.scriptApiVersion && (pack.subpacks?.length || 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-sky-950/60 border border-sky-500/40 text-sky-300">
                          {pack.subpacks!.length} subpacks
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === 'files' && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-900/30 border border-purple-500/30 flex items-center justify-center text-3xl mb-4 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
              📄
            </div>
            <h3 className="text-base font-bold text-white">Import from Storage</h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs mb-6">
              Select one or multiple <span className="text-purple-300">.mcpack</span>,{' '}
              <span className="text-purple-300">.mcaddon</span>, or{' '}
              <span className="text-purple-300">.zip</span> files. Nested archives and .mcaddon
              bundles are unpacked automatically.
            </p>

            <button
              type="button"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-95 transition-transform disabled:opacity-50"
            >
              {isImporting ? 'Parsing Archives…' : 'Choose Files'}
            </button>
          </div>
        )}

        {activeTab === 'folders' && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-900/30 border border-purple-500/30 flex items-center justify-center text-3xl mb-4 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
              📁
            </div>
            <h3 className="text-base font-bold text-white">Import Folder</h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs mb-6">
              Pick an unzipped addon folder containing <span className="text-purple-300">manifest.json</span>,
              or a parent folder holding several of them. Each is detected and added separately.
            </p>

            <button
              type="button"
              disabled={isImporting}
              onClick={() => folderInputRef.current?.click()}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-95 transition-transform disabled:opacity-50"
            >
              {isImporting ? 'Reading Directory…' : 'Choose Folder'}
            </button>
          </div>
        )}
      </div>

      {/* Floating Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-[#090614]/95 backdrop-blur-lg border-t border-purple-500/20 z-20">
        <button
          type="button"
          disabled={selectedPackIds.length === 0}
          onClick={onContinue}
          className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
            selectedPackIds.length > 0
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-[0.98]'
              : 'bg-zinc-800/80 text-zinc-500 border border-zinc-700/50 cursor-not-allowed'
          }`}
        >
          <span>Continue ({selectedPackIds.length})</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};