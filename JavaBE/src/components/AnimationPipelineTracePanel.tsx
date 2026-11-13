import type { AnimationPipelineTraceReport } from '@/utils/pipelineTrace';

/**
 * Engine execution trace panel.
 *
 * Answers one question with evidence instead of reassurance: did the current animation engine
 * produce this archive, or did an older writer produce it while the new code sat unused? The list
 * is the order the stages actually ran in this conversion, and the fingerprint comparison proves the
 * files the final audits measured are the files that were zipped.
 */

interface AnimationPipelineTracePanelProps {
  trace?: AnimationPipelineTraceReport;
  accent: string;
}

const VERDICT_STYLE: Record<AnimationPipelineTraceReport['verdict'], string> = {
  fresh: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  stale: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'engine-missing': 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'not-measured': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

const VERDICT_LABEL: Record<AnimationPipelineTraceReport['verdict'], string> = {
  fresh: 'FRESH MERGE VERIFIED',
  stale: 'STALE — WRITER AFTER AUDIT',
  'engine-missing': 'ENGINE DID NOT RUN',
  'not-measured': 'NOT MEASURED',
};

export function AnimationPipelineTracePanel({ trace, accent }: AnimationPipelineTracePanelProps) {
  if (!trace) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800 pb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
          Engine execution trace
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[trace.verdict]}`}>
          {VERDICT_LABEL[trace.verdict]}
        </span>
      </div>

      <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[11px] leading-relaxed text-slate-300">
        {trace.summary}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[10px] uppercase text-slate-500">Stages run</span>
          <span className="font-mono text-sm font-extrabold" style={{ color: accent }}>
            {trace.stages.length}
          </span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[10px] uppercase text-slate-500">Clip(s) audited</span>
          <span className="font-mono text-sm font-extrabold text-sky-300">{trace.clipCountAtAudit}</span>
          <span className="block text-[10px] text-slate-500">exported {trace.clipCountAtExport}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[10px] uppercase text-slate-500">Animation files</span>
          <span className="font-mono text-sm font-extrabold text-violet-300">{trace.animationFileCount}</span>
          <span className="block text-[10px] text-slate-500">measured = zipped</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[10px] uppercase text-slate-500">Post-audit writes</span>
          <span
            className={`font-mono text-sm font-extrabold ${
              trace.mutatedAfterAudit.length === 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {trace.mutatedAfterAudit.length}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-1">
        {trace.stages.map((stage) => (
          <div key={`${stage.index}-${stage.engine}`} className="rounded-lg border border-slate-800/70 bg-slate-950/50 p-1.5">
            <div className="flex items-baseline justify-between gap-1.5">
              <span className="font-mono text-[10px] text-slate-500">{stage.index}</span>
              <span className="flex-1 truncate font-mono text-[10px] font-semibold text-slate-200">{stage.engine}</span>
            </div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{stage.detail}</p>
          </div>
        ))}
      </div>

      {trace.missingEngines.length > 0 && (
        <div className="mt-2 rounded-lg border border-rose-900/50 bg-rose-950/30 p-2">
          <span className="text-[10px] font-semibold uppercase text-rose-300">Engines that produced no result</span>
          {trace.missingEngines.map((entry) => (
            <p key={entry} className="mt-1 text-[10px] leading-relaxed text-rose-100/80">
              {entry}
            </p>
          ))}
        </div>
      )}

      {trace.mutatedAfterAudit.length > 0 && (
        <details className="mt-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-2">
          <summary className="min-h-[32px] cursor-pointer text-[10px] font-semibold text-amber-200">
            {trace.mutatedAfterAudit.length} file(s) changed after the final audit
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {trace.mutatedAfterAudit.slice(0, 12).map((entry) => (
              <li key={entry} className="font-mono text-[10px] leading-relaxed text-amber-100/80">
                {entry}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-slate-500">
        run {trace.runId} · audit {trace.auditFingerprint || 'n/a'} · export {trace.exportFingerprint}
      </p>
    </div>
  );
}