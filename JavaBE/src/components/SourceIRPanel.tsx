import type { SourceDiscoveryReport, UniversalIRReport } from '@/types/remaker';
import { GitBranch, Layers, Link2, Cpu, Unlink } from 'lucide-react';

interface Props {
  sourceIR?: UniversalIRReport;
  discovery?: SourceDiscoveryReport;
  accent: string;
}

const REFERENCE_CELL: Record<'resolved' | 'external' | 'unresolved', string> = {
  resolved: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/30',
  external: 'bg-slate-900 text-slate-300 border-slate-600/50',
  unresolved: 'bg-rose-950/60 text-rose-300 border-rose-500/30',
};

/**
 * Universal source analysis & intermediate representation.
 * This panel shows what the engine read from the archive — never what it generated.
 */
export function SourceIRPanel({ sourceIR, discovery, accent }: Props) {
  if (!sourceIR && !discovery) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Source analysis &amp; intermediate representation
        </span>
        <p className="pt-1 text-[10px] leading-snug text-slate-500">
          NOT MEASURED — run a conversion to build the analysis record for this archive.
        </p>
      </div>
    );
  }

  const references = sourceIR?.references;
  const domains = (sourceIR?.domainCounts ?? []).slice(0, 12);
  const aspects = (sourceIR?.unresolvedAspects ?? []).slice(0, 10);
  const samples = (references?.samples ?? []).slice(0, 8);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <GitBranch className="h-3 w-3" style={{ color: accent }} />
          Source Analysis &amp; IR
        </span>
        <span className="rounded border border-slate-700 bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          analysis only
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block uppercase text-slate-500">Documents</span>
          <span className="font-mono text-sm font-bold text-slate-100">{discovery?.documentCount ?? 0}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block uppercase text-slate-500">IR Objects</span>
          <span className="font-mono text-sm font-bold" style={{ color: accent }}>{sourceIR?.nodeCount ?? 0}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block uppercase text-slate-500">References</span>
          <span className="font-mono text-sm font-bold text-emerald-300">{references?.resolved ?? 0}/{references?.total ?? 0}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5">
          <span className="block uppercase text-slate-500">Unresolved</span>
          <span className={`font-mono text-sm font-bold ${(references?.unresolved ?? 0) > 0 ? 'text-rose-300' : 'text-slate-300'}`}>
            {references?.unresolved ?? 0}
          </span>
        </div>
      </div>

      {(discovery?.loaders.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Cpu className="h-3 w-3 text-slate-500" />
          {discovery?.loaders.map((loader) => (
            <span key={loader.loader} className="rounded border border-sky-500/30 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
              {loader.loader} adapter
            </span>
          ))}
          {(discovery?.namespaces ?? []).slice(0, 4).map((namespace) => (
            <span key={namespace} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{namespace}</span>
          ))}
        </div>
      )}

      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {domains.map((entry) => (
            <span key={entry.domain} className="rounded border border-slate-800 bg-slate-950/70 px-1.5 py-0.5 text-[10px] text-slate-300">
              {entry.domain} <span className="font-mono font-bold text-slate-100">{entry.count}</span>
            </span>
          ))}
        </div>
      )}

      {references && references.total > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Link2 className="h-3 w-3 text-emerald-400" />
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${REFERENCE_CELL.resolved}`}>{references.resolved} resolved</span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${REFERENCE_CELL.external}`}>{references.external} vanilla/other</span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${REFERENCE_CELL.unresolved}`}>{references.unresolved} unresolved</span>
        </div>
      )}

      {sourceIR && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
          <Layers className="h-3 w-3 text-slate-500" />
          <span>{sourceIR.confidence.high} high</span>
          <span>· {sourceIR.confidence.medium} medium</span>
          <span>· {sourceIR.confidence.low} low</span>
          <span>· {sourceIR.confidence.unknown} unrecovered</span>
          <span>· {sourceIR.transformationCount} recorded transform(s)</span>
        </div>
      )}

      {aspects.length > 0 && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-300">Recovered nothing — reported, not filled in</span>
          <ul className="mt-1 flex flex-col gap-0.5 text-[10px] leading-snug text-amber-200/90">
            {aspects.map((aspect) => <li key={aspect}>• {aspect}</li>)}
          </ul>
        </div>
      )}

      {samples.length > 0 && (
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-1.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-300">
            <Unlink className="h-3 w-3" /> Unresolved source references
          </span>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[10px] leading-snug text-rose-200/90">
            {samples.map((sample) => <li key={`${sample.evidence}-${sample.target}`}>{sample.target} ← {sample.evidence}</li>)}
          </ul>
        </div>
      )}

      <p className="text-[10px] leading-snug text-slate-500">
        {sourceIR?.summary ?? discovery?.summary}
      </p>
      <p className="text-[10px] leading-snug text-slate-500">
        An IR object existing only proves the source declares it. Conversion, structural validation and packaging are separate stages; nothing here has been tested inside a live Bedrock client.
      </p>
    </div>
  );
}