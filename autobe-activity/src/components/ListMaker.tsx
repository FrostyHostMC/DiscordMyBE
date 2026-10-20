import React, { useMemo, useState } from 'react';
import { AddonPack } from '@/types/modpack';
import { downloadBlob } from '@/utils/codebaseExport';

interface ListMakerProps {
  packs: AddonPack[];
  onBack: () => void;
}

/**
 * Addon list maker.
 *
 * Port of the Python `List Maker` tab: pick the addons you want listed, choose
 * "merge together" or "add alone", and export a formatted .txt with name, date
 * added, pack type, size and a running total.
 */
export const ListMaker: React.FC<ListMakerProps> = ({ packs, onBack }) => {
  const [mode, setMode] = useState<'merge' | 'standalone'>('merge');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(packs.map((p) => p.id)));
  const [sort, setSort] = useState<'date-desc' | 'date-asc' | 'name' | 'size'>('date-desc');

  const chosen = useMemo(() => {
    const list = packs.filter((p) => selected.has(p.id));
    switch (sort) {
      case 'date-asc':
        return [...list].sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
      case 'name':
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
      case 'size':
        return [...list].sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0));
      default:
        return [...list].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    }
  }, [packs, selected, sort]);

  const totalBytes = chosen.reduce((s, p) => s + (p.fileSize || 0), 0);
  const scriptsCount = chosen.filter((p) => p.hasScripts).length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (ts?: number) =>
    ts ? new Date(ts).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }) : '--';

  const generateListText = (): string => {
    const rule = '='.repeat(78);
    const lines: string[] = [
      rule,
      'AutoBE — Bedrock Addon List',
      rule,
      mode === 'merge'
        ? 'MODE: MERGE THESE ADDONS TOGETHER'
        : 'MODE: ADD THESE ALONE ONLY (do not merge)',
      `Generated: ${new Date().toLocaleString()}`,
      `Addons listed: ${chosen.length}`,
      `Total size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`,
      `Scripted packs: ${scriptsCount} (disable Xbox achievements)`,
      '',
      '#'.padEnd(4) + 'ADDON NAME'.padEnd(42) + '| DATE ADDED'.padEnd(13) + '| TYPE       | SIZE',
      '-'.repeat(78)
    ];

    chosen.forEach((p, i) => {
      const type = p.type === 'Behavior Pack' ? 'Behavior' : p.type === 'Resource Pack' ? 'Resource' : 'Skin';
      lines.push(
        `${String(i + 1).padEnd(4)}${p.name.slice(0, 40).padEnd(42)}| ${formatDate(p.dateAdded).padEnd(11)}| ${type.padEnd(10)}| ${(
          (p.fileSize || 0) / (1024 * 1024)
        ).toFixed(2)} MB`
      );
      const flags: string[] = [];
      if (p.hasScripts) flags.push('scripts');
      if (p.hasExperimental) flags.push('experimental');
      if (p.isObfuscated) flags.push('OBFUSCATED - do not merge');
      if (p.subpacks?.length) flags.push(`${p.subpacks.length} subpacks`);
      if (p.scriptApiVersion) flags.push(`ScriptAPI ${p.scriptApiVersion}`);
      if (flags.length) lines.push(`     └─ ${flags.join(', ')}`);
    });

    lines.push('-'.repeat(78));
    lines.push(`TOTAL: ${chosen.length} addon(s), ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
    lines.push('');
    lines.push('Generated with AutoBE Mobile Modpack Tool by StoneByte');

    return lines.join('\n');
  };

  const handleDownload = () => {
    if (chosen.length === 0) return;
    const text = generateListText();
    // UTF-8 BOM so Windows Notepad renders the box characters correctly.
    const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `AutoBE_Addon_List_${mode}.txt`);
  };

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none px-5 pt-3 pb-24 overflow-y-auto">
      <div className="flex items-center gap-3 mb-4">
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
        <div>
          <h1 className="text-lg font-bold text-white">Addon List Maker</h1>
          <p className="text-[11px] text-zinc-400">
            {chosen.length} of {packs.length} selected · {(totalBytes / (1024 * 1024)).toFixed(1)} MB
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Mode selector */}
        <div className="flex p-1 bg-[#120B24] rounded-xl border border-purple-500/20 text-xs">
          <button
            type="button"
            onClick={() => setMode('merge')}
            className={`flex-1 py-2 rounded-lg font-bold transition-all ${
              mode === 'merge'
                ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.4)]'
                : 'text-zinc-400'
            }`}
          >
            Merge Together
          </button>
          <button
            type="button"
            onClick={() => setMode('standalone')}
            className={`flex-1 py-2 rounded-lg font-bold transition-all ${
              mode === 'standalone'
                ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.4)]'
                : 'text-zinc-400'
            }`}
          >
            Add Alone
          </button>
        </div>

        <p
          className={`text-[11px] p-2.5 rounded-xl border leading-relaxed ${
            mode === 'merge'
              ? 'bg-purple-950/40 border-purple-500/30 text-purple-200'
              : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
          }`}
        >
          {mode === 'merge'
            ? 'Every listed addon will be combined into one modpack. Verify the Script API versions are compatible first.'
            : 'Each listed addon must be installed on its own. Do not merge them with anything else.'}
        </p>

        {/* Pack picker */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">Included addons</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setSelected(new Set(packs.map((p) => p.id)))}
                className="text-[10px] px-2 py-1 rounded-lg bg-purple-950/50 border border-purple-500/30 text-purple-300"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[10px] px-2 py-1 rounded-lg bg-zinc-900/50 border border-zinc-700 text-zinc-400"
              >
                None
              </button>
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(
              [
                ['date-desc', 'Newest'],
                ['date-asc', 'Oldest'],
                ['name', 'A–Z'],
                ['size', 'Largest']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className={`text-[10px] px-2 py-1 rounded-lg whitespace-nowrap border ${
                  sort === key
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'bg-zinc-900/50 border-zinc-700 text-zinc-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
            {packs.length === 0 && (
              <p className="text-[11px] text-zinc-500 py-6 text-center">
                Import addons first to build a list.
              </p>
            )}
            {packs.map((p) => {
              const on = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                    on
                      ? 'bg-purple-950/40 border-purple-500/50'
                      : 'bg-[#0D091A] border-purple-500/15 opacity-60'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center text-[9px] flex-shrink-0 ${
                      on ? 'border-purple-300 bg-purple-600' : 'border-zinc-600'
                    }`}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="text-[11px] font-semibold text-white truncate flex-1">{p.name}</span>
                  <span className="text-[10px] text-zinc-500 font-mono flex-shrink-0">
                    {((p.fileSize || 0) / (1024 * 1024)).toFixed(1)}M
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Text Preview */}
        <pre className="p-3 bg-[#0B0716] rounded-xl border border-purple-500/25 font-mono text-[10px] leading-relaxed text-purple-200/90 overflow-auto max-h-64 whitespace-pre">
          {generateListText()}
        </pre>

        <button
          type="button"
          onClick={handleDownload}
          disabled={chosen.length === 0}
          className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-95 transition-all disabled:opacity-40"
        >
          Export .txt List
        </button>
      </div>
    </div>
  );
};