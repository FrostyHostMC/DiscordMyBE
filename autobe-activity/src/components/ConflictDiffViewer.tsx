import React, { useEffect, useState } from 'react';
import { FileDiff, Loader2 } from 'lucide-react';
import { AddonPack, ConflictItem } from '@/types/modpack';
import { loadDefinitionText, diffLines, DiffRow } from '@/utils/conflictDiff';

interface ConflictDiffViewerProps {
  conflict: ConflictItem;
  packs: AddonPack[];
}

/** Side-by-side line diff of the two conflicting JSON definitions. */
export const ConflictDiffViewer: React.FC<ConflictDiffViewerProps> = ({ conflict, packs }) => {
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Defer the reset to a microtask so we never call setState synchronously
    // inside the effect body (avoids cascading renders).
    Promise.resolve().then(() => {
      if (cancelled) return;
      setRows(null);
      setUnavailable(false);
    });

    const findPack = (id: string, name: string): AddonPack | undefined =>
      packs.find((p) => p.id === id) || packs.find((p) => p.name === name);

    const run = async (): Promise<void> => {
      const packA = findPack(conflict.packA.id, conflict.packA.name);
      const packB = findPack(conflict.packB.id, conflict.packB.name);
      const [textA, textB] = await Promise.all([
        loadDefinitionText(packA, conflict.type, conflict.identifier),
        loadDefinitionText(packB, conflict.type, conflict.identifier)
      ]);
      if (cancelled) return;
      if (!textA && !textB) {
        setUnavailable(true);
        return;
      }
      setRows(diffLines(textA ?? '', textB ?? ''));
    };

    run().catch(() => {
      if (!cancelled) setUnavailable(true);
    });

    return () => {
      cancelled = true;
    };
  }, [conflict.id, conflict.type, conflict.identifier, conflict.packA.id, conflict.packA.name, conflict.packB.id, conflict.packB.name, packs]);

  if (unavailable) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#0F0C17] border border-[#30263F]/60 px-3 py-2 text-[10px] text-[#716885]">
        <FileDiff className="w-3.5 h-3.5 shrink-0" />
        <span>Source definitions not available for a side-by-side diff.</span>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#0F0C17] border border-[#30263F]/60 px-3 py-3 text-[10px] text-[#716885]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Loading definitions...</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[#30263F]/70 bg-[#0F0C17] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30263F]/60 bg-[#15111F]">
        <FileDiff className="w-3.5 h-3.5 text-[#A855F7]" />
        <span className="text-[10px] font-bold text-white">Definition Diff</span>
        <span className="text-[10px] text-emerald-300 truncate max-w-[35%]">{conflict.packA.name}</span>
        <span className="text-[10px] text-rose-300 truncate max-w-[35%] ml-auto text-right">{conflict.packB.name}</span>
      </div>
      <div className="max-h-56 overflow-auto font-mono text-[10px] leading-[1.45]">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className={
              row.kind === 'del'
                ? 'px-3 py-[1px] whitespace-pre-wrap break-all bg-rose-500/10 text-rose-300'
                : row.kind === 'add'
                  ? 'px-3 py-[1px] whitespace-pre-wrap break-all bg-emerald-500/10 text-emerald-300'
                  : 'px-3 py-[1px] whitespace-pre-wrap break-all text-[#716885]'
            }
          >
            {row.text || ' '}
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-[#30263F]/60 text-[9px] text-[#716885]">
        Green lines exist only in {conflict.packB.name} · Red lines exist only in {conflict.packA.name}
      </div>
    </div>
  );
};