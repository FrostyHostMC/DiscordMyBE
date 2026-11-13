import { AlertCircle, CheckCircle2, Layers } from 'lucide-react';
import type { PlayerEntityWiringReport } from '@/utils/playerClientEntity';
import type { PlayerClipTrigger, PlayerTriggerReport } from '@/utils/playerAnimationTriggers';
import type { PortValidationReport } from '@/utils/packPortValidator';
import type { PlayerAnimationPortReport } from '@/utils/playerAnimationPipeline';
import { PlayerAnimationPortPanel } from '@/components/PlayerAnimationPortPanel';

const STATUS_STYLE: Record<PlayerClipTrigger['status'], string> = {
  mapped: 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300',
  approximated: 'border-sky-500/30 bg-sky-950/60 text-sky-300',
  'script-driven': 'border-fuchsia-500/30 bg-fuchsia-950/60 text-fuchsia-300',
  unresolved: 'border-amber-500/40 bg-amber-950/50 text-amber-300',
};

interface Props {
  wiring?: PlayerEntityWiringReport | null;
  triggers?: PlayerTriggerReport | null;
  portValidation?: PortValidationReport;
  /** Automated player port: rig evidence, first/third-person scope, bone injection, dual-wield. */
  animationPort?: PlayerAnimationPortReport | null;
  accent: string;
}

/** Player animation port: entity wiring, translated Java triggers and the fail-loud check. */
export function PlayerPortPanel({ wiring, triggers, portValidation, animationPort, accent }: Props) {
  if (!wiring && !portValidation && !animationPort) return null;
  const issues = portValidation?.issues ?? [];
  const shownIssues = issues.slice(0, 6);
  const shownTriggers = (triggers?.triggers ?? []).slice(0, 6);

  return (
    <div className="flex flex-col gap-2.5">
      <PlayerAnimationPortPanel report={animationPort} accent={accent} />
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            <Layers className="h-3 w-3" style={{ color: accent }} />
            Player animation port
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              wiring?.generated ? 'bg-emerald-950/70 text-emerald-300' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {wiring?.generated ? 'ENTITY WIRED' : 'NOT REQUIRED'}
          </span>
        </div>

        {wiring?.generated ? (
          <>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
              {[
                { label: 'Player clip IDs (pass)', value: wiring.clipsRegistered },
                { label: 'Controllers', value: wiring.controllersRegistered },
                { label: 'Animate', value: wiring.animateEntries },
                { label: 'Vanilla kept', value: wiring.vanillaAnimationsPreserved },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-1.5">
                  <span className="block text-[9px] uppercase text-slate-500">{item.label}</span>
                  <span className="font-mono text-sm font-bold text-slate-100">{item.value}</span>
                </div>
              ))}
            </div>
            <p className="pt-1.5 text-[10px] leading-snug text-slate-400">
              1st person: {wiring.firstPersonClips.length} arm-only track(s) · 3rd person:{' '}
              {wiring.thirdPersonClips.length} full-body track(s).{' '}
              {wiring.scriptedClips.length > 0
                ? `${wiring.scriptedClips.length} clip(s) fired from the behaviour-pack script on the source action event.`
                : 'Every clip is gated by a translated or structurally inferred Molang condition.'}
            </p>
            <p className="pt-1 text-[10px] leading-snug text-slate-400">
              Player-generation routes: {wiring.clipsActivated} unique clip(s) — {wiring.clipsActivatedByAnimate} entity animate,{' '}
              {wiring.clipsActivatedByController} controller, {wiring.clipsActivatedByScript} event-driven script. These are pass totals, not the final export audit.
            </p>
            {wiring.unresolvedClips.length > 0 && (
              <p className="pt-1 text-[10px] leading-snug text-amber-300/90">
                {wiring.unresolvedClips.length} clip(s) ship without a verified source trigger — activation is
                approximated and must be confirmed in game.
              </p>
            )}
            <p className="pt-1 text-[9px] leading-snug text-slate-500">Final selectable/activated totals come from the export audit below.</p>
            <p className="pt-1 text-[9px] leading-snug text-slate-500">{wiring.note}</p>
          </>
        ) : (
          <p className="text-[10px] leading-snug text-slate-400">
            No player animation clip shipped, so no player client entity was generated — nothing references a clip that
            does not exist.
          </p>
        )}
      </div>

      {shownTriggers.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Java trigger bridge</span>
            <span className="text-[10px] text-slate-400">{triggers?.clipsInspected ?? 0} clips</span>
          </div>
          <div className="flex flex-col gap-1">
            {shownTriggers.map((trigger) => (
              <div key={trigger.clipId} className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono text-[10px] text-slate-200">{trigger.clipId}</span>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${STATUS_STYLE[trigger.status]}`}>
                    {trigger.status}
                  </span>
                </div>
                {trigger.condition && (
                  <code className="mt-1 block break-all rounded bg-slate-900/90 px-1 py-0.5 text-[9px] text-cyan-300">
                    {trigger.condition}
                  </code>
                )}
                <span className="mt-1 block text-[9px] leading-snug text-slate-500">{trigger.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {portValidation && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Pre-export port check
            </span>
            <span
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                portValidation.passed ? 'bg-emerald-950/70 text-emerald-300' : 'bg-rose-950/70 text-rose-300'
              }`}
            >
              {portValidation.passed ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertCircle className="h-2.5 w-2.5" />}
              {portValidation.passed ? 'PASSED' : `${portValidation.errors} BLOCKING`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 text-[9px]">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.filesParsed} JSON parsed</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.duplicateIds} duplicate ids</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.unresolvedReferences} dangling refs</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.molangViolations} bad queries</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.soundPathViolations} sound paths</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.itemIconViolations} icons</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{portValidation.notPorted.length} not ported</span>
          </div>
          {shownIssues.length > 0 && (
            <div className="flex flex-col gap-1 pt-1.5">
              {shownIssues.map((issue, index) => (
                <div key={`${issue.file}-${issue.subject}-${index}`} className="text-[9px] leading-snug">
                  <span className={issue.severity === 'error' ? 'font-semibold text-rose-300' : 'font-semibold text-amber-300'}>
                    {issue.file}
                  </span>
                  <span className="text-slate-400"> — {issue.subject}: {issue.detail}</span>
                </div>
              ))}
            </div>
          )}
          {portValidation.notPorted.length > 0 && (
            <div className="pt-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Not ported (reported, not faked)</span>
              <div className="flex flex-col gap-0.5 pt-0.5">
                {portValidation.notPorted.slice(0, 4).map((entry) => (
                  <span key={entry.sourcePath} className="text-[9px] leading-snug text-slate-500">
                    {entry.category}: {entry.sourcePath} — {entry.reason}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="pt-1 text-[9px] leading-snug text-slate-500">{portValidation.summary}</p>
        </div>
      )}
    </div>
  );
}