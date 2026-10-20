import React from 'react';
import { ConflictItem } from '@/types/modpack';

interface ConflictScreenProps {
  conflicts: ConflictItem[];
  autoMerge: boolean;
  onUpdateResolution: (conflictId: string, resolution: ConflictItem['resolution']) => void;
  onAutoPrefixAll: () => void;
  onProceedMerge: () => void;
  onBack: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  entity: 'Entity',
  item: 'Item',
  block: 'Block',
  recipe: 'Recipe',
  loot_table: 'Loot Table',
  animation_controller: 'Animation Ctrl',
  render_controller: 'Render Ctrl'
};

/**
 * Identifier conflict resolution.
 *
 * Equivalent of the Python `_show_conflict_resolution_overlay`: for every
 * duplicated identifier you choose which addon's definition wins, or keep both
 * by namespacing the second one.
 */
export const ConflictScreen: React.FC<ConflictScreenProps> = ({
  conflicts,
  autoMerge,
  onUpdateResolution,
  onAutoPrefixAll,
  onProceedMerge,
  onBack
}) => {
  const uniqueCount = new Set(conflicts.map((c) => `${c.type}::${c.identifier}`)).size;
  const allPrefixed = conflicts.length > 0 && conflicts.every((c) => c.resolution === 'prefix_all');

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
          <div>
            <h1 className="text-base font-bold text-white">Conflict Resolution</h1>
            <p className="text-[11px] text-amber-400">
              {uniqueCount} duplicated identifier{uniqueCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onAutoPrefixAll}
          disabled={allPrefixed}
          className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${
            allPrefixed
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-purple-950 border border-purple-400/40 text-purple-300 hover:text-white active:scale-95'
          }`}
        >
          {allPrefixed ? '✓ All Prefixed' : 'Prefix All'}
        </button>
      </div>

      {/* Info notice */}
      <div className="mx-5 my-3 p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
        <strong>Namespace protection:</strong> several addons define the same identifier.{' '}
        {autoMerge
          ? 'Auto Merge is on, so every conflict is namespaced automatically — but you can still override anything below.'
          : 'Namespacing keeps both addons working; "keep" drops the losing definition so its scripts and references point at the winner.'}
      </div>

      {/* Conflicts List */}
      <div className="flex-1 overflow-y-auto px-5 space-y-3 pb-28">
        {conflicts.map((conflict) => {
          const involved = conflict.packs?.length
            ? conflict.packs
            : [conflict.packA, conflict.packB];
          const btn = (res: ConflictItem['resolution'], label: string, active: boolean) => (
            <button
              type="button"
              onClick={() => onUpdateResolution(conflict.id, res)}
              className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold border transition-all truncate ${
                active
                  ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_10px_rgba(147,51,234,0.4)]'
                  : 'bg-purple-950/30 text-purple-300 border-purple-500/20'
              }`}
            >
              {label}
            </button>
          );

          return (
            <div
              key={conflict.id}
              className="p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20 flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-500/30 whitespace-nowrap">
                  {TYPE_LABEL[conflict.type] || conflict.type}
                </span>
                <span className="text-xs font-mono font-bold text-white truncate">
                  {conflict.identifier}
                </span>
              </div>

              {/* Every pack that defines this identifier */}
              <div className="flex flex-wrap items-center gap-1.5">
                {involved.map((p, i) => (
                  <span
                    key={p.id}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      p.id === conflict.packA.id
                        ? 'bg-sky-950/50 border-sky-500/40 text-sky-300'
                        : 'bg-fuchsia-950/50 border-fuchsia-500/40 text-fuchsia-300'
                    }`}
                  >
                    {i === 0 ? 'A: ' : i === 1 ? 'B: ' : ''}
                    {p.name}
                  </span>
                ))}
              </div>

              {/* Resolution Selector */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {btn('prefix_all', 'Keep Both (rename)', conflict.resolution === 'prefix_all')}
                {btn('merge', 'Combine Into One', conflict.resolution === 'merge')}
                {btn('keep_a', 'Keep Pack A', conflict.resolution === 'keep_a')}
                {btn('keep_b', 'Keep Pack B', conflict.resolution === 'keep_b')}
              </div>
              <p className="text-[10px] text-zinc-500 leading-tight">
                {conflict.resolution === 'merge'
                  ? 'Both definitions are merged under the original identifier.'
                  : conflict.resolution === 'prefix_all'
                  ? 'The second pack is moved to its own namespace; nothing is lost.'
                  : conflict.resolution === 'keep_a'
                  ? "Pack B's copy is removed and its references point at Pack A."
                  : "Pack A's copy is removed and its references point at Pack B."}
              </p>
            </div>
          );
        })}
      </div>

      {/* Floating Continue */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-[#090614]/95 backdrop-blur-lg border-t border-purple-500/20 z-20">
        <button
          type="button"
          onClick={onProceedMerge}
          className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-sm text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border border-purple-400/40 active:scale-[0.98] transition-all"
        >
          Confirm &amp; Begin Merge
        </button>
      </div>
    </div>
  );
};