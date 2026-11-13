import type { UniversalTextureEngineReport } from '@/utils/universalTextureEngine';

interface TextureEngineStatusPanelProps {
  report?: UniversalTextureEngineReport | null;
  accent: string;
}

interface Chip {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
}

function chipClass(tone: Chip['tone']): string {
  if (tone === 'ok') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (tone === 'warn') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300';
  if (tone === 'bad') return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-slate-700 bg-slate-800/60 text-slate-300';
}

/**
 * Universal Texture Engine status: what was decoded, what is animated (and with
 * which frame timing), which channel maps were found, and which references were
 * repaired or left unmatched. Every number is derived from real file metadata.
 */
export function TextureEngineStatusPanel({ report, accent }: TextureEngineStatusPanelProps) {
  if (!report) return null;

  const unresolved = report.issues.filter((issue) => !issue.resolved);
  const chips: Chip[] = [
    { label: `${report.discovered} decoded`, tone: 'neutral' },
    { label: `${report.alphaTextures} alpha kept`, tone: 'ok' },
    { label: `${report.animated} animated`, tone: report.animated > 0 ? 'ok' : 'neutral' },
    { label: `${report.appliedFlipbookCount} flipbook`, tone: report.appliedFlipbookCount > 0 ? 'ok' : 'neutral' },
    { label: `${report.repairedReferences.length} repaired`, tone: report.repairedReferences.length > 0 ? 'warn' : 'ok' },
    { label: `${report.missingReferences.length} unmatched`, tone: report.missingReferences.length > 0 ? 'bad' : 'ok' },
  ];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Universal Texture Engine</h3>
        <span className="text-[10px] font-semibold text-slate-500">
          {report.oversized.length} oversized · {report.stripsWithoutMetadata.length} no-metadata
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
        {chips.map((chip) => (
          <span key={chip.label} className={`rounded-full border px-2 py-0.5 ${chipClass(chip.tone)}`}>
            {chip.label}
          </span>
        ))}
      </div>

      {(report.emissive.length > 0 || report.normalMaps.length > 0 || report.appliedFlipbookCount > 0) && (
        <div className="space-y-0.5 text-[10px] leading-relaxed text-slate-400">
          {report.appliedFlipbookCount > 0 && (
            <p>
              <span className="text-slate-200">Flipbooks:</span>{' '}
              {report.flipbooks
                .slice(0, 3)
                .map((entry) => `${entry.atlas_tile} (${entry.ticks_per_frame}t${entry.frames ? ', ordered' : ''})`)
                .join(', ')}
              {report.appliedFlipbookCount > 3 ? ` +${report.appliedFlipbookCount - 3} more` : ''}
            </p>
          )}
          {report.emissive.length > 0 && (
            <p>
              <span className="text-slate-200">Emissive:</span> {report.emissive.slice(0, 3).join(', ')}
            </p>
          )}
          {report.normalMaps.length > 0 && (
            <p>
              <span className="text-slate-200">Normal:</span> {report.normalMaps.slice(0, 3).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-1.5 font-mono text-[10px] leading-relaxed">
        {unresolved.length === 0 ? (
          <p className="text-emerald-300">✔ No texture adjustments were needed.</p>
        ) : (
          unresolved.slice(0, 10).map((issue, index) => (
            <p key={`${issue.kind}-${index}`} className={issue.kind === 'missing-reference' ? 'text-red-300' : 'text-yellow-300'}>
              {issue.kind.toUpperCase()} {issue.path}
            </p>
          ))
        )}
      </div>

      <p className="text-[10px] leading-relaxed" style={{ color: `${accent}aa` }}>
        Dimensions, aspect ratio and alpha are preserved; no texture is stretched, replaced or dropped without a
        report line.
      </p>
    </div>
  );
}