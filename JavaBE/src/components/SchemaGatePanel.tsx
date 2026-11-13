import type { BedrockSchemaGateReport } from '@/types/remaker';

/**
 * Before/after report for the Bedrock client-schema gate.
 *
 * Every row is a content-log error class measured on the pack that is exported: malformed
 * render controller textures, empty animation nodes, invalid sound asset paths, dangling
 * geometry references, unresolved entity textures, missing item icons and legacy block
 * overrides. A row is only "repaired" when its open count really dropped.
 */

const STATUS_STYLE: Record<'clean' | 'repaired' | 'unresolved', string> = {
  clean: 'border-slate-700 bg-slate-950 text-slate-400',
  repaired: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  unresolved: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

interface SchemaGatePanelProps {
  report?: BedrockSchemaGateReport;
  accent: string;
}

export function SchemaGatePanel({ report, accent }: SchemaGatePanelProps) {
  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[10px] font-semibold uppercase text-slate-500">
          Bedrock client-schema gate
        </span>
        {report && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              report.passed ? STATUS_STYLE.repaired : STATUS_STYLE.unresolved
            }`}
          >
            {report.errorsBefore} → {report.errorsAfter} defect(s)
          </span>
        )}
      </div>

      {!report ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
          No schema gate has run yet. It runs on every export, on the exact pack that ships.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{report.summary}</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {report.checks.map((check) => (
              <div key={check.id} className="rounded border border-slate-800/80 bg-slate-950/70 p-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <span className="font-semibold text-slate-200">{check.label}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-500">
                      {check.errorsBefore} → {check.errorsAfter}
                    </span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[check.status]}`}>
                      {check.status}
                    </span>
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{check.detail}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{check.rule}</p>
              </div>
            ))}
          </div>

          {report.notes.length > 0 && (
            <details className="mt-1.5 rounded border border-slate-800/80 bg-slate-950/60 p-1.5">
              <summary className="min-h-[28px] cursor-pointer text-[11px] font-semibold text-slate-300">
                {report.notes.length} reported item(s) — unresolved source limitations
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {report.notes.slice(0, 16).map((note, index) => (
                  <li key={`${index}-${note.slice(0, 12)}`} className="text-[10px] leading-relaxed text-slate-400">
                    {note}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: `${accent}cc` }}>
            Schema and reference validation only. Gameplay compatibility in a live Bedrock client is
            tested separately and is not measured here.
          </p>
        </>
      )}
    </div>
  );
}