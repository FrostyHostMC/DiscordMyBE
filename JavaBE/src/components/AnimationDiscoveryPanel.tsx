import { useState } from 'react';
import {
  Compass,
  Bone,
  Camera,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import type { UniversalAnimationDiscoveryReport } from '@/utils/universalAnimationDiscovery';

interface Props {
  discovery?: UniversalAnimationDiscoveryReport | null;
  accent: string;
}

export function AnimationDiscoveryPanel({ discovery, accent }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  if (!discovery || discovery.uniqueClipIdsDiscovered === 0) return null;

  const totalFormats = discovery.formatsDetected.length;
  const totalBones = discovery.skeletons.reduce((acc, s) => acc + s.bones.length, 0);
  const fpCount = discovery.perspectiveSystems.firstPersonClips.length;
  const tpCount = discovery.perspectiveSystems.thirdPersonClips.length;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-400/10 border border-violet-400/20">
            <Compass className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
              Universal Animation Discovery
              <span className="rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.2 text-[9px]">
                DYNAMIC ENGINE
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">
              Format-agnostic discovery across archive directories, embedded containers, and rigs.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[10px] font-semibold text-violet-300 hover:text-violet-200 transition"
        >
          {showDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span>{showDetails ? 'Collapse' : 'Inspect'}</span>
        </button>
      </div>

      {/* Metric Tiles */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Unique Clip IDs</span>
          <span className="font-mono text-sm font-bold text-violet-300">{discovery.uniqueClipIdsDiscovered}</span>
          <span className="block truncate text-[9px] text-slate-400">{discovery.totalClipsDiscovered} discovery records · duplicates count once</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Containers & Formats</span>
          <span className="font-mono text-sm font-bold text-sky-300">{totalFormats} formats</span>
          <span className="block truncate text-[9px] text-slate-400">
            {discovery.embeddedContainersFound > 0 ? `${discovery.embeddedContainersFound} embedded containers` : 'standard & raw sets'}
          </span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Rigs & Skeletons</span>
          <span className="font-mono text-sm font-bold text-emerald-300">{discovery.skeletons.length} rigs</span>
          <span className="block truncate text-[9px] text-slate-400">{totalBones} mapped joint(s)</span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Perspective Systems</span>
          <span className="font-mono text-sm font-bold text-fuchsia-300">
            {fpCount} FP / {tpCount} TP
          </span>
          <span className="block truncate text-[9px] text-slate-400">
            {discovery.perspectiveSystems.viewmodelAttachments.length} camera viewmodels
          </span>
        </div>
      </div>

      {/* Summary Line */}
      <p className="text-[10px] text-slate-300 leading-relaxed">{discovery.summary}</p>

      {/* Expanded Inspector */}
      {showDetails && (
        <div className="mt-1 flex flex-col gap-2 border-t border-slate-800/80 pt-2 text-[10px]">
          {/* Sub-tab navigation */}
          <div className="flex gap-1 border-b border-slate-800/60 pb-1.5 text-[10px]">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`rounded px-2 py-0.5 font-medium transition ${
                activeTab === 'overview' ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Formats & Targets
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('perspective')}
              className={`rounded px-2 py-0.5 font-medium transition ${
                activeTab === 'perspective' ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Viewpoints ({fpCount} FP / {tpCount} TP)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('skeletons')}
              className={`rounded px-2 py-0.5 font-medium transition ${
                activeTab === 'skeletons' ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Skeletons ({discovery.skeletons.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('references')}
              className={`rounded px-2 py-0.5 font-medium transition ${
                activeTab === 'references' ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              References & Deps ({discovery.assetReferences.length + discovery.dependencies.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('graph')}
              className={`rounded px-2 py-0.5 font-medium transition ${
                activeTab === 'graph' ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Graph ({Object.keys(discovery.animationGraph ?? {}).length})
            </button>
          </div>

          {activeTab === 'overview' && (
            <div className="flex flex-col gap-2">
              {/* Formats Detected */}
              <div>
                <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px]">
                  Detected Animation Formats
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {discovery.formatsDetected.map((fmt) => (
                    <span
                      key={fmt.format}
                      className="rounded border border-sky-800/40 bg-sky-950/60 px-1.5 py-0.5 font-mono text-[9px] text-sky-200"
                    >
                      {fmt.format} ({fmt.count} files)
                    </span>
                  ))}
                </div>
              </div>

              {/* Target Classification Breakdown */}
              <div>
                <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px]">
                  Dynamic Object Classification
                </span>
                <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-5 text-[9px]">
                  <div className="rounded bg-slate-950/70 p-1.5 border border-slate-800/60">
                    <span className="text-slate-500 block">Player Model</span>
                    <span className="font-mono text-xs font-bold text-violet-300">
                      {discovery.targetClassification.playerClips.length}
                    </span>
                  </div>
                  <div className="rounded bg-slate-950/70 p-1.5 border border-slate-800/60">
                    <span className="text-slate-500 block">Custom Entities</span>
                    <span className="font-mono text-xs font-bold text-emerald-300">
                      {discovery.targetClassification.entityClips.length}
                    </span>
                  </div>
                  <div className="rounded bg-slate-950/70 p-1.5 border border-slate-800/60">
                    <span className="text-slate-500 block">Equipment & Capes</span>
                    <span className="font-mono text-xs font-bold text-amber-300">
                      {discovery.targetClassification.equipmentClips.length}
                    </span>
                  </div>
                  <div className="rounded bg-slate-950/70 p-1.5 border border-slate-800/60">
                    <span className="text-slate-500 block">Held Weapons & Items</span>
                    <span className="font-mono text-xs font-bold text-cyan-300">
                      {discovery.targetClassification.heldItemClips.length}
                    </span>
                  </div>
                  <div className="rounded bg-slate-950/70 p-1.5 border border-slate-800/60">
                    <span className="text-slate-500 block">Blocks & Objects</span>
                    <span className="font-mono text-xs font-bold text-slate-300">
                      {discovery.targetClassification.blockObjectClips.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Discovered Controllers */}
              {discovery.controllersDiscovered.length > 0 && (
                <div>
                  <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px]">
                    Discovered Controllers & State Machines ({discovery.controllersDiscovered.length})
                  </span>
                  <div className="mt-1 flex flex-col gap-1 max-h-36 overflow-y-auto">
                    {discovery.controllersDiscovered.map((ctrl) => (
                      <div
                        key={ctrl.id}
                        className="flex items-center justify-between rounded bg-slate-950/60 p-1.5 border border-slate-800/50"
                      >
                        <div className="truncate font-mono text-[9px] text-slate-200">
                          {ctrl.id}
                          <span className="text-slate-500 ml-1.5">({ctrl.kind})</span>
                        </div>
                        <span className="rounded bg-slate-900 border border-slate-700/60 px-1 py-0.2 text-[8px] text-slate-300">
                          {ctrl.states.length} states · {ctrl.transitionsCount} transitions
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'perspective' && (
            <div className="flex flex-col gap-2">
              <div className="rounded bg-slate-950/60 p-2 border border-slate-800/60">
                <div className="flex items-center gap-1.5 font-semibold text-violet-300 mb-1">
                  <Camera className="h-3 w-3" />
                  <span>First-Person vs. Third-Person Viewport Resolution</span>
                </div>
                <p className="text-[9px] text-slate-400 leading-snug">
                  First-person viewmodel animations isolate arm and camera motion, preventing third-person body
                  stretching and model deformation.
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  {discovery.perspectiveSystems.notes.map((note, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-slate-300">
                      <span className="h-1 w-1 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Paired systems */}
              {discovery.perspectiveSystems.pairedSystems.length > 0 && (
                <div>
                  <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px]">
                    Dual-Perspective Action Synchronizations
                  </span>
                  <div className="mt-1 flex flex-col gap-1">
                    {discovery.perspectiveSystems.pairedSystems.map((pair, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950/50 p-1.5 border border-slate-800/40 flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-slate-200 text-[9px] capitalize">{pair.action}</span>
                        <div className="flex items-center gap-1 text-[8px] font-mono">
                          <span className="text-violet-300">{pair.firstPersonClip}</span>
                          <span className="text-slate-500">↔</span>
                          <span className="text-sky-300">{pair.thirdPersonClip}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'skeletons' && (
            <div className="flex flex-col gap-2">
              {discovery.skeletons.map((skel) => (
                <div key={skel.owner} className="rounded bg-slate-950/60 p-2 border border-slate-800/60">
                  <div className="flex items-center justify-between">
                    <span className="font-bold font-mono text-slate-200 flex items-center gap-1">
                      <Bone className="h-2.5 w-2.5 text-emerald-400" />
                      {skel.owner}
                      {skel.topology && (
                        <span className="rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-1 py-0.1 text-[8px] font-sans font-normal uppercase">
                          {skel.topology.replace('_', ' ')}
                        </span>
                      )}
                      {skel.hasSymmetry && (
                        <span className="rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 px-1 py-0.1 text-[8px] font-sans font-normal">
                          {skel.symmetricPairs.length} symmetric pair(s)
                        </span>
                      )}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {skel.bones.length} bones · tree depth {skel.depth}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {skel.bones.slice(0, 16).map((b) => (
                      <span
                        key={b}
                        className="rounded bg-slate-900 border border-slate-800 px-1 py-0.2 font-mono text-[8px] text-slate-300"
                      >
                        {b}
                      </span>
                    ))}
                    {skel.bones.length > 16 && (
                      <span className="text-[8px] text-slate-500 self-center">+{skel.bones.length - 16} more</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'graph' && (
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px]">
                Interconnected Animation System Graph
              </span>
              <p className="text-[9px] text-slate-400">
                Each clip dynamically traces its bound skeleton, duration, perspective gating, and asset dependencies.
              </p>
              <div className="mt-1 flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {Object.values(discovery.animationGraph ?? {}).slice(0, 20).map((node) => (
                  <div
                    key={node.clipId}
                    className="rounded bg-slate-950/70 p-2 border border-slate-800/60 flex flex-col gap-1 text-[9px]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-violet-300 truncate max-w-[220px]">
                        {node.clipId}
                      </span>
                      <div className="flex items-center gap-1 text-[8px]">
                        <span className="rounded bg-slate-900 border border-slate-800 px-1 py-0.2 text-slate-300">
                          {node.durationSeconds > 0 ? `${node.durationSeconds.toFixed(2)}s` : 'single-frame'}
                        </span>
                        <span
                          className={`rounded px-1 py-0.2 font-semibold ${
                            node.perspective === 'first_person'
                              ? 'bg-fuchsia-950/60 text-fuchsia-300 border border-fuchsia-800/40'
                              : node.perspective === 'third_person'
                              ? 'bg-sky-950/60 text-sky-300 border border-sky-800/40'
                              : 'bg-slate-900 text-slate-400 border border-slate-800'
                          }`}
                        >
                          {node.perspective.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px] text-slate-400">
                      <span>Owner: <strong className="text-slate-200">{node.owner}</strong></span>
                      {node.boundSkeletonOwner && (
                        <span>Bound Rig: <strong className="text-emerald-300">{node.boundSkeletonOwner}</strong></span>
                      )}
                      <span>Format: <span className="font-mono text-cyan-300">{node.format}</span></span>
                      <span>Channels: <strong className="text-slate-200">{node.boneChannels.length}</strong></span>
                      {node.missingBones.length > 0 && (
                        <span className="text-amber-300">
                          Inject: {node.missingBones.slice(0, 2).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'references' && (
            <div className="flex flex-col gap-2">
              {/* Asset references */}
              {discovery.assetReferences.length > 0 && (
                <div>
                  <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px]">
                    Discovered Audio & Particle Triggers ({discovery.assetReferences.length})
                  </span>
                  <div className="mt-1 flex flex-col gap-1 max-h-36 overflow-y-auto">
                    {discovery.assetReferences.slice(0, 12).map((ref, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950/60 p-1.5 border border-slate-800/40 flex items-center justify-between text-[9px]"
                      >
                        <span className="font-mono text-slate-300 truncate max-w-[200px]">{ref.fromClip}</span>
                        <div className="flex items-center gap-1">
                          <span
                            className={`rounded px-1 py-0.2 text-[8px] font-semibold ${
                              ref.assetType === 'sound'
                                ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                                : 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/40'
                            }`}
                          >
                            {ref.assetType}
                          </span>
                          <span className="font-mono text-slate-200">{ref.referenceId}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dependencies */}
              {discovery.dependencies.length > 0 && (
                <div>
                  <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px] flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3 text-amber-400" />
                    Animation Dependencies Tracked ({discovery.dependencies.length})
                  </span>
                  <div className="mt-1 flex flex-col gap-1">
                    {discovery.dependencies.slice(0, 6).map((dep, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950/60 p-1.5 border border-amber-900/40 text-[9px] text-amber-200/90 leading-snug"
                      >
                        <span className="font-bold text-amber-300 font-mono">{dep.target}</span>: {dep.note}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}