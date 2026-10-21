import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { ConflictItem, AddonPack } from '@/types/modpack';
import { ConflictDiffViewer } from './ConflictDiffViewer';

interface ConflictScreenProps {
  conflicts: ConflictItem[];
  autoMerge: boolean;
  onUpdateResolution: (conflictId: string, resolution: ConflictItem['resolution']) => void;
  onAutoPrefixAll: () => void;
  onProceedMerge: () => void;
  onBack: () => void;
  packs?: AddonPack[];
}

export const ConflictScreen: React.FC<ConflictScreenProps> = ({
  conflicts,
  autoMerge,
  onUpdateResolution,
  onAutoPrefixAll,
  onProceedMerge,
  onBack,
  packs = []
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Mismatched script version checks
  const scriptedPacks = packs.filter((p) => p.hasScripts);
  const scriptVersions = Array.from(new Set(scriptedPacks.map((p) => p.scriptVersion).filter(Boolean)));
  const hasScriptVersionMismatch = scriptVersions.length > 1;

  const filteredConflicts = conflicts.filter((c) => {
    if (filterType === 'all') return true;
    return c.type === filterType;
  });

  const getExplanation = (c: ConflictItem) => {
    switch (c.type) {
      case 'entity':
        return `Both "${c.packA.name}" and "${c.packB.name}" register the custom entity identifier "${c.identifier}". In Bedrock, having duplicate entity names causes one pack's mobs to overwrite the other.`;
      case 'item':
        return `Both packs define the item "${c.identifier}". Auto-prefixing adds a unique namespace prefix so players can spawn both custom items.`;
      case 'block':
        return `Both packs define the block "${c.identifier}". Prefixing keeps both blocks distinct in the creative inventory and recipes.`;
      case 'recipe':
        return `Both packs define a crafting recipe for "${c.identifier}". Choose which recipe takes priority or let AutoBE namespace both.`;
      default:
        return `Duplicate definition detected for "${c.identifier}". AutoBE can auto-prefix the second pack's definitions to prevent overwrites.`;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#08070D] text-white select-none overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[#30263F]/70 bg-[#100D18]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#15111F] border border-[#30263F] text-[#AAA3BB] hover:text-white active:scale-95 transition-all"
            aria-label="Back"
          >
            <X className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <span>Conflict Analyzer</span>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-950/50 border border-amber-500/40 text-amber-300">
                {conflicts.length} finding{conflicts.length === 1 ? '' : 's'}
              </span>
            </h1>
            <p className="text-[11px] text-[#AAA3BB]">
              Intelligent detection of identifier collisions and compatibility issues
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {conflicts.length > 0 && (
            <button
              type="button"
              onClick={onAutoPrefixAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white shadow-[0_0_12px_rgba(118,43,255,0.3)] active:scale-95 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Prefix All</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-28 space-y-4 max-w-4xl mx-auto w-full">
        {/* Safe status if no conflicts */}
        {conflicts.length === 0 && !hasScriptVersionMismatch && (
          <div className="p-6 rounded-2xl bg-[#100D18] border border-emerald-500/30 text-center max-w-md mx-auto my-8">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white">No Blocking Conflicts Detected</h3>
            <p className="text-xs text-[#AAA3BB] mt-1 leading-relaxed">
              All manifests, identifiers, and dependencies appear clean and compatible for merging.
            </p>
            <button
              type="button"
              onClick={onProceedMerge}
              className="mt-5 px-5 py-2.5 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all"
            >
              Proceed to Merge
            </button>
          </div>
        )}

        {/* Script API Warning if versions differ */}
        {hasScriptVersionMismatch && (
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-bold mb-1">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Script API Major Version Difference</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              AutoBE detected multiple @minecraft/server versions across packs. AutoBE will automatically split them into isolated behavior packs so each version executes independently without crashing.
            </p>
          </div>
        )}

        {/* Explanation Banner */}
        {conflicts.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] flex items-start gap-3">
            <HelpCircle className="w-4 h-4 text-[#A855F7] shrink-0 mt-0.5" />
            <div className="text-xs text-[#AAA3BB] leading-relaxed">
              <strong className="text-white">AutoBE Namespace Protection:</strong> When multiple addons register items or entities with the exact same identifier, one overwrites the other. AutoBE resolves this by auto-prefixing identifiers so both addons can be played together.
            </div>
          </div>
        )}

        {/* Filter buttons */}
        {conflicts.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {['all', 'entity', 'item', 'block', 'recipe'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-2.5 py-1 rounded-lg font-semibold uppercase text-[10px] tracking-wider transition-colors ${
                  filterType === t
                    ? 'bg-[#762BFF] text-white'
                    : 'bg-[#15111F] text-[#AAA3BB] hover:text-white border border-[#30263F]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Conflicts List */}
        <div className="space-y-2.5">
          {filteredConflicts.map((c, idx) => {
            const isExpanded = expandedId === c.id;
            return (
              <div
                key={c.id}
                className="p-3.5 rounded-xl bg-[#100D18] border border-[#30263F] hover:border-[#762BFF]/40 transition-all flex flex-col gap-2.5"
              >
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.2 rounded bg-amber-950/40 border border-amber-500/30 text-amber-300">
                      {c.type}
                    </span>
                    <span className="text-xs font-mono font-bold text-white truncate max-w-[200px] sm:max-w-xs">
                      {c.identifier}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                    className="text-[11px] text-[#A855F7] hover:text-[#C9A9FF] flex items-center gap-1"
                  >
                    <span>{isExpanded ? 'Less' : 'Explain'}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Collapsible explanation + advanced diff viewer */}
                {isExpanded && (
                  <div className="p-2.5 rounded-lg bg-[#15111F] border border-[#30263F]/70 text-[11px] text-[#AAA3BB] leading-relaxed animate-in fade-in duration-150">
                    {getExplanation(c)}
                    <ConflictDiffViewer conflict={c} packs={packs} />
                  </div>
                )}

                {/* Conflict participants */}
                <div className="flex items-center justify-between text-[11px] text-[#AAA3BB] bg-[#15111F] px-2.5 py-1.5 rounded-lg border border-[#30263F]/60">
                  <span className="truncate max-w-[45%] text-white font-medium">{c.packA.name}</span>
                  <span className="text-[#716885] font-mono text-[10px]">vs</span>
                  <span className="truncate max-w-[45%] text-white font-medium">{c.packB.name}</span>
                </div>

                {/* Resolution Selector */}
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onUpdateResolution(c.id, 'prefix_all')}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold border transition-all text-center truncate ${
                      c.resolution === 'prefix_all'
                        ? 'bg-[#762BFF] text-white border-[#A855F7] shadow-[0_0_10px_rgba(118,43,255,0.4)]'
                        : 'bg-[#15111F] text-[#AAA3BB] border-[#30263F] hover:text-white'
                    }`}
                  >
                    Prefix & Keep Both
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateResolution(c.id, 'keep_a')}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold border transition-all text-center truncate ${
                      c.resolution === 'keep_a'
                        ? 'bg-[#762BFF] text-white border-[#A855F7] shadow-[0_0_10px_rgba(118,43,255,0.4)]'
                        : 'bg-[#15111F] text-[#AAA3BB] border-[#30263F] hover:text-white'
                    }`}
                  >
                    Keep Pack A
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateResolution(c.id, 'keep_b')}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold border transition-all text-center truncate ${
                      c.resolution === 'keep_b'
                        ? 'bg-[#762BFF] text-white border-[#A855F7] shadow-[0_0_10px_rgba(118,43,255,0.4)]'
                        : 'bg-[#15111F] text-[#AAA3BB] border-[#30263F] hover:text-white'
                    }`}
                  >
                    Keep Pack B
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Bottom Bar: Confirm & Continue */}
      <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 bg-[#100D18]/95 backdrop-blur-md border-t border-[#30263F] z-20 flex justify-between items-center max-w-4xl mx-auto">
        <span className="text-xs text-[#AAA3BB] font-mono">
          {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} managed
        </span>
        <button
          type="button"
          onClick={onProceedMerge}
          className="px-5 py-2.5 rounded-xl bg-[#762BFF] hover:bg-[#853CFF] text-xs font-bold text-white shadow-[0_0_15px_rgba(118,43,255,0.4)] active:scale-95 transition-all flex items-center gap-2"
        >
          <span>Continue to Build</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};