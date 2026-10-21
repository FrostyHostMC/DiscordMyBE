import React, { useState } from 'react';
import JSZip from 'jszip';
import { Package, FolderOpen, Loader2, CheckCircle2, ArrowLeft, FileArchive, FileText, Download, AlertCircle } from 'lucide-react';
import { downloadBlob } from '@/utils/download';
import { sanitizeJsonString } from '@/utils/addonParser';

interface PackExtractToolProps { onBack: () => void }
interface ArchiveSummary { fileCount: number; entries: string[]; packName?: string }

function safeFileName(value: string): string {
  const FORBIDDEN = '<>:"/\\|?*';
  return Array.from(value, (ch) => (ch.charCodeAt(0) <= 0x1f || FORBIDDEN.includes(ch) ? '_' : ch)).join('').replace(/[. ]+$/g, '').trim() || 'Addon';
}

function safeArchivePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  return parts.length > 0 && !parts.includes('..') ? parts.join('/') : null;
}

export const PackExtractTool: React.FC<PackExtractToolProps> = ({ onBack }) => {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extractedBlob, setExtractedBlob] = useState<Blob | null>(null);
  const [extractedName, setExtractedName] = useState('');
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);

  const handlePackFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setProcessing(true);
    setError(false);
    setStatus(`Preparing ${files.length} files for a pack...`);
    try {
      const zip = new JSZip();
      const rootName = files[0].webkitRelativePath?.split('/')[0] || 'Addon';
      let added = 0;
      for (const file of files) {
        const relative = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
        const safePath = safeArchivePath(relative);
        if (safePath) { zip.file(safePath, file); added++; }
      }
      if (!added) throw new Error('No safe files were found in that folder.');
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeFileName(rootName)}.mcpack`);
      setStatus(`Packed and downloaded ${added} files as a .mcpack.`);
    } catch (err) {
      setError(true);
      setStatus(`Could not pack this folder: ${err instanceof Error ? err.message : 'Please try again.'}`);
    } finally { setProcessing(false); }
  };

  const handleExtractArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProcessing(true);
    setError(false);
    setExtractedBlob(null);
    setSummary(null);
    setStatus(`Reading ${file.name}...`);
    try {
      const source = await JSZip.loadAsync(file);
      const output = new JSZip();
      const entries = Object.entries(source.files).filter(([path, item]) => !item.dir && !path.includes('__MACOSX'));
      const visiblePaths: string[] = [];
      let fileCount = 0;
      let manifestText: string | undefined;
      for (const [path, entry] of entries) {
        const safePath = safeArchivePath(path);
        if (!safePath) continue;
        output.file(safePath, entry.async('uint8array'));
        fileCount++;
        if (visiblePaths.length < 8) visiblePaths.push(safePath);
        if (!manifestText && safePath.toLowerCase().endsWith('manifest.json')) manifestText = await entry.async('text');
      }
      if (!fileCount) throw new Error('This archive does not contain any safe files.');
      let packName: string | undefined;
      if (manifestText) {
        try {
          const manifest = JSON.parse(sanitizeJsonString(manifestText));
          const name = manifest.header?.name;
          if (typeof name === 'string' && name.trim()) packName = name.trim();
        } catch { packName = undefined; }
      }
      const baseName = safeFileName(file.name.replace(/\.(mcpack|mcaddon|zip)$/i, ''));
      setExtractedBlob(await output.generateAsync({ type: 'blob' }));
      setExtractedName(`${baseName}_extracted.zip`);
      setSummary({ fileCount, entries: visiblePaths, packName });
      setStatus('Archive unpacked and ready to save as a ZIP folder.');
    } catch (err) {
      setError(true);
      setStatus(`Could not open this archive: ${err instanceof Error ? err.message : 'The file may be damaged.'}`);
    } finally { setProcessing(false); }
  };

  const handleDownloadExtracted = () => {
    if (!extractedBlob) return;
    downloadBlob(extractedBlob, extractedName);
    setStatus('Extracted files downloaded successfully.');
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none px-4 sm:px-6 pt-4 pb-24 overflow-y-auto max-w-xl mx-auto w-full">
      <header className="flex items-center gap-3 mb-5 pb-3 border-b border-[#30263F]/70">
        <button type="button" onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-xl bg-[#15111F] border border-[#30263F] text-[#AAA3BB] grid place-items-center active:scale-95"><ArrowLeft className="w-4 h-4" /></button>
        <div><h1 className="text-base font-bold">Pack & Extract Tool</h1><p className="text-xs text-[#AAA3BB]">Prepare addon folders and unpack archives on this device.</p></div>
      </header>
      <div className="space-y-4">
        <section className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
          <div className="flex items-center gap-2"><Package className="w-4 h-4 text-[#A855F7]" /><h2 className="text-sm font-bold">Folder to .mcpack</h2></div>
          <p className="text-xs text-[#AAA3BB]">Choose an unzipped addon folder to bundle its files into a downloadable .mcpack.</p>
          <label className="block min-h-11 py-3 bg-[#15111F] border border-[#30263F] rounded-xl text-center text-xs font-bold cursor-pointer">Select Folder to Pack
            <input
              type="file"
              // @ts-expect-error webkitdirectory support
              webkitdirectory="true"
              directory="true"
              multiple
              onChange={handlePackFolder}
              className="hidden"
              disabled={processing}
            />
          </label>
        </section>
        <section className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
          <div className="flex items-center gap-2"><FolderOpen className="w-4 h-4 text-[#A855F7]" /><h2 className="text-sm font-bold">Extract & Inspect</h2></div>
          <p className="text-xs text-[#AAA3BB]">Unpack a .mcpack, .mcaddon, or ZIP archive and save its contents as a regular ZIP folder.</p>
          <label className="block min-h-11 py-3 bg-[#15111F] border border-[#30263F] rounded-xl text-center text-xs font-bold cursor-pointer">Select Archive
            <input type="file" accept=".mcpack,.mcaddon,.zip" onChange={handleExtractArchive} className="hidden" disabled={processing} />
          </label>
          {summary && <div className="rounded-lg bg-[#08070D] border border-[#30263F] p-3 space-y-2">
            <div className="flex justify-between gap-3"><div className="flex gap-2 min-w-0"><FileArchive className="w-4 h-4 text-[#A855F7] shrink-0" /><span className="text-xs font-semibold truncate">{summary.packName || 'Archive contents'}</span></div><span className="text-[10px] text-[#AAA3BB] shrink-0">{summary.fileCount} files</span></div>
            <div className="space-y-1">{summary.entries.map((path) => <div key={path} className="flex gap-2 min-w-0 text-[10px] text-[#AAA3BB]"><FileText className="w-3 h-3 text-[#762BFF] shrink-0" /><span className="truncate">{path}</span></div>)}
              {summary.fileCount > summary.entries.length && <p className="text-[10px] text-[#716885] pl-5">And {summary.fileCount - summary.entries.length} more files</p>}</div>
            <button type="button" onClick={handleDownloadExtracted} disabled={!extractedBlob || processing} className="w-full min-h-11 rounded-lg bg-[#762BFF] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2"><Download className="w-4 h-4" />Save extracted ZIP</button>
          </div>}
        </section>
        {status && <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${error ? 'bg-red-950/20 border-red-500/30 text-red-200' : 'bg-[#15111F] border-[#762BFF]/30 text-purple-200'}`}>
          {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A855F7] shrink-0" /> : error ? <AlertCircle className="w-3.5 h-3.5 text-red-300 shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}<span>{status}</span>
        </div>}
      </div>
    </div>
  );
};