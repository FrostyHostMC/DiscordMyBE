import { useState } from 'react';
import type { ConversionManifestReport, SourceAssetDisposition } from '@/types/remaker';
import { SOURCE_KIND_LABELS } from '@/utils/conversionManifest';

/**
 * Phase 10 — conversion documentation panel.
 *
 * Lists what was consumed, what was produced, what was not carried and what failed, so the
 * export can be audited file by file. Nothing here is inferred: the counts come from the
 * manifest built for the pack that is actually being exported.
 */

interface ConversionManifestPanelProps {
  manifest?: ConversionManifestReport;
  accent: string;
}

const DISPOSITION_LABEL: Record<SourceAssetDisposition, string> = {
  carried: 'Carried',
  converted: 'Converted',
  analyzed: 'Analysed as evidence',
  'not-carried': 'Not carried',
  failed: 'Failed',
};

const DISPOSITION_ORDER: SourceAssetDisposition[] = ['converted', 'carried', 'analyzed', 'failed', 'not-carried'];

const DISPOSITION_STYLE: Record<SourceAssetDisposition, string> = {
  carried: 'text-emerald-300',
  converted: 'text-sky-300',
  analyzed: 'text-slate-300',
  failed: 'text-rose-300',
  'not-carried': 'text-amber-300',
};

export function ConversionManifestPanel({ manifest, accent }: ConversionManifestPanelProps) {
  const [copied, setCopied] = useState(false);

  const copyDocumentation = async () => {
    if (!manifest) return;
    try {
      await navigator.clipboard.writeText(manifest.documentation.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div>
          <h2 className="text-sm font-bold text-slate-100">Conversion Documentation</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Every source file consumed and every generated file, recorded per export.
          </p>
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{ borderColor: `${accent}55`, background: `${accent}18`, color: accent }}
        >
          PHASE 10
        </span>
      </div>

      {!manifest ? (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
          No conversion record yet. Load a mod and run the port engine — the documentation is produced for every export.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
              <span className="block text-[10px] uppercase text-slate-500">Source files</span>
              <span className="font-mono text-base font-extrabold text-sky-400">{manifest.sources.length}</span>
              <span className="block text-[10px] text-slate-500">{manifest.notCarried} not carried</span>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
              <span className="block text-[10px] uppercase text-slate-500">Generated files</span>
              <span className="font-mono text-base font-extrabold text-emerald-400">{manifest.outputs.length}</span>
              <span className="block text-[10px] text-slate-500">{manifest.structureFiles} pack structure</span>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
              <span className="block text-[10px] uppercase text-slate-500">Evidence only</span>
              <span className="font-mono text-base font-extrabold text-slate-300">{manifest.analyzed}</span>
              <span className="block text-[10px] text-slate-500">Java read for behaviour</span>
            </div>
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2">
              <span className="block text-[10px] uppercase text-slate-500">Failures</span>
              <span className="font-mono text-base font-extrabold text-rose-400">{manifest.failures.length}</span>
              <span className="block text-[10px] text-slate-500">Kept, not discarded</span>
            </div>
          </div>

          <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[11px] leading-relaxed text-slate-300">
            {manifest.summary}
          </p>

          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase text-slate-500">Source files by kind</span>
            {Object.entries(manifest.categoryCounts).map(([kind, counts]) => (
              <div
                key={kind}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/50 px-2 py-1.5 text-[11px]"
              >
                <span className="font-semibold text-slate-200">
                  {SOURCE_KIND_LABELS[kind as keyof typeof SOURCE_KIND_LABELS] ?? kind}
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  {counts?.total ?? 0} total · {counts?.carried ?? 0} carried · {counts?.converted ?? 0} converted ·{' '}
                  {counts?.analyzed ?? 0} evidence
                  {counts?.failed ? ` · ${counts.failed} failed` : ''}
                  {counts?.notCarried ? ` · ${counts.notCarried} not carried` : ''}
                </span>
              </div>
            ))}
          </div>

          {DISPOSITION_ORDER.map((disposition) => {
            const rows = manifest.sources.filter((source) => source.disposition === disposition);
            if (rows.length === 0) return null;
            return (
              <details key={disposition} className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                <summary className="min-h-[32px] cursor-pointer text-[11px] font-semibold text-slate-200">
                  {DISPOSITION_LABEL[disposition]} — {rows.length} source file(s)
                </summary>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {rows.slice(0, 20).map((source) => (
                    <li key={source.path} className="rounded border border-slate-800/70 bg-slate-950/60 p-1.5">
                      <p className={`font-mono text-[10px] ${DISPOSITION_STYLE[disposition]}`}>{source.path}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{source.evidence}</p>
                      {source.outputs.length > 0 && (
                        <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-slate-500">
                          → {source.outputs.slice(0, 3).join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {rows.length > 20 && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    {rows.length - 20} further file(s) are recorded in the report data.
                  </p>
                )}
              </details>
            );
          })}

          {manifest.noDirectSourceFiles > 0 && (
            <details className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
              <summary className="min-h-[32px] cursor-pointer text-[11px] font-semibold text-slate-300">
                {manifest.noDirectSourceFiles} generated file(s) with no direct source file
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1">
                {manifest.outputs
                  .filter((output) => output.origin === 'no-direct-source')
                  .slice(0, 15)
                  .map((output) => (
                    <li key={`${output.role}:${output.path}`} className="font-mono text-[10px] text-slate-400">
                      [{output.role}] {output.path}
                    </li>
                  ))}
              </ul>
            </details>
          )}

          {manifest.failures.length > 0 && (
            <details className="mt-2 rounded-lg border border-rose-900/40 bg-rose-950/20 p-2">
              <summary className="min-h-[32px] cursor-pointer text-[11px] font-semibold text-rose-200">
                {manifest.failures.length} recorded failure(s)
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1">
                {manifest.failures.slice(0, 15).map((failure) => (
                  <li key={failure} className="text-[11px] leading-relaxed text-rose-100/80">
                    {failure}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <details className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
            <summary className="min-h-[32px] cursor-pointer text-[11px] font-semibold text-slate-200">
              Full documentation ({manifest.documentation.length} lines)
            </summary>
            <button
              type="button"
              onClick={() => void copyDocumentation()}
              className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-[11px] font-semibold text-slate-200 active:scale-[0.99]"
            >
              {copied ? 'Copied' : 'Copy documentation'}
            </button>
            <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-800/70 bg-slate-950/70 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
              {manifest.documentation.join('\n')}
            </pre>
            {manifest.documentationTruncated && (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-300/80">
                The archive is large, so the printed listing is capped. Every file is still present in the report data.
              </p>
            )}
          </details>
        </>
      )}
    </section>
  );
}