import { useState } from 'react';
import { Activity, AlertTriangle, Braces, Info, Play } from 'lucide-react';
import type { ParityGapAnalysis } from '@/types/remaker';
import { MolangSandbox } from '@/components/MolangSandbox';

interface Props {
  analysis?: ParityGapAnalysis;
}

const DEFAULT_EXPRESSION = 'math.clamp(query.health / 20, 0, 1)';

export function ParityGapPanel({ analysis }: Props) {
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxExpression, setSandboxExpression] = useState(DEFAULT_EXPRESSION);
  const molangCount = analysis?.findings.filter((finding) => finding.category === 'molang').length ?? 0;
  const entityCount = analysis?.findings.filter((finding) => finding.category === 'entity').length ?? 0;

  const openSandbox = (expression = DEFAULT_EXPRESSION) => {
    setSandboxExpression(expression);
    setSandboxOpen(true);
  };

  return (
    <section aria-label="Parity gap findings" className="flex flex-col gap-3">
      <header className="rounded-xl border border-amber-700/40 bg-amber-950/30 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <h2 className="text-sm font-bold text-slate-100">Parity Gap Analysis</h2>
            <p className="text-[11px] text-amber-200/80">
              {analysis ? `${analysis.uncoveredPercent} points remain outside verified factual parity` : 'Inspect expression behavior before exporting your port'}
            </p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
          Test Molang values against editable mock health, velocity, and time. Static findings are manual review candidates, not claims that every listed behavior is broken.
        </p>
        <button
          type="button"
          onClick={() => openSandbox()}
          className="mt-3 flex min-h-[60px] w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 text-xs font-extrabold text-slate-950 active:scale-[0.99]"
        >
          <Braces className="h-4 w-4" /> Open Molang Sandbox
        </button>
      </header>

      {analysis ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Entities inspected</span>
              <span className="font-mono text-lg font-bold text-slate-100">{analysis.inspectedEntities}</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Molang strings</span>
              <span className="font-mono text-lg font-bold text-cyan-300">{analysis.inspectedMolangExpressions}</span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
              <span className="block text-[10px] uppercase text-slate-500">Review findings</span>
              <span className="font-mono text-lg font-bold text-amber-300">{analysis.findings.length}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
            <span className="rounded-md border border-cyan-700/50 bg-cyan-950/40 px-2.5 py-1.5 text-cyan-200">
              <Braces className="mr-1 inline h-3 w-3" /> {molangCount} Molang groups
            </span>
            <span className="rounded-md border border-sky-700/50 bg-sky-950/40 px-2.5 py-1.5 text-sky-200">
              {entityCount} entity behavior groups
            </span>
          </div>

          {analysis.findings.length === 0 ? (
            <p className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-3 text-xs text-emerald-200">
              No static manual-review candidates were found. Live gameplay parity still requires testing in Bedrock.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {analysis.findings.map((finding) => (
                <article key={finding.id} className={`rounded-xl border bg-slate-950/80 p-3 ${finding.severity === 'high' ? 'border-rose-800/60' : finding.severity === 'medium' ? 'border-amber-800/50' : 'border-slate-800'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-bold leading-snug text-slate-100">{finding.title}</h3>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${finding.severity === 'high' ? 'border-rose-700/50 text-rose-300' : finding.severity === 'medium' ? 'border-amber-700/50 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
                      {finding.severity === 'review' ? 'Review' : finding.severity}
                    </span>
                  </div>
                  <p className="mt-1.5 break-words font-mono text-[10px] leading-relaxed text-cyan-200">{finding.target}</p>
                  {finding.expression && (
                    <>
                      <code className="mt-2 block overflow-x-auto rounded-md border border-slate-800 bg-slate-900 p-2 font-mono text-[11px] text-amber-200">{finding.expression}</code>
                      <button
                        type="button"
                        onClick={() => openSandbox(finding.expression ?? DEFAULT_EXPRESSION)}
                        className="mt-2 flex min-h-[60px] items-center gap-2 rounded-lg border border-sky-800/70 bg-sky-950/40 px-3 text-[11px] font-bold text-sky-200 active:bg-sky-900/60"
                      >
                        <Play className="h-3.5 w-3.5" /> Test this expression
                      </button>
                    </>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{finding.evidence}</p>
                  <p className="mt-2 border-l-2 border-cyan-700 pl-2 text-[11px] leading-relaxed text-slate-400">Manual fine-tuning: {finding.suggestedAction}</p>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-400">
          Run a port to inspect file-backed findings. You can still try an expression in the sandbox now.
        </p>
      )}

      {sandboxOpen && (
        <MolangSandbox
          key={sandboxExpression}
          initialExpression={sandboxExpression}
          onClose={() => setSandboxOpen(false)}
        />
      )}
    </section>
  );
}