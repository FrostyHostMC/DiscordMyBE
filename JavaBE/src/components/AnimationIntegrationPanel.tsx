import { AlertTriangle, CheckCircle2, Layers, Link2, Radio, Waypoints } from 'lucide-react';
import type { AnimationIntegrationReport } from '@/utils/animationIntegrationValidator';

interface Props {
  report?: AnimationIntegrationReport | null;
  accent: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  error: 'border-rose-500/40 bg-rose-950/40 text-rose-300',
  warning: 'border-amber-500/40 bg-amber-950/40 text-amber-300',
  info: 'border-slate-700 bg-slate-900 text-slate-400',
};

export function AnimationIntegrationPanel({ report, accent }: Props) {
  if (!report) return null;
  const metrics = report.metrics;
  const steps = [
    { icon: Layers, label: 'Source IDs', value: report.stages.extracted, hint: 'unique input IDs before conversion' },
    { icon: Waypoints, label: 'Final definitions', value: metrics.clipsDefined, hint: `${report.definitions.files} final document(s)` },
    { icon: Link2, label: 'Entity aliases', value: metrics.animationAliasesDeclared, hint: 'map entries, incl. vanilla and controllers' },
    { icon: Link2, label: 'Selectable', value: metrics.clipsRegistered, hint: 'unique final clip IDs' },
    { icon: Radio, label: 'Start paths', value: metrics.clipsActivated, hint: `${metrics.unactivatedClips.length} registered IDs without a path; path-type counts can overlap` },
    { icon: CheckCircle2, label: 'Playback verified', value: report.stages.playbackVerified, hint: 'needs a live client' },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: accent }} aria-hidden="true" />
            Animation integration · final export
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${report.passed ? 'bg-emerald-950/60 text-emerald-300' : 'bg-rose-950/60 text-rose-300'}`}>
            {report.passed ? 'WIRED' : 'GAPS'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-6">
          {steps.map(({ icon: Icon, label, value, hint }) => (
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

        <p className="pt-1.5 text-[10px] leading-snug text-slate-400">{report.summary}</p>
        <details className="pt-1.5 text-[9px] leading-snug text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-400">What each total counts</summary>
          <div className="flex flex-col gap-1 pt-1.5">
            {report.metricScopes.map((scope) => <span key={scope}>{scope}</span>)}
          </div>
        </details>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Final resource detail</span>
        <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] leading-snug text-slate-400 sm:grid-cols-4">
          <span>Animation map aliases: <span className="font-mono text-slate-200">{metrics.animationAliasesDeclared}</span> entries across {metrics.clientEntities} final client entities</span>
          <span>Animation controllers: <span className="font-mono text-slate-200">{metrics.controllersRegistered}/{metrics.controllersDefined}</span> referenced/defined · {metrics.controllersActivated} active</span>
          <span>Render controllers: <span className="font-mono text-slate-200">{metrics.renderControllersDefinedInPack}/{metrics.renderControllersReferenced}</span> referenced definitions · {metrics.renderControllersUnresolved.length} unresolved</span>
          <span>Final bone bindings: <span className="font-mono text-slate-200">{metrics.bones.resolved}/{metrics.bones.checked}</span> resolved · {metrics.bones.unresolved.length} unresolved</span>
          <span>Orphan definitions: <span className="font-mono text-slate-200">{metrics.orphanedClips.length}</span></span>
          <span>First person: <span className="font-mono text-slate-200">{metrics.firstPersonStates}</span></span>
          <span>Third person: <span className="font-mono text-slate-200">{metrics.thirdPersonStates}</span></span>
          <span>Conditional entries: <span className="font-mono text-slate-200">{metrics.conditionalStates}</span></span>
          <span>Entities with animations: <span className="font-mono text-slate-200">{report.entities.withAnimations}/{report.entities.clientEntities}</span></span>
        </div>
        <p className="pt-1 text-[9px] leading-snug text-slate-500">
          Animation-controller definitions and render-controller definitions are different resource types; zero animation controllers may be valid when no state machine is needed. “Generated” counts only definitions created by the repair pass, not the number present in the final pack.
        </p>
      </div>

      {report.issues.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Integration findings</span>
            <span className="text-[10px] text-slate-400">{report.issues.length}</span>
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {report.issues.slice(0, 20).map((issue, index) => (
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
    </div>
  );
}