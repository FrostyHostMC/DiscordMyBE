import React, { useRef, useState } from 'react';
import JSZip from 'jszip';
import { downloadBlob } from '@/utils/codebaseExport';
import { findValidPacksInArchive, describeArchive } from '@/utils/packValidator';

interface PackExtractToolProps {
  onBack: () => void;
}

interface ExtractReport {
  fileCount: number;
  packs: Array<{ name: string; type: string; version: string }>;
  fileName: string;
  entries: Array<{ path: string; size: number }>;
}

/**
 * MCPACKER equivalent for the web.
 *
 * Pack mode mirrors `find_valid_packs` + `zip_pack_folder`: a chosen directory
 * is validated and zipped into a real .mcpack (this time it actually emits the
 * manifest check instead of silently producing an archive nobody can import).
 * Extract mode really does unpack an archive and hand it back as a .zip, which
 * is the closest equivalent of the desktop version writing folders to disk.
 */
export const PackExtractTool: React.FC<PackExtractToolProps> = ({ onBack }) => {
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [report, setReport] = useState<ExtractReport | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const archiveRef = useRef<HTMLInputElement>(null);

  const handlePackFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Snapshot before resetting: `input.files` is live and `value = ''` clears it.
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    setProcessing(true);
    setReport(null);
    setStatus(`Scanning ${files.length} files…`);

    try {
      const zip = new JSZip();
      let manifestCount = 0;
      let packIconCount = 0;
      const roots = new Set<string>();

      for (const f of files) {
        const raw = f.webkitRelativePath || f.name;
        const parts = raw.split('/');
        // Drop the wrapper folder that `webkitdirectory` always includes.
        const rel = parts.length > 1 ? parts.slice(1).join('/') : f.name;
        if (!rel) continue;
        roots.add(parts.length > 1 ? parts[0] : '');
        if (/manifest\.json$/i.test(rel)) manifestCount++;
        if (/^pack_icon\.(png|jpe?g)$/i.test(rel.split('/').pop() || '')) packIconCount++;
        zip.file(rel, f);
      }

      if (manifestCount === 0) {
        setStatus(
          '✗ No manifest.json found in the selected folder — Minecraft will not import this. Pick the folder that directly contains manifest.json.'
        );
        setProcessing(false);
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const name =
        manifestCount === 1 && roots.size === 1
          ? `${[...roots][0] || 'Addon'}.mcpack`
          : `Packed_${manifestCount}_Addons.mcpack`;

      downloadBlob(blob, name);
      setStatus(
        `✓ Packed ${manifestCount} manifest${manifestCount === 1 ? '' : 's'} and ${
          packIconCount
        } pack_icon file${packIconCount === 1 ? '' : 's'} → ${name} (${(
          blob.size / (1024 * 1024)
        ).toFixed(2)} MB)`
      );
    } catch (err: any) {
      setStatus(`Error packing: ${err?.message || err}`);
    }
    setProcessing(false);
  };

  const handleExtractArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProcessing(true);
    setReport(null);
    setStatus(`Inspecting ${file.name}…`);

    try {
      const zip = await JSZip.loadAsync(file);
      const info = await describeArchive(file);
      const entries = Object.values(zip.files)
        .filter((f) => !f.dir)
        .map((f) => ({ path: f.name, size: (f as any)._data?.uncompressedSize ?? 0 }))
        .sort((a, b) => a.path.localeCompare(b.path));

      setReport({
        fileCount: info.fileCount,
        packs: info.packs,
        fileName: file.name,
        entries: entries.slice(0, 60)
      });
      setStatus(`✓ ${info.fileCount} files · ${info.packs.length} pack manifest(s) detected`);

      // Offer the nested-pack repack path (mirrors the desktop extract mode).
      const nestedPacks = await findValidPacksInArchive(file, file.name);
      if (nestedPacks.length > 1) {
        setStatus(
          `✓ ${info.fileCount} files · ${nestedPacks.length} nested packs found. Use "Export Unpacked" to download them separately.`
        );
      }
    } catch (err: any) {
      setStatus(`Error reading archive: ${err?.message || err}`);
    }
    setProcessing(false);
  };

  const exportUnpacked = async () => {
    if (!report) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mcpack,.mcaddon,.zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const zip = await JSZip.loadAsync(file);
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(
          blob,
          `${report.fileName.replace(/\.(mcpack|mcaddon|zip)$/i, '')}_unpacked.zip`
        );
      } catch (err: any) {
        setStatus(`Error exporting: ${err?.message || err}`);
      }
    };
    input.click();
  };

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-3 pb-24 overflow-y-auto">
      <div className="flex items-center gap-3 mb-6">
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
        <h1 className="text-lg font-bold text-white">Pack &amp; Extract Tool</h1>
      </div>

      <div className="space-y-4">
        {/* Tool 1: Folder -> .mcpack */}
        <div className="p-4 rounded-2xl bg-[#0D091A] border border-purple-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📦</span>
            <h2 className="text-sm font-bold text-white">Convert Folder to .mcpack</h2>
          </div>
          <p className="text-xs text-zinc-400">
            Select the unzipped addon folder (the one that directly contains{' '}
            <span className="text-purple-300 font-mono">manifest.json</span>). AutoBE validates it
            before packing and tells you exactly what it found.
          </p>

          <button
            type="button"
            disabled={processing}
            onClick={() => folderRef.current?.click()}
            className="w-full py-2.5 bg-purple-900/40 border border-purple-500/40 rounded-xl text-center text-xs font-bold text-purple-200 active:scale-98 disabled:opacity-50"
          >
            Select Folder to Pack
          </button>
          <input
            ref={folderRef}
            type="file"
            // @ts-expect-error webkitdirectory is Chromium/Android only
            webkitdirectory="true"
            directory="true"
            multiple
            onChange={handlePackFolder}
            className="hidden"
          />
        </div>

        {/* Tool 2: Inspect / Extract */}
        <div className="p-4 rounded-2xl bg-[#0D091A] border border-purple-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📂</span>
            <h2 className="text-sm font-bold text-white">Inspect .mcpack / .mcaddon</h2>
          </div>
          <p className="text-xs text-zinc-400">
            Open any archive to list its packs, verify the manifest layout and export the contents
            as a plain .zip you can edit on a PC.
          </p>

          <button
            type="button"
            disabled={processing}
            onClick={() => archiveRef.current?.click()}
            className="w-full py-2.5 bg-purple-900/40 border border-purple-500/40 rounded-xl text-center text-xs font-bold text-purple-200 active:scale-98 disabled:opacity-50"
          >
            Select Archive to Inspect
          </button>
          <input
            ref={archiveRef}
            type="file"
            accept=".mcpack,.mcaddon,.zip"
            onChange={handleExtractArchive}
            className="hidden"
          />
        </div>

        {/* Status display */}
        {status && (
          <div
            className={`p-3 rounded-xl text-[11px] leading-relaxed border ${
              status.startsWith('✓')
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : status.startsWith('✗')
                ? 'bg-red-950/40 border-red-500/40 text-red-200'
                : 'bg-purple-950/70 border-purple-400/40 text-purple-200'
            }`}
          >
            {processing ? '⏳ ' : ''}
            {status}
          </div>
        )}

        {/* Inspection detail */}
        {report && (
          <div className="p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 space-y-3">
            <div>
              <div className="text-xs font-bold text-white mb-1.5">
                Packs in {report.fileName}
              </div>
              {report.packs.length === 0 ? (
                <p className="text-[11px] text-zinc-500">No manifest.json detected.</p>
              ) : (
                <div className="space-y-1.5">
                  {report.packs.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#0A0A0A] border border-purple-500/15"
                    >
                      <span className="text-[11px] text-white truncate font-mono">{p.name}</span>
                      <span className="text-[10px] text-zinc-400 flex-shrink-0">{p.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-bold text-white mb-1.5">
                File tree ({report.fileCount} entries)
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg bg-[#0A0A0A] border border-purple-500/15 p-2 space-y-0.5">
                {report.entries.map((f, i) => (
                  <div key={i} className="text-[10px] font-mono text-zinc-400 truncate">
                    {f.path}
                  </div>
                ))}
                {report.entries.length === 0 && (
                  <div className="text-[10px] text-zinc-600">empty archive</div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={exportUnpacked}
              className="w-full py-2.5 rounded-xl bg-[#110B24] border border-purple-500/30 text-xs font-bold text-purple-200 active:scale-98"
            >
              Export Unpacked .zip
            </button>
          </div>
        )}
      </div>
    </div>
  );
};