import { AlertTriangle, Bone, Camera, Hand, Layers } from 'lucide-react';
import type { PlayerAnimationPortReport } from '@/utils/playerAnimationPipeline';

interface Props {
  report?: PlayerAnimationPortReport | null;
  accent: string;
}

const ROUTE_STYLE: Record<string, string> = {
  class: 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300',
  'rig-shape': 'border-sky-500/30 bg-sky-950/60 text-sky-300',
  'source-identity': 'border-violet-500/30 bg-violet-950/60 text-violet-300',
  'not-player': 'border-slate-700 bg-slate-900 text-slate-400',
};

/**
 * Automated player animation port: which owner was recognised as the player and from what
 * evidence, how the clips split between the first-person hand and the third-person body, which
 * custom bone nodes were injected into the mod's own player model, and which clips drive the
 * off hand. Every value comes from the engine that ran during this conversion.
 */
export function PlayerAnimationPortPanel({ report, accent }: Props) {
  if (!report) return null;
  const playerOwners = report.owners.filter((owner) => owner.isPlayer);
  const tiles = [
    { icon: Camera, label: 'First-person hand', value: report.armClips.length, hint: 'arm / head / held-item tracks' },
    { icon: Layers, label: 'Third-person body', value: report.bodyClips.length, hint: 'torso and full-body tracks' },
    { icon: Bone, label: 'Bones injected', value: report.injectedBones.length, hint: report.injectedGeometryIdentifier ?? 'no custom player model' },
    { icon: Hand, label: 'Off-hand clips', value: report.offhandClips.length, hint: report.dualWieldDetected ? 'dual-wield evidence found' : 'no off-hand handling' },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
            <Sparkle accent={accent} />
            Player animation automation
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
            {report.clipsInspected} clip(s)
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
          {tiles.map(({ icon: Icon, label, value, hint }) => (
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
        <p className="pt-1 text-[10px] leading-snug text-slate-500">
          {report.gatedClips} clip(s) carry a translated trigger · {report.scriptActions} scripted hand action(s) ·{' '}
          {report.firstPersonTaggedClips.length} clip(s) named as first person
        </p>
      </div>

      {playerOwners.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <div className="flex items-center justify-between pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Player rig evidence</span>
            <span className="text-[10px] text-slate-400">{report.owners.length} owner(s)</span>
          </div>
          <div className="flex flex-col gap-1">
            {report.owners.slice(0, 6).map((owner) => (
              <div key={owner.owner} className="rounded-lg border border-slate-800/70 bg-slate-950/60 p-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono text-[10px] text-slate-200">{owner.owner}</span>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${ROUTE_STYLE[owner.route] ?? ROUTE_STYLE['not-player']}`}>
                    {owner.route}
                  </span>
                </div>
                <span className="mt-1 block text-[9px] leading-snug text-slate-500">{owner.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.notes.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Translation notes</span>
          <ul className="mt-1 flex flex-col gap-1">
            {report.notes.slice(0, 8).map((note) => (
              <li key={note} className="flex gap-1.5 text-[9px] leading-snug text-slate-400">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(report.perspectiveConflicts.length > 0 || report.offhandClips.length > 0 || report.injectedBones.length > 0) && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Rig and hand detail</span>
          <div className="mt-1 flex flex-col gap-1 text-[9px] leading-snug text-slate-400">
            {report.injectedBones.length > 0 && (
              <span>
                <span className="font-semibold text-slate-300">Injected nodes:</span>{' '}
                {report.injectedBones.slice(0, 8).join(', ')}
                {report.injectedBones.length > 8 ? ' …' : ''} — empty containers on the mod's own model, no cube invented.
              </span>
            )}
            {report.offhandClips.length > 0 && (
              <span>
                <span className="font-semibold text-slate-300">Off hand:</span> {report.offhandClips.slice(0, 4).join(', ')}
                {report.mainhandClips.length > 0 ? ` · main hand: ${report.mainhandClips.slice(0, 3).join(', ')}` : ''}
              </span>
            )}
            {report.perspectiveConflicts.length > 0 && (
              <span className="flex items-start gap-1 text-amber-300/90">
                <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                <span>Named first-person but moves the body: {report.perspectiveConflicts.slice(0, 3).join(' | ')}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkle({ accent }: { accent: string }) {
  return <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: accent }} aria-hidden="true" />;
}