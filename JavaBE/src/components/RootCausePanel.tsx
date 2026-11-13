import type { AssetValidationReport } from '@/types/remaker';

/**
 * Root-Cause Analysis console.
 *
 * FIX 7: the first real conversion reported 101,827 defects, which is not 101,827 problems.
 * This view shows the defects grouped by the root cause that produced them, ranked by impact,
 * with the frozen per-instance rows kept separate so an individual failure is never mistaken
 * for a root-cause failure.
 */

interface RootCausePanelProps {
  report?: AssetValidationReport;
  accent: string;
}

const SEVERITY_STYLE: Record<'error' | 'warning' | 'info', string> = {
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  info: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
};

export function RootCausePanel({ report, accent }: RootCausePanelProps) {
  if (!report) return null;
  const causes = report.rootCauses;
  const schema = report.schema;
  const instanceLabel = report.reportingCapped ? 'grouped instances' : 'instances';

  return (
    <section className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800/80 pb-2">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-200">Root-Cause Analysis</h3>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            Findings grouped by the defect that produced them — not counted one file at a time.
          </p>
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{ borderColor: `${accent}55`, background: `${accent}18`, color: accent }}
        >
          FIX 7
        </span>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[9px] uppercase text-slate-500">Root causes</span>
          <span className="font-mono text-sm font-extrabold text-sky-400">{report.rootCauseCount}</span>
          <span className="block text-[9px] text-slate-500">{report.openFindingCount} {instanceLabel}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[9px] uppercase text-slate-500">Systemic</span>
          <span className="font-mono text-sm font-extrabold text-rose-400">{report.systemicRootCauseCount}</span>
          <span className="block text-[9px] text-slate-500">repeat across files</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[9px] uppercase text-slate-500">Deferred</span>
          <span className="font-mono text-sm font-extrabold text-amber-400">{report.deferredRepairCount}</span>
          <span className="block text-[9px] text-slate-500">budget-bound repairs</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block text-[9px] uppercase text-slate-500">Pack schema</span>
          <span
            className={`font-mono text-sm font-extrabold ${schema.passed ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {schema.passed ? 'PASS' : 'FAIL'}
          </span>
          <span className="block text-[9px] text-slate-500">{schema.defects} defect(s)</span>
        </div>
      </div>

      <p className="mt-2 rounded border border-slate-800/80 bg-slate-950/70 p-2 text-[10px] leading-relaxed text-slate-400">
        Manifest schema: {schema.requirements} requirement(s) across {schema.manifestsChecked} manifest(s) ·{' '}
        {schema.resourceModules} resource module(s) · {schema.behaviorModules} behaviour module(s) ·{' '}
        {schema.dependencies} dependency entr(y/ies) · {schema.scriptModules} script module(s) · pack icon{' '}
        {schema.packIcon ? 'present' : 'missing'}.
      </p>

      {causes.length === 0 ? (
        <p className="mt-2 rounded border border-emerald-900/40 bg-emerald-950/20 p-2 text-[10px] leading-relaxed text-emerald-300">
          No open root cause remains in the exported pack. This is structural evidence only — it does not prove the pack
          plays correctly in game.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {causes.slice(0, 12).map((cause) => (
            <li key={cause.id} className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
              <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                <span className="text-[11px] font-semibold leading-snug text-slate-200">{cause.title}</span>
                <span className="flex items-center gap-1">
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${SEVERITY_STYLE[cause.severity]}`}>
                    {cause.severity}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">
                    {cause.count}x
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                    impact {cause.impactScore}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{cause.rootCause}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                {cause.check} · {cause.fileCount} file(s)
                {cause.systemic ? ' · systemic' : ' · isolated'}
                {cause.repairable > 0 ? ` · ${cause.repairable} safely repairable` : ' · no safe repair'}
                {cause.deferred > 0 ? ` · ${cause.deferred} deferred` : ''}
                {cause.conversionFailures > 0 ? ` · ${cause.conversionFailures} failed conversion(s)` : ''}
              </p>
              <details className="mt-1">
                <summary className="min-h-[28px] cursor-pointer text-[10px] font-semibold text-slate-400">
                  Affected paths &amp; recommended fix
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {cause.files.map((file) => (
                    <li key={file} className="font-mono text-[9px] leading-relaxed text-slate-500">
                      {file}
                    </li>
                  ))}
                  {cause.fileCount > cause.files.length && (
                    <li className="text-[9px] text-slate-600">
                      +{cause.fileCount - cause.files.length} further file(s) in this root cause
                    </li>
                  )}
                </ul>
                <p className="mt-1 text-[10px] leading-relaxed text-amber-200/70">{cause.recommendation}</p>
              </details>
            </li>
          ))}
        </ul>
      )}

      {report.rootCauseCount > 12 && (
        <p className="mt-1 text-[10px] text-slate-500">
          {report.rootCauseCount - 12} further root cause(s) are listed in the exported report.
        </p>
      )}
      <p className="mt-1.5 text-[9px] leading-relaxed text-slate-500">
        A root-cause count is a defect count; an instance count is how many files show it. Repairs are bounded to two
        passes and to a per-root-cause budget, so an unresolved defect is reported rather than repaired on repeat.
      </p>
    </section>
  );
}