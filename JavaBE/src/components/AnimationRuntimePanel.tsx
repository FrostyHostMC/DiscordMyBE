import { Activity, AlertTriangle, CheckCircle2, Link2, ShieldCheck, Waypoints } from 'lucide-react';
import type { SkeletonReconciliationReport } from '@/utils/dynamicBoneRetargeter';
import type { AnimationStateReport } from '@/utils/animationStateResolver';
import type { ReferenceIntegrityReport } from '@/utils/referenceIntegrityAuditor';
import type { AnimationRuntimeReport } from '@/utils/animationRuntimeValidator';

interface Props {
  skeleton?: SkeletonReconciliationReport | null;
  states?: AnimationStateReport | null;
  references?: ReferenceIntegrityReport | null;
  runtime?: AnimationRuntimeReport | null;
  accent: string;
}

const STATUS_STYLE: Record<string, string> = {
  pass: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300',
  repaired: 'border-sky-500/40 bg-sky-950/40 text-sky-300',
  unresolved: 'border-rose-500/40 bg-rose-950/40 text-rose-300',
  'not-measured': 'border-slate-700 bg-slate-900 text-slate-400',
  'not-verified': 'border-amber-600/40 bg-amber-950/30 text-amber-300',
};

/**
 * Runtime compatibility panel.
 *
 * Bone retargeting, state conflicts, reference integrity and the runtime check list are shown
 * as measurements of the exported pack, never as a claim that something played in game.
 */
export function AnimationRuntimePanel({ skeleton, states, references, runtime, accent }: Props) {
  if (!skeleton && !states && !references && !runtime) return null;

  const unresolvedChecks = runtime?.checks.filter((check) => check.status === 'unresolved') ?? [];
  const unresolvedStages = runtime?.pipelineStages.filter((stage) => stage.status === 'unresolved') ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: accent }} aria-hidden="true" />
            Runtime compatibility
          </span>
          {runtime && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${runtime.passed ? 'bg-emerald-950/60 text-emerald-300' : 'bg-rose-950/60 text-rose-300'}`}>
              {runtime.passed ? 'final export checks passed' : `${unresolvedChecks.length + unresolvedStages.length} unresolved`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-5">
          {[
            { icon: Waypoints, label: 'Final bone bindings', value: runtime?.exportedMetrics.bones.checked ? `${runtime.exportedMetrics.bones.resolved}/${runtime.exportedMetrics.bones.checked}` : '—', hint: runtime?.exportedMetrics.bones.checked ? `${runtime.exportedMetrics.bones.unresolved.length} unresolved; ${runtime.exportedMetrics.bones.skeletonsUnresolved.length} skeleton(s) unmeasured` : 'not measured' },
            { icon: Waypoints, label: 'Retarget pass', value: skeleton ? `${skeleton.bonesResolved}/${skeleton.bonesExamined}` : '—', hint: `${skeleton?.unmapped.length ?? 0} unmatched · earlier pass only` },
            { icon: ShieldCheck, label: 'State repair actions', value: states?.guarded.length ?? 0, hint: `${states?.shadowed.length ?? 0} shadowed in analysis` },
            { icon: Link2, label: 'Reference repair actions', value: (references?.geometryRefsRepaired.length ?? 0) + (references?.renderControllerRepairs.length ?? 0), hint: `${references?.controllerRefsRemoved.length ?? 0} removed by repair pass` },
            { icon: Activity, label: 'Playback', value: runtime ? '0' : '—', hint: 'live client not run' },
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

        {runtime && <p className="pt-1.5 text-[10px] leading-snug text-slate-400">{runtime.summary}</p>}
      </div>

      {runtime && runtime.pipelineStages.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Porting stages</span>
            <span className="text-[10px] text-slate-400">
              {runtime.pipelineStages.filter((stage) => stage.status === 'unresolved').length === 0
                ? 'no stage failed'
                : `${runtime.pipelineStages.filter((stage) => stage.status === 'unresolved').length} stage(s) failed`}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {runtime.pipelineStages.map((stage) => (
              <div key={stage.id} className={`rounded-lg border px-1.5 py-1 ${STATUS_STYLE[stage.status] ?? STATUS_STYLE['not-measured']}`}>
                <div className="flex items-start gap-1">
                  <span className="mt-0.5 font-mono text-[9px] opacity-70">{stage.index}</span>
                  <div className="min-w-0">
                    <span className="block truncate font-mono text-[9px] font-semibold">
                      {stage.label} · {stage.status}
                    </span>
                    <span className="block text-[9px] leading-snug opacity-90">{stage.detail}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {runtime && runtime.checks.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Validation pipeline</span>
            <span className="text-[10px] text-slate-400">{runtime.checks.length} checks</span>
          </div>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {runtime.checks.map((check) => (
              <div key={check.id} className={`rounded-lg border px-1.5 py-1 ${STATUS_STYLE[check.status] ?? STATUS_STYLE['not-measured']}`}>
                <div className="flex items-start gap-1">
                  {check.status === 'unresolved' ? (
                    <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="block truncate font-mono text-[9px] font-semibold">
                      {check.label} · {check.status}
                    </span>
                    <span className="block text-[9px] leading-snug opacity-90">{check.detail}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(skeleton?.unmapped.length ?? 0) > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Unresolved bone tracks</span>
          <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto pt-1">
            {skeleton?.unmapped.slice(0, 24).map((entry) => (
              <span key={entry} className="truncate font-mono text-[9px] text-amber-300/90">{entry}</span>
            ))}
          </div>
          <p className="pt-1 text-[9px] leading-snug text-slate-500">
            These are unmatched candidates from the retargeting pass, not the final export's unresolved total. The authoritative final owner/clip/bone count is shown above; the two scopes may differ because one counts source mapping attempts and the other audits the files that ship.
          </p>
        </div>
      )}

      {(states?.conflicts.length ?? 0) > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">State interactions</span>
            <span className="text-[10px] text-slate-400">{states?.conflicts.length}</span>
          </div>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {states?.conflicts.slice(0, 16).map((conflict, index) => (
              <div key={`${conflict.entity}-${conflict.lower}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-1.5 py-1">
                <span className="block truncate font-mono text-[9px] text-slate-200">
                  {conflict.higher} ▸ {conflict.lower}
                </span>
                <span className="block text-[9px] leading-snug text-slate-400">
                  {conflict.resolution} — {conflict.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {references && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Reference integrity</span>
          <p className="pt-1 text-[10px] leading-snug text-slate-400">{references.summary}</p>
          <div className="grid grid-cols-2 gap-1 pt-1 text-[9px] leading-snug text-slate-400 sm:grid-cols-3">
            <span>Geometry declared: <span className="font-mono text-slate-200">{references.geometriesDeclared}</span></span>
            <span>Render definitions (final): <span className="font-mono text-slate-200">{references.renderControllersDeclared}</span></span>
            <span>Animation-controller definitions (final): <span className="font-mono text-slate-200">{references.controllersDeclared}</span></span>
            <span>Bindings repaired: <span className="font-mono text-slate-200">{references.geometryRefsRepaired.length}</span></span>
            <span>Render controllers generated by repair pass: <span className="font-mono text-slate-200">{references.renderControllersGenerated.length}</span></span>
            <span>Animation-controller hooks added by repair pass: <span className="font-mono text-slate-200">{references.animationControllerHooksActivated.length}</span></span>
          </div>
          {references.firstPersonRenderers.length > 0 && (
            <p className="pt-1 text-[9px] leading-snug text-slate-500">
              First person: {references.firstPersonRenderers.slice(0, 2).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}