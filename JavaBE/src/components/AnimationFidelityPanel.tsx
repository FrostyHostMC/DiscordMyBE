import { Activity, AlertTriangle, CheckCircle2, GitBranch, Link2, Ruler, Waypoints } from 'lucide-react';
import type { AnimationFidelityReport } from '@/utils/animationFidelityValidator';
import type { AnimationDependencyReport } from '@/utils/animationDependencyReconstructor';
import type { UniversalAnimationExportReport } from '@/utils/universalAnimationExporter';

interface Props {
  fidelity?: AnimationFidelityReport | null;
  dependencies?: AnimationDependencyReport | null;
  exporter?: UniversalAnimationExportReport | null;
  accent: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  error: 'border-rose-500/40 bg-rose-950/40 text-rose-300',
  warning: 'border-amber-500/40 bg-amber-950/40 text-amber-300',
  info: 'border-slate-700 bg-slate-900 text-slate-400',
};

export function AnimationFidelityPanel({ fidelity, dependencies, exporter, accent }: Props) {
  if (!fidelity && !dependencies && !exporter) return null;

  const exported = fidelity?.exportedMetrics;
  const curveErrors = fidelity?.issues.filter((issue) => issue.severity === 'error').length ?? 0;
  const curveWarnings = fidelity?.issues.filter((issue) => issue.severity === 'warning').length ?? 0;
  const drift = fidelity?.averageFidelity == null
    ? 0
    : Math.max(0, Math.min(100, fidelity.averageFidelity));
  const skeletonCoverage = exported?.bones.checked
    ? `${exported.bones.resolved}/${exported.bones.checked}`
    : '—';

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: accent }} aria-hidden="true" />
            Animation fidelity · scope-specific measurements
          </span>
          {fidelity && (
            <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
              {fidelity.averageFidelity === null ? 'curve match not measured' : `${fidelity.averageFidelity}% curve match only`}
            </span>
          )}
        </div>

        {fidelity && (
          <>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-3">
              {[
                { icon: Ruler, label: 'Source IR', value: fidelity.clipsInterpreted, hint: 'clips interpreted' },
                { icon: CheckCircle2, label: 'IR clips with definitions', value: `${fidelity.clipsShipped}/${fidelity.clipsInterpreted}`, hint: `${fidelity.clipsMissing} not in final definitions` },
                { icon: Activity, label: 'Curves sampled', value: fidelity.channelsCompared, hint: `${fidelity.samplesPerChannel} points per channel` },
                { icon: GitBranch, label: 'Final skeleton', value: skeletonCoverage, hint: `${exported?.bones.unresolved.length ?? 0} unresolved final bindings` },
                { icon: Waypoints, label: 'Source tracks retained', value: `${fidelity.sourceBoneTracksRetained}/${fidelity.sourceBoneTracks}`, hint: `${fidelity.boneTrackCoverage}% in shipped clip definitions` },
                { icon: Link2, label: 'Final activation', value: `${exported?.clipsActivated ?? 0}/${exported?.clipsRegistered ?? 0}`, hint: 'active paths / selectable IDs' },
              ].map(({ icon: Icon, label, value, hint }) => (
                <div key={label} className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-1.5">
                  <div className="flex items-center gap-1">
                    <Icon className="h-2.5 w-2.5" style={{ color: accent }} />
                    <span className="truncate text-[9px] uppercase text-slate-500">{label}</span>
                  </div>
                  <span className="font-mono text-sm font-bold text-slate-100">{value}</span>
                  <span className="block truncate text-[9px] leading-snug text-slate-500">{hint}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${drift}%`, backgroundColor: accent }} />
            </div>
            <p className="pt-1.5 text-[10px] leading-snug text-slate-400">{fidelity.summary}</p>
            <details className="pt-1.5 text-[9px] leading-snug text-slate-500">
              <summary className="cursor-pointer font-semibold text-slate-400">Measurement definitions</summary>
              <div className="flex flex-col gap-1 pt-1.5">
                {fidelity.metricScopes.map((scope) => <span key={scope}>{scope}</span>)}
              </div>
            </details>
          </>
        )}

        {(exporter || dependencies) && (
          <div className="mt-1.5 grid grid-cols-2 gap-1 text-[9px] leading-snug text-slate-400 sm:grid-cols-3">
            {exporter && (
              <>
                <span>Writer emitted (pass): <span className="font-mono text-slate-200">{exporter.emittedClips.length}</span></span>
                <span>Writer registration actions (pass): <span className="font-mono text-slate-200">{exporter.registeredClips.length}</span></span>
                <span>Writer standalone owners: <span className="font-mono text-slate-200">{exporter.standaloneOwners.length}</span></span>
              </>
            )}
            {dependencies && (
              <>
                <span>Final definition IDs: <span className="font-mono text-slate-200">{exported?.clipsDefined ?? '—'}</span></span>
                <span>Dependency-pass unresolved edges: <span className="font-mono text-slate-200">
                  {dependencies.unresolvedEntityAnimationRefs.length + dependencies.unresolvedAnimateEntries.length + dependencies.unresolvedControllerAnimationRefs.length}
                </span></span>
                <span>Final unresolved bone bindings: <span className="font-mono text-slate-200">{exported?.bones.unresolved.length ?? '—'}</span></span>
              </>
            )}
          </div>
        )}
        {(exporter || dependencies) && <p className="pt-1 text-[9px] leading-snug text-slate-500">Writer totals describe actions taken before the final audit. Final resource counts above are read from the exported pack and are authoritative.</p>}
      </div>

      {fidelity && fidelity.issues.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Animation audit findings</span>
            <span className="text-[10px] text-slate-400">{curveErrors} errors · {curveWarnings} warnings · {fidelity.issues.filter((issue) => issue.severity === 'info').length} info</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pb-1.5 text-[9px] leading-snug text-slate-500">
            <span>Source comparison: {fidelity.issueCountsByScope['source-comparison'].errors} errors</span>
            <span>Final export: {fidelity.issueCountsByScope['final-export'].errors} errors</span>
            <span>Retarget pass: {fidelity.issueCountsByScope['retarget-pass'].errors} errors</span>
            <span>Runtime context: {fidelity.issueCountsByScope['runtime-context'].errors} errors</span>
          </div>
          <p className="pb-1.5 text-[9px] leading-snug text-slate-500">Final-export findings may also appear in the integration report; do not add totals across panels.</p>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {fidelity.issues.slice(0, 20).map((issue, index) => (
              <div key={`${issue.rule}-${index}`} className={`rounded-lg border px-1.5 py-1 ${SEVERITY_STYLE[issue.severity]}`}>
                <div className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="block truncate font-mono text-[9px] font-semibold">{issue.subject}</span>
                    <span className="block text-[9px] leading-snug opacity-90">{issue.detail}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dependencies && (dependencies.notes.length > 0 || dependencies.unresolvedSoundRefs.length > 0) && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Dependency reconstruction</span>
          <p className="pt-1 text-[10px] leading-snug text-slate-400">{dependencies.summary}</p>
          {dependencies.notes.map((note, index) => (
            <p key={index} className="pt-1 text-[9px] leading-snug text-slate-500">{note}</p>
          ))}
          {dependencies.unresolvedSoundRefs.length > 0 && (
            <p className="pt-1 text-[9px] leading-snug text-amber-300/90">
              {dependencies.unresolvedSoundRefs.slice(0, 4).join(', ')}
              {dependencies.unresolvedSoundRefs.length > 4 ? ` (+${dependencies.unresolvedSoundRefs.length - 4} more)` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WaypointIcon(props: React.ComponentProps<typeof GitBranch>) {
  return <GitBranch {...props} />;
}

function Link2Icon(props: React.ComponentProps<typeof GitBranch>) {
  return <GitBranch {...props} />;
}
