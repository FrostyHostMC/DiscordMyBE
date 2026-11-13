import type { ParityHealth } from '@/types/remaker';
import { AlertTriangle, CheckCircle2, ShieldQuestion, Wrench } from 'lucide-react';

const FINDING_STYLE: Record<string, string> = {
  removed: 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300',
  gated: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
  retained: 'border-slate-600/50 bg-slate-900 text-slate-300',
  unresolved: 'border-rose-500/40 bg-rose-950/60 text-rose-300',
};

const STAGE_STYLE: Record<string, string> = {
  ok: 'text-emerald-300',
  skipped: 'text-amber-300',
  failed: 'text-rose-300',
};

/** Bounded repair outcome, stage failures and the per-conversion hardcoding audit. */
export function HardcodingAuditPanel({ parityHealth }: { parityHealth?: ParityHealth }) {
  const audit = parityHealth?.hardcodingAudit;
  const stages = parityHealth?.stageResults ?? [];
  const failedStages = stages.filter((stage) => stage.status === 'failed');
  const openAnomalies = parityHealth?.unresolvedAnomalyCount ?? 0;

  if (!audit && stages.length === 0 && openAnomalies === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          {openAnomalies === 0 && failedStages.length === 0 ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-rose-400" />
          )}
          Repair & Hardcoding Audit
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            openAnomalies === 0 && failedStages.length === 0
              ? 'bg-emerald-950/70 text-emerald-300'
              : 'bg-rose-950/70 text-rose-300'
          }`}
        >
          {openAnomalies === 0 && failedStages.length === 0
            ? 'No open anomalies'
            : `${openAnomalies} unresolved${failedStages.length > 0 ? ` · ${failedStages.length} stage failed` : ''}`}
        </span>
      </div>

      {stages.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {stages.map((stage) => (
            <div key={stage.id} className="flex items-start justify-between gap-2 text-[10px] leading-snug">
              <span className="text-slate-400">{stage.label}</span>
              <span className={`shrink-0 font-semibold uppercase ${STAGE_STYLE[stage.status]}`}>
                {stage.status === 'failed' ? 'STAGE FAILED' : stage.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {audit && (
        <>
          <p className="flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[10px] leading-snug text-slate-400">
            <ShieldQuestion className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
            Scored against this pack only: {audit.summary}. Playable mode {audit.playableMode ? 'ON' : 'OFF'}.
          </p>
          <div className="flex flex-col gap-1">
            {audit.findings.map((finding) => (
              <div key={finding.id} className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-semibold leading-snug text-slate-200">{finding.label}</span>
                  <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${FINDING_STYLE[finding.status]}`}>
                    {finding.status}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-slate-400">{finding.evidence}</p>
                <p className="mt-1 border-l-2 border-cyan-700 pl-1.5 text-[10px] leading-snug text-slate-500">
                  Replaced by: {finding.replacedBy}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {parityHealth && parityHealth.repairedCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <Wrench className="h-3 w-3" /> {parityHealth.repairedCount} repair(s) applied in {parityHealth.loopPassCount} bounded pass(es).
        </span>
      )}
    </div>
  );
}