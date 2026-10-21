import React, { useState } from 'react';
import { Package, FolderOpen, Loader2, CheckCircle2, ArrowLeft, FileArchive, FileText, Download, AlertCircle, Trash2, Layers } from 'lucide-react';
import { downloadBlob } from '@/utils/download';
import { sanitizeJsonString } from '@/utils/addonParser';
import { recursiveExtractPack, folderToMcpack, safeFileName, safeArchivePath, PackInfo, ExtractionResult } from '@/utils/mcpacker';

interface PackExtractToolProps { onBack: () => void }
interface ArchiveSummary { fileCount: number; entries: string[]; packName?: string; packsFound?: PackInfo[] }

export const PackExtractTool: React.FC<PackExtractToolProps> = ({ onBack }) => {
  const [mode, setMode] = useState<'pack' | 'extract'>('pack');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  
  // Pack mode state
  const [packFiles, setPackFiles] = useState<File[]>([]);
  const [selectedPackFiles, setSelectedPackFiles] = useState<Set<number>>(new Set());
  
  // Extract mode state
  const [extractedBlob, setExtractedBlob] = useState<Blob | null>(null);
  const [extractedName, setExtractedName] = useState('');
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);

  const handlePackFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    
    setPackFiles(files);
    setStatus(`Loaded ${files.length} files. Ready to pack.`);
    setError(false);
  };

  const handleSelectPackFile = (index: number) => {
    setSelectedPackFiles(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handlePackProcess = async () => {
    if (selectedPackFiles.size === 0) {
      setStatus('Please select at least one file to pack.');
      setError(true);
      return;
    }

    setProcessing(true);
    setError(false);
    setProgress(0);
    setCurrentStep('Reading files...');
    setStatus('Processing files...');

    try {
      const filesToPack = Array.from(selectedPackFiles).map(i => packFiles[i]);
      const rootName = filesToPack[0].webkitRelativePath?.split('/')[0] || 'Addon';
      
      setCurrentStep('Creating .mcpack archive...');
      setProgress(50);
      
      const blob = await folderToMcpack(filesToPack, rootName);
      
      setCurrentStep('Downloading...');
      setProgress(90);
      
      await downloadBlob(blob, `${safeFileName(rootName)}.mcpack`);
      
      setProgress(100);
      setCurrentStep('Complete!');
      setStatus(`Successfully packed ${filesToPack.length} files as ${safeFileName(rootName)}.mcpack`);
    } catch (err) {
      setError(true);
      setCurrentStep('Failed');
      setStatus(`Could not pack files: ${err instanceof Error ? err.message : 'Please try again.'}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleExtractArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    
    setProcessing(true);
    setError(false);
    setExtractedBlob(null);
    setSummary(null);
    setProgress(0);
    setCurrentStep('Reading archive...');
    setStatus(`Reading ${file.name}...`);

    try {
      setCurrentStep('Extracting files...');
      setProgress(20);
      
      const result = await recursiveExtractPack(file);
      
      setCurrentStep('Repackaging...');
      setProgress(70);
      
      // Re-package into a ZIP
      const JSZip = (await import('jszip')).default;
      const output = new JSZip();
      
      for (const [path, entry] of Object.entries((await JSZip.loadAsync(file)).files)) {
        if (entry.dir || path.includes('__MACOSX')) continue;
        const safePath = safeArchivePath(path);
        if (safePath) {
          output.file(safePath, entry.async('uint8array'));
        }
      }
      
      const baseName = safeFileName(file.name.replace(/\.(mcpack|mcaddon|zip)$/i, ''));
      const blob = await output.generateAsync({ type: 'blob' });
      
      setProgress(100);
      setCurrentStep('Complete!');
      
      setExtractedBlob(blob);
      setExtractedName(`${baseName}_extracted.zip`);
      setSummary({
        fileCount: result.totalFiles,
        entries: Array.from((await JSZip.loadAsync(file)).files.keys())
          .filter(p => !p.includes('__MACOSX') && !p.endsWith('/'))
          .slice(0, 8),
        packName: baseName,
        packsFound: result.packs
      });
      setStatus(`Archive unpacked. Found ${result.packs.length} pack(s), ${result.totalFiles} files total.`);
      
      if (result.errors.length > 0) {
        console.warn('Extraction errors:', result.errors);
      }
    } catch (err) {
      setError(true);
      setCurrentStep('Failed');
      setStatus(`Could not open this archive: ${err instanceof Error ? err.message : 'The file may be damaged.'}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadExtracted = () => {
    if (!extractedBlob) return;
    downloadBlob(extractedBlob, extractedName);
    setStatus('Extracted files downloaded successfully.');
  };

  const handleClearFiles = () => {
    setPackFiles([]);
    setSelectedPackFiles(new Set());
    setStatus(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none px-4 sm:px-6 pt-4 pb-24 overflow-y-auto max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between mb-5 pb-3 border-b border-[#30263F]/70">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-xl bg-[#15111F] border border-[#30263F] text-[#AAA3BB] grid place-items-center active:scale-95"><ArrowLeft className="w-4 h-4" /></button>
          <div>
            <h1 className="text-base font-bold">MCPACKER</h1>
            <p className="text-xs text-[#AAA3BB]">Pack folders or extract nested archives</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('pack')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'pack' ? 'bg-[#762BFF] text-white' : 'bg-[#15111F] text-[#AAA3BB] hover:text-white'
            }`}
          >
            Pack
          </button>
          <button
            type="button"
            onClick={() => setMode('extract')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'extract' ? 'bg-[#762BFF] text-white' : 'bg-[#15111F] text-[#AAA3BB] hover:text-white'
            }`}
          >
            Extract
          </button>
        </div>
      </header>

      {/* Progress Section */}
      {(processing || currentStep) && (
        <div className="mb-4 p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">{currentStep || 'Ready'}</span>
            <span className="text-[10px] text-[#AAA3BB]">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-[#08070D] rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-[#762BFF] to-[#A855F7] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {mode === 'pack' ? (
        <div className="space-y-4">
          <section className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-[#A855F7]" />
              <h2 className="text-sm font-bold">Folder to .mcpack</h2>
            </div>
            <p className="text-xs text-[#AAA3BB]">Choose an unzipped addon folder to bundle its files into a downloadable .mcpack.</p>
            <label className="block min-h-11 py-3 bg-[#15111F] border border-[#30263F] rounded-xl text-center text-xs font-bold cursor-pointer hover:bg-[#201A2E] transition-colors">
              {packFiles.length === 0 ? 'Select Folder to Pack' : `Select Different Folder (${packFiles.length} files)`}
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

          {packFiles.length > 0 && (
            <section className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#A855F7]" />
                  <h2 className="text-sm font-bold">Files to Pack ({packFiles.length})</h2>
                </div>
                <button
                  type="button"
                  onClick={handleClearFiles}
                  className="text-xs text-[#AAA3BB] hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3 inline mr-1" />
                  Clear
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 pr-2">
                {packFiles.map((file, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectPackFile(idx)}
                    className={`p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedPackFiles.has(idx)
                        ? 'bg-[#762BFF]/20 border border-[#762BFF]/40'
                        : 'bg-[#08070D] border border-[#30263F] hover:border-[#30263F]/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-3 h-3 text-[#AAA3BB]" />
                      <span className="text-xs truncate">{file.webkitRelativePath || file.name}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPackFiles(new Set(Array.from({ length: packFiles.length }, (_, i) => i)))}
                  className="flex-1 py-2 rounded-lg bg-[#15111F] border border-[#30263F] text-xs font-bold hover:bg-[#201A2E] transition-colors"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handlePackProcess}
                  disabled={processing || selectedPackFiles.size === 0}
                  className="flex-1 py-2 rounded-lg bg-[#762BFF] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#853CFF] transition-colors"
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Pack {selectedPackFiles.size} File{selectedPackFiles.size !== 1 ? 's' : ''}
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <section className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[#A855F7]" />
              <h2 className="text-sm font-bold">Extract & Inspect</h2>
            </div>
            <p className="text-xs text-[#AAA3BB]">Unpack a .mcpack, .mcaddon, or ZIP archive. Handles nested archives automatically.</p>
            <label className="block min-h-11 py-3 bg-[#15111F] border border-[#30263F] rounded-xl text-center text-xs font-bold cursor-pointer hover:bg-[#201A2E] transition-colors">
              Select Archive
              <input
                type="file"
                accept=".mcpack,.mcaddon,.zip"
                onChange={handleExtractArchive}
                className="hidden"
                disabled={processing}
              />
            </label>
          </section>

          {summary && (
            <section className="p-4 rounded-xl bg-[#100D18] border border-[#30263F] space-y-3">
              <div className="flex items-center gap-2">
                <FileArchive className="w-4 h-4 text-[#A855F7]" />
                <h2 className="text-sm font-bold">Extraction Results</h2>
              </div>
              
              {summary.packsFound && summary.packsFound.length > 0 && (
                <div className="p-3 rounded-lg bg-[#08070D] border border-[#30263F]">
                  <p className="text-xs font-bold text-emerald-400 mb-2">
                    {summary.packsFound.length} Pack{summary.packsFound.length !== 1 ? 's' : ''} Found
                  </p>
                  {summary.packsFound.map((pack, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-[#AAA3BB]">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>{pack.name} {pack.isValid ? '(valid)' : '(invalid)'}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg bg-[#08070D] border border-[#30263F] p-3 space-y-2">
                <div className="flex justify-between gap-3">
                  <div className="flex gap-2 min-w-0">
                    <FileArchive className="w-4 h-4 text-[#A855F7] shrink-0" />
                    <span className="text-xs font-semibold truncate">{summary.packName || 'Archive contents'}</span>
                  </div>
                  <span className="text-[10px] text-[#AAA3BB] shrink-0">{summary.fileCount} files</span>
                </div>
                <div className="space-y-1">
                  {summary.entries.map((path) => (
                    <div key={path} className="flex gap-2 min-w-0 text-[10px] text-[#AAA3BB]">
                      <FileText className="w-3 h-3 text-[#762BFF] shrink-0" />
                      <span className="truncate">{path}</span>
                    </div>
                  ))}
                  {summary.fileCount > summary.entries.length && (
                    <p className="text-[10px] text-[#716885] pl-5">
                      And {summary.fileCount - summary.entries.length} more files
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadExtracted}
                disabled={!extractedBlob || processing}
                className="w-full min-h-11 rounded-lg bg-[#762BFF] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#853CFF] transition-colors"
              >
                <Download className="w-4 h-4" />
                Save extracted ZIP
              </button>
            </section>
          )}
        </div>
      )}

      {status && (
        <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
          error ? 'bg-red-950/20 border-red-500/30 text-red-200' : 'bg-[#15111F] border-[#762BFF]/30 text-purple-200'
        }`}>
          {processing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#A855F7] shrink-0" />
          ) : error ? (
            <AlertCircle className="w-3.5 h-3.5 text-red-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}
          <span>{status}</span>
        </div>
      )}
    </div>
  );
};