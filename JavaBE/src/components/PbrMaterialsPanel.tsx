import { AlertCircle, Layers, Sparkles } from 'lucide-react';
import type { PbrMaterialReport } from '@/utils/pbrMaterialsBuilder';

interface Props {
  report?: PbrMaterialReport;
  accent: string;
}

const PROVENANCE_STYLE: Record<string, string> = {
  SOURCE: 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300',
  ADAPTED: 'border-sky-500/30 bg-sky-950/60 text-sky-300',
  SCAFFOLD: 'border-slate-600/50 bg-slate-900 text-slate-300',
  INVENTED: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
  ABSENT: 'border-rose-500/40 bg-rose-950/50 text-rose-300',
};

export function PbrMaterialsPanel({ report, accent }: Props) {
  if (!report) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <Layers className="h-3.5 w-3.5 text-cyan-400" /> PBR / Deferred Material Mapping
        </span>
        <p className="pt-1.5 text-[10px] leading-relaxed text-slate-400">
          Not run yet. Import a Java mod, resource pack or shader pack and convert — every PBR channel map
          (normal, specular, emissive, height) found by naming convention is bound to Bedrock texture sets and
          logged here.
        </p>
      </div>
    );
  }

  const registered = report.textureSets.filter((set) => set.status === 'registered');
  const unresolvedMaps = report.maps.filter((map) => map.status === 'unresolved');
  const skippedMaps = report.maps.filter((map) => map.status === 'skipped');

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <Layers className="h-3.5 w-3.5 text-cyan-400" /> PBR / Deferred Material Mapping
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            report.capabilityEnabled
              ? 'border border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
              : 'border border-slate-700 bg-slate-900 text-slate-400'
          }`}
        >
          {report.capabilityEnabled ? 'manifest capability "pbr" declared' : 'capability not declared'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Texture Sets</span>
          <span className="font-mono text-sm font-extrabold" style={{ color: accent }}>{report.textureSetsWritten}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Maps Bound</span>
          <span className="font-mono text-sm font-extrabold text-emerald-400">{report.mapsRegistered}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">MER Re-encoded</span>
          <span className="font-mono text-sm font-extrabold text-sky-400">{report.synthesizedMer}</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Unresolved</span>
          <span className="font-mono text-sm font-extrabold text-rose-400">{report.mapsUnresolved}</span>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-400">{report.summary}</p>

      {registered.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          {registered.slice(0, 10).map((set) => (
            <div key={set.textureSetPath} className="flex flex-col gap-0.5 border-b border-slate-800/60 pb-1 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-mono text-[10px] text-slate-200">{set.textureSetPath}</span>
                <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold ${PROVENANCE_STYLE[set.provenance]}`}>
                  {set.provenance}
                </span>
              </div>
              <span className="text-[9px] text-slate-500">
                color {set.color}
                {set.normal ? ` · normal ${set.normal}` : ''}
                {set.mer ? ` · MER ${set.mer}` : ''}
                {set.heightmap ? ` · heightmap ${set.heightmap}` : ''}
              </span>
            </div>
          ))}
          {registered.length > 10 && (
            <span className="text-[9px] text-slate-500">+{registered.length - 10} more texture set(s) in the exported pack.</span>
          )}
        </div>
      )}

      {(unresolvedMaps.length > 0 || skippedMaps.length > 0) && (
        <div className="flex flex-col gap-1 rounded-lg border border-rose-900/40 bg-rose-950/20 p-2">
          {unresolvedMaps.slice(0, 6).map((map) => (
            <span key={`${map.sourcePath}-${map.channel}`} className="flex items-start gap-1 text-[9px] leading-snug text-rose-300">
              <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              <span className="break-all">{map.sourcePath} — {map.note}</span>
            </span>
          ))}
          {skippedMaps.length > 0 && (
            <span className="text-[9px] text-amber-300/80">{skippedMaps.length} duplicate/over-budget map(s) were skipped, not silently dropped.</span>
          )}
        </div>
      )}

      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2 font-mono text-[9px] leading-relaxed">
        {report.log.length === 0 ? (
          <p className="text-slate-500">No PBR log lines recorded.</p>
        ) : (
          report.log.map((line, index) => (
            <p
              key={`${index}-${line.slice(0, 12)}`}
              className={line.includes('UNRESOLVED') || line.includes('ERROR') ? 'text-rose-300' : line.includes('SET') ? 'text-emerald-300' : 'text-slate-400'}
            >
              {line}
            </p>
          ))
        )}
      </div>

      <p className="flex items-start gap-1 text-[9px] leading-snug text-slate-500">
        <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-cyan-400" />
        <span>
          Material data only — Java shader code is not executed on Bedrock. <b>{report.mapsDetected}</b> channel map(s) were detected across{' '}
          <b>{report.baseTextures}</b> base texture(s). Enable Render Dragon / Deferred Technical Preview in the client to see the result;
          this conversion is structural and has not been verified in game.
        </span>
      </p>
    </div>
  );
}