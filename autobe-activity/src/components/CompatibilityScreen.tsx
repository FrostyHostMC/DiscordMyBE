import React from 'react';
import { AddonPack } from '@/types/modpack';
import { CompatibilityReport, PackIssue } from '@/utils/packValidator';

interface CompatibilityScreenProps {
  report: CompatibilityReport;
  packs: AddonPack[];
  onContinue: () => void;
  onRemovePacks: (ids: string[]) => void;
  onBack: () => void;
}

const LEVEL_STYLE: Record<PackIssue['level'], { chip: string; icon: string; label: string }> = {
  error: { chip: 'bg-red-950/50 border-red-500/40 text-red-300', icon: '⛔', label: 'Blocks merge' },
  warning: { chip: 'bg-amber-950/50 border-amber-500/40 text-amber-300', icon: '⚠️', label: 'Warning' },
  info: { chip: 'bg-sky-950/50 border-sky-500/40 text-sky-300', icon: 'ℹ️', label: 'Note' }
};

/**
 * "Check Packs" review screen.
 *
 * Port of the Python `_check_compatibility` + `_is_pack_obfuscated` warnings,
 * extended with the Script API / engine-version checks the desktop build shows
 * in its "Check Packs" overlay.
 */
export const CompatibilityScreen: React.FC<CompatibilityScreenProps> = ({
  report,
  packs,
  onContinue,
  onRemovePacks,
  onBack
}) => {
  const { issues, canMerge } = report;
  const errors = issues.filter((i) => i.level === 'error');
  const others = issues.filter((i) => i.level !== 'error');
  const obfuscatedIds = issues
    .filter((i) => i.code === 'obfuscated')
    .flatMap((i) => i.packIds);

  const scripts = packs.filter((p) => p.hasScripts);

  return (
    <div className="flex flex-col h-full bg-[#07050F] text-white select-none">
      <div className="flex items-center gap-3 px-5 pt-3 pb-3 border-b border-purple-500/20 bg-[#0B0716]/90">
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
          <h1 className="text-base font-bold text-white">Pack Check</h1>
          <p className="text-[11px] text-purple-300">
            {packs.length} addon{packs.length === 1 ? '' : 's'} verified
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 pb-32">
        {/* Headline status */}
        <div
          className={`p-4 rounded-2xl border text-center ${
            canMerge
              ? 'bg-emerald-950/25 border-emerald-500/40'
              : 'bg-red-950/25 border-red-500/40'
          }`}
        >
          <div className="text-3xl mb-1">{canMerge ? '✅' : '⛔'}</div>
          <p
            className={`text-sm font-bold ${canMerge ? 'text-emerald-300' : 'text-red-300'}`}
          >
            {canMerge ? 'Ready to merge' : 'Merge blocked'}
          </p>
          <p className="text-[11px] text-zinc-400 mt-1">
            {canMerge
              ? errors.length === 0 && others.length === 0
                ? 'No issues found. Everything looks clean.'
                : `${others.length} advisory note${others.length === 1 ? '' : 's'} — you can still merge.`
              : `${errors.length} blocking issue${errors.length === 1 ? '' : 's'} must be fixed first.`}
          </p>
        </div>

        {/* Errors */}
        {errors.map((issue, i) => (
          <IssueCard key={`e${i}`} issue={issue} />
        ))}

        {/* One-tap fix for the classic obfuscation failure */}
        {obfuscatedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onRemovePacks(obfuscatedIds)}
            className="w-full py-3 rounded-xl bg-red-900/40 border border-red-500/50 text-xs font-bold text-red-200 active:scale-[0.98]"
          >
            Remove {obfuscatedIds.length} obfuscated pack
            {obfuscatedIds.length === 1 ? '' : 's'} from selection
          </button>
        )}

        {/* Advisories */}
        {others.map((issue, i) => (
          <IssueCard key={`w${i}`} issue={issue} />
        ))}

        {/* Achievement summary */}
        <div className="p-3.5 rounded-2xl bg-[#0D091A] border border-purple-500/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-white">Achievements impact</span>
            {scripts.length === 0 ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-500/40 text-emerald-300">
                ✓ safe
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-950/50 border border-red-500/40 text-red-300">
                ⚠ disabled
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            {scripts.length === 0
              ? 'No pack declares a script module, so Xbox achievements stay enabled.'
              : `${scripts.length} pack${
                  scripts.length === 1 ? '' : 's'
                } declare script modules or experimental capabilities. Bedrock disables achievements when these are active.`}
          </p>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-[#090614]/95 border-t border-purple-500/20 z-20">
        <button
          type="button"
          disabled={!canMerge}
          onClick={onContinue}
          className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border transition-all ${
            canMerge
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.5)] border-purple-400/40 active:scale-[0.98]'
              : 'bg-zinc-800/80 text-zinc-500 border-zinc-700/50 cursor-not-allowed'
          }`}
        >
          {canMerge ? 'Continue to Merge Plan' : 'Resolve issues to continue'}
        </button>
      </div>
    </div>
  );
};

const IssueCard: React.FC<{ issue: PackIssue }> = ({ issue }) => {
  const style = LEVEL_STYLE[issue.level];
  return (
    <div
      className={`p-3.5 rounded-2xl border ${style.chip} bg-[#0D091A]/60`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">{style.icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide">{style.label}</span>
      </div>
      <p className="text-[11px] text-zinc-300 leading-relaxed">{issue.detail}</p>
      {issue.packNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {issue.packNames.slice(0, 6).map((n, i) => (
            <span
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-zinc-300 truncate max-w-full"
            >
              {n}
            </span>
          ))}
          {issue.packNames.length > 6 && (
            <span className="text-[10px] text-zinc-500">+{issue.packNames.length - 6} more</span>
          )}
        </div>
      )}
    </div>
  );
};