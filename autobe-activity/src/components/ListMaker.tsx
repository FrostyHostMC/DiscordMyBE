import React, { useState } from 'react';
import { ArrowLeft, ListChecks, Download } from 'lucide-react';
import { AddonPack } from '@/types/modpack';

interface ListMakerProps {
  packs: AddonPack[];
  onBack: () => void;
}

export const ListMaker: React.FC<ListMakerProps> = ({ packs, onBack }) => {
  const [mode, setMode] = useState<'merge' | 'standalone'>('merge');

  const generateListText = () => {
    let totalBytes = 0;
    const lines = [
      '========================================',
      '        AutoBE Bedrock Addon List       ',
      '========================================',
      `Mode: ${mode === 'merge' ? 'Merge these together into one pack' : 'Standalone installation'}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Total Addons: ${packs.length}`,
      '----------------------------------------'
    ];

    packs.forEach((p, i) => {
      totalBytes += p.fileSize;
      const mb = (p.fileSize / (1024 * 1024)).toFixed(1);
      lines.push(`${i + 1}. [${p.type}] ${p.name}`);
      lines.push(`   Version: ${p.version} | Size: ${mb} MB`);
      if (p.hasScripts) lines.push(`   * Contains Script Modules (Achievements Disabled)`);
      lines.push('');
    });

    lines.push('----------------------------------------');
    lines.push(`Total Combined Size: ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
    lines.push('Generated with AutoBE Bedrock Merging Studio');
    return lines.join('\n');
  };

  const handleDownload = () => {
    const text = generateListText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AutoBE_Addon_List_${mode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none px-4 sm:px-6 pt-4 pb-24 overflow-y-auto max-w-xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5 pb-3 border-b border-[#30263F]/70">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-base font-bold text-white">Addon List Generator</h1>
          <p className="text-xs text-[#AAA3BB]">Export text lists of your addon library</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Mode selector */}
        <div className="flex p-0.5 bg-[#15111F] rounded-xl border border-[#30263F] text-xs">
          <button
            type="button"
            onClick={() => setMode('merge')}
            className={`flex-1 py-2 rounded-lg font-bold transition-all ${
              mode === 'merge' ? 'bg-[#762BFF] text-white shadow-[0_0_10px_rgba(118,43,255,0.4)]' : 'text-[#AAA3BB]'
            }`}
          >
            Merged Addons Mode
          </button>
          <button
            type="button"
            onClick={() => setMode('standalone')}
            className={`flex-1 py-2 rounded-lg font-bold transition-all ${
              mode === 'standalone' ? 'bg-[#762BFF] text-white shadow-[0_0_10px_rgba(118,43,255,0.4)]' : 'text-[#AAA3BB]'
            }`}
          >
            Standalone Mode
          </button>
        </div>

        {/* Text Preview */}
        <div className="p-3.5 bg-[#100D18] rounded-xl border border-[#30263F] font-mono text-[11px] text-[#C9A9FF] whitespace-pre overflow-x-auto max-h-72">
          {generateListText()}
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleDownload}
          className="w-full py-3 bg-[#762BFF] hover:bg-[#853CFF] rounded-xl font-bold text-xs text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span>Export & Download .txt List</span>
        </button>
      </div>
    </div>
  );
};