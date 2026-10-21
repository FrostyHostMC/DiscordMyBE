import React, { useState } from 'react';
import { ArrowLeft, Smartphone, Zap, ShieldCheck, Code2, Download, Loader2, CheckCircle2 } from 'lucide-react';
import { BrandMark } from './DashboardShell';
import { buildCodebaseArchive, CodebaseExportResult } from '@/utils/codebaseExport';
import { CodebasePasswordModal } from '@/components/CodebasePasswordModal';
import { createPersistentDownload, downloadBlob } from '@/utils/download';
import { useModpackAudio } from '@/hooks/useModpackAudio';

interface AboutScreenProps {
  onBack: () => void;
}

export const AboutScreen: React.FC<AboutScreenProps> = ({ onBack }) => {
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<CodebaseExportResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const { playSyncChime, playError } = useModpackAudio();

  const handleDownloadCodebase = async () => {
    if (downloading) return;
    setDownloading(true);
    setResult(null);
    if (url) {
      URL.revokeObjectURL(url);
      setUrl(null);
    }
    try {
      const res = await buildCodebaseArchive();
      downloadBlob(res.blob, res.fileName);
      setUrl(createPersistentDownload(res.blob, res.fileName).url);
      setResult(res);
      await playSyncChime();
    } catch (e) {
      console.error('[Aippy] Codebase export failed:', e);
      await playError();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-y-auto p-4 sm:p-6 pb-24 max-w-xl mx-auto w-full justify-between">
      {/* Top Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-[#30263F]/70">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[#AAA3BB] hover:text-white px-2 py-1 rounded-lg hover:bg-[#15111F] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <span className="text-xs font-mono text-[#AAA3BB]">AutoBE v2.3.0</span>
      </div>

      {/* Hero Brand Section */}
      <div className="flex flex-col items-center text-center my-auto py-8">
        <BrandMark size="w-20 h-20" />
        <h1 className="text-2xl font-black text-white tracking-tight mt-4">
          Auto<span className="text-[#A855F7]">BE</span>
        </h1>
        <div className="text-xs font-semibold tracking-wider text-[#A855F7] uppercase mt-0.5">
          Bedrock Addon Merging Studio
        </div>
        <p className="text-xs text-[#AAA3BB] mt-2 max-w-xs leading-relaxed">
          More Packs. Less Conflicts. Built specifically for Minecraft Bedrock players & developers.
        </p>

        {/* Feature Highlights */}
        <div className="w-full mt-6 space-y-2.5 text-left">
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#100D18] border border-[#30263F]">
            <div className="w-9 h-9 rounded-lg bg-[#15111F] border border-[#762BFF]/30 flex items-center justify-center text-[#A855F7] shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Mobile Native</div>
              <div className="text-[11px] text-[#AAA3BB]">100% on-device client processing & zip compression</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#100D18] border border-[#30263F]">
            <div className="w-9 h-9 rounded-lg bg-[#15111F] border border-[#762BFF]/30 flex items-center justify-center text-[#A855F7] shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Smart Conflict Detection</div>
              <div className="text-[11px] text-[#AAA3BB]">Automatic namespace prefixing and script API isolation</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#100D18] border border-[#30263F]">
            <div className="w-9 h-9 rounded-lg bg-[#15111F] border border-[#762BFF]/30 flex items-center justify-center text-[#A855F7] shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Local-First Sandbox</div>
              <div className="text-[11px] text-[#AAA3BB]">Zero server uploads; all archives stay on your device</div>
            </div>
          </div>
        </div>

        {/* Full Codebase Download Banner */}
        <div className="w-full mt-4 p-4 rounded-xl bg-gradient-to-r from-[#15111F] to-[#100D18] border border-[#762BFF]/50 text-left space-y-2.5">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-[#A855F7]" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Project Source Code</span>
          </div>
          <p className="text-[11px] text-[#AAA3BB] leading-relaxed">
            Download the entire AutoBE application codebase (components, hooks, server functions, configs, package.json) as a complete ZIP archive.
          </p>
          <button
            type="button"
            onClick={() => setShowPasswordModal(true)}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-white text-xs font-bold transition-all shadow-[0_0_10px_rgba(118,43,255,0.3)] active:scale-[0.98]"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : result ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Download className="w-3.5 h-3.5" />}
            <span>{downloading ? 'Packaging All Project Files...' : result ? 'Downloaded Codebase ZIP' : 'Download Complete Codebase (ZIP)'}</span>
          </button>
          {result && (
            <div className="text-[10px] text-emerald-400 font-medium">
              {result.fileCount} files & folders packaged into {result.fileName}
            </div>
          )}
          {url && (
            <a
              href={url}
              download={result?.fileName || 'autobe_codebase.zip'}
              className="block text-center text-[10px] text-[#A855F7] underline pt-0.5"
            >
              Manual download link if download was interrupted
            </a>
          )}
        </div>
      </div>

      <CodebasePasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onUnlock={handleDownloadCodebase}
      />

      {/* Footer */}
      <div className="text-center text-[10px] text-[#716885] font-mono pt-4 border-t border-[#30263F]/50">
        <div>StoneByte © 2026 • AutoBE Merging Engine</div>
      </div>
    </div>
  );
};