import { useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, Link2, ShieldCheck } from 'lucide-react';
import type { MolangDependencyGraphReport, VariableDependencyNode } from '@/utils/molangDependencyGraph';
import type { RenderingContextBindingReport } from '@/utils/renderingContextBinding';

interface Props {
  graph?: MolangDependencyGraphReport | null;
  contexts?: RenderingContextBindingReport | null;
  accent: string;
}

const BINDING_STYLE: Record<VariableDependencyNode['binding'], { bg: string; label: string }> = {
  declared_in_scope: { bg: 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300', label: 'FROM SOURCE' },
  source_expression: { bg: 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300', label: 'SOURCE EXPR' },
  equipment_visibility: { bg: 'bg-purple-950/70 border-purple-500/40 text-purple-300', label: 'ARMOUR SLOT' },
  equipment_detection: { bg: 'bg-purple-950/70 border-purple-500/40 text-purple-300', label: 'ITEM EVIDENCE' },
  canonical_query: { bg: 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300', label: 'QUERY MAP' },
  unresolved: { bg: 'bg-amber-950/70 border-amber-500/40 text-amber-300', label: 'UNRESOLVED' },
};

/**
 * Shows the variable -> animation edges the engine resolves, plus the perspective each player
 * binding really reaches. Every row is a measurement of the exported pack: a name marked
 * UNRESOLVED lists the clips that cannot evaluate it, and first-person integration is only
 * reported ready when the first-person base pose resolves and carries its gate.
 */
export function MolangDependencyPanel({ graph, contexts, accent }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!graph && !contexts) return null;

  const nodes = graph?.nodes ?? [];
  const shown = expanded ? nodes : nodes.slice(0, 6);
  const unresolved = graph?.unresolved ?? [];
  const firstPerson = contexts?.firstPerson;
  const thirdPerson = contexts?.thirdPerson;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-950/80 text-purple-400">
            <GitBranch className="h-4 w-4" />
          </div>
          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
              Molang Dependency Graph
              <span className="rounded border border-purple-800/40 bg-purple-950/60 px-1.5 py-0.2 font-mono text-[9px] text-purple-300">
                variable → animation
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">
              Every variable traced to the clips that read it and to the scope that declares it
            </p>
          </div>
        </div>
        <span
          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold ${
            graph?.exportReady
              ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-400'
              : 'border-amber-500/40 bg-amber-950/50 text-amber-300'
          }`}
        >
          <ShieldCheck className="h-3 w-3" />
          {graph ? `${graph.declaredCount + graph.reconstructedCount}/${graph.variablesDiscovered} bound` : 'not measured'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[
          { label: 'Variables', value: graph?.variablesDiscovered ?? 0, tone: 'text-slate-200' },
          { label: 'Rebuilt', value: graph?.reconstructedCount ?? 0, tone: 'text-purple-300' },
          { label: 'Unresolved', value: unresolved.length, tone: unresolved.length > 0 ? 'text-amber-300' : 'text-emerald-300' },
          { label: 'At-risk Clips', value: graph?.animationsAtRisk.length ?? 0, tone: 'text-cyan-300' },
        ].map((metric) => (
          <div key={metric.label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
            <span className="block text-[9px] uppercase tracking-wider text-slate-400">{metric.label}</span>
            <span className={`font-mono text-sm font-bold ${metric.tone}`}>{metric.value}</span>
          </div>
        ))}
      </div>

      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
        {shown.map((node) => {
          const style = BINDING_STYLE[node.binding];
          return (
            <div key={node.variable} className="flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/70 p-2 text-[10px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono font-semibold" style={{ color: accent }}>
                  {node.variable}
                </span>
                <span className={`shrink-0 rounded border px-1.5 py-0.2 text-[8px] font-bold tracking-wider ${style.bg}`}>
                  {style.label}
                </span>
              </div>
              {node.expression && (
                <p className="truncate font-mono text-[9px] text-emerald-300">{node.expression}</p>
              )}
              {node.readByAnimations.length > 0 && (
                <p className="truncate text-[9px] text-slate-400">
                  <Link2 className="mr-1 inline h-3 w-3 text-slate-500" />
                  {node.readByAnimations.slice(0, 3).join(', ')}
                  {node.readByAnimations.length > 3 ? ` +${node.readByAnimations.length - 3}` : ''}
                </p>
              )}
              <p className="text-[9px] leading-tight text-slate-500">{node.reason}</p>
            </div>
          );
        })}
        {nodes.length === 0 && (
          <p className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2 text-[10px] text-slate-400">
            No Molang variable is read by any shipped animation or controller.
          </p>
        )}
      </div>

      {nodes.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="self-start text-[10px] font-medium text-purple-400 hover:underline"
        >
          {expanded ? 'Show less' : `+${nodes.length - 6} more variable(s)`}
        </button>
      )}

      {unresolved.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-800/40 bg-amber-950/30 p-2 text-[10px]">
          <span className="flex items-center gap-1.5 font-semibold text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Reported, never substituted
          </span>
          {unresolved.slice(0, 4).map((entry) => (
            <p key={entry.variable} className="leading-tight text-amber-200/90">
              <span className="font-mono">{entry.variable}</span> — blocked clip(s):{' '}
              {entry.readByAnimations.slice(0, 3).join(', ') || entry.readIn.slice(0, 2).join(', ') || 'entity scope'}
            </p>
          ))}
        </div>
      )}

      {contexts && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[10px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
            Perspective binding ({contexts.bindings.length} player entries)
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded border px-1.5 py-0.5 font-semibold ${
                firstPerson?.ready
                  ? 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-950/50 text-amber-300'
              }`}
            >
              First person {firstPerson?.ready ? 'verified' : 'not verified'}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-semibold ${
                thirdPerson?.ready
                  ? 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-950/50 text-amber-300'
              }`}
            >
              Third person {thirdPerson?.ready ? 'verified' : 'not verified'}
            </span>
            <span className="rounded border border-purple-500/30 bg-purple-950/60 px-1.5 py-0.5 font-mono text-purple-300">
              {contexts.gatesAdded.length} gate(s) applied
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono ${
                contexts.mismatches.length > 0
                  ? 'border-amber-500/40 bg-amber-950/50 text-amber-300'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              {contexts.mismatches.length} mismatch(es)
            </span>
          </div>
          <p className="text-[9px] leading-tight text-slate-500">
            {contexts.firstPersonBindings} first-person, {contexts.thirdPersonBindings} third-person and{' '}
            {contexts.sharedBindings} shared binding(s). {contexts.summary}
          </p>
        </div>
      )}

      <div className="flex items-start gap-1.5 rounded-lg border border-slate-800/60 bg-slate-950/90 p-2 text-[9px] text-slate-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <div>
          <span className="font-semibold text-slate-200">Context-aware translation:</span>{' '}
          {graph?.scopeDeclarationsAdded ?? 0} declaration(s) written into the exact script scope that evaluates them
          across {graph?.scopeFilesTouched ?? 0} document(s); {graph?.unresolved.length ?? 0} value(s) could not be
          reproduced and stay reported instead of being replaced with a constant.
        </div>
      </div>
    </div>
  );
}