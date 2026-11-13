import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import type { AnimationMetricLedger } from '@/utils/animationMetricReconciliation';

interface Props {
  ledger?: AnimationMetricLedger | null;
  accent: string;
}

const SCOPE_STYLE: Record<string, string> = {
  'final-export': 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300',
  'pass-local': 'border-slate-700 bg-slate-950 text-slate-400',
  'source-evidence': 'border-sky-800/50 bg-sky-950/40 text-sky-300',
};

const DISPOSITION_LABEL: Record<string, string> = {
  'matches-final': 'matches final',
  superseded: 'superseded',
  conflict: 'CONFLICT',
  context: 'source only',
};

const STATUS_STYLE: Record<string, string> = {
  consistent: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300',
  superseded: 'border-slate-700 bg-slate-900 text-slate-300',
  conflict: 'border-rose-500/50 bg-rose-950/50 text-rose-300',
  'not-measured': 'border-amber-500/40 bg-amber-950/40 text-amber-300',
};

export function AnimationMetricLedgerPanel({ ledger, accent }: Props) {
  if (!ledger) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <Scale className="h-3 w-3" style={{ color: accent }} aria-hidden="true" />
          Metric ledger · one figure per population
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            ledger.passed ? STATUS_STYLE.consistent : STATUS_STYLE.conflict
          }`}
        >
          {ledger.passed
            ? 'reconciled'
            : `${ledger.conflicts.length} conflict(s) · ${ledger.blockingFindings} stage(s) with errors`}
        </span>
      </div>

      <p className="text-[10px] leading-snug text-slate-400">{ledger.summary}</p>

      {ledger.conflicts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-rose-500/40 bg-rose-950/40 p-1.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
            <AlertTriangle className="h-2.5 w-2.5" /> Final-export conflicts
          </span>
          {ledger.conflicts.map((conflict) => (
            <span key={conflict} className="text-[9px] leading-snug text-rose-200/90">
              {conflict}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {ledger.rows.map((row) => (
          <div key={row.key} className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                {row.label}
              </span>
              <span className="shrink-0 font-mono text-sm font-bold text-slate-100">
                {row.finalValue === null ? '—' : row.finalValue}
              </span>
            </div>
            <span className="block text-[9px] leading-snug text-slate-500">{row.finalBasis}</span>
            {row.claims.length > 0 && (
              <div className="flex flex-col gap-0.5 pt-1">
                {row.claims.map((claim, index) => (
                  <div key={`${row.key}-${index}`} className="flex flex-wrap items-baseline gap-1">
                    <span className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[9px] text-slate-200">
                      {claim.value}
                    </span>
                    <span className="text-[9px] text-slate-400">{claim.producer}</span>
                    <span className={`rounded border px-1 py-0.5 text-[8px] font-semibold uppercase ${SCOPE_STYLE[claim.scope]}`}>
                      {claim.scope}
                    </span>
                    <span
                      className={`text-[8px] font-semibold uppercase ${
                        claim.disposition === 'conflict'
                          ? 'text-rose-300'
                          : claim.disposition === 'superseded'
                            ? 'text-slate-500'
                            : 'text-emerald-400/80'
                      }`}
                    >
                      {DISPOSITION_LABEL[claim.disposition]}
                    </span>
                    <span className="basis-full text-[9px] leading-snug text-slate-500">{claim.meaning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {ledger.findings.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
            Stage findings · not additive
          </span>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1 text-[9px] leading-snug text-slate-400">
            {ledger.findings.map((finding) => (
              <span key={finding.producer}>
                {finding.producer}: {finding.errors} error(s) · {finding.warnings} warning(s)
              </span>
            ))}
          </div>
          <p className="pt-1 text-[9px] leading-snug text-slate-500">
            One defect reported by two stages is one defect, so these totals are never summed into a verdict. Any
            non-zero error count blocks a unified success claim even when every population reconciles.
          </p>
        </div>
      )}

      <details className="text-[9px] leading-snug text-slate-500">
        <summary className="cursor-pointer font-semibold text-slate-400">How these numbers are read</summary>
        <div className="flex flex-col gap-1 pt-1.5">
          {ledger.scopes.map((scope) => (
            <span key={scope} className="flex items-start gap-1">
              <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-slate-600" aria-hidden="true" />
              {scope}
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}