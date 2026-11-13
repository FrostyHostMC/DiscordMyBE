import { useState } from 'react';
import {
  Activity,
  GitBranch,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Volume2,
  Sliders,
  Cpu,
} from 'lucide-react';
import type { UniversalAnimationIRReport } from '@/utils/universalAnimationIR';

interface Props {
  report?: UniversalAnimationIRReport | null;
  accent: string;
}

export function AnimationInterpretationPanel({ report, accent: _accent }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'timelines' | 'bones' | 'hierarchy' | 'procedural' | 'controllers' | 'unfamiliar'
  >('timelines');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  if (!report || report.clipCount === 0) return null;

  const clipList = Object.values(report.clips);
  const activeClip = selectedClipId ? report.clips[selectedClipId] : clipList[0];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-fuchsia-500/10 border border-fuchsia-400/20">
            <Activity className="h-3.5 w-3.5 text-fuchsia-300" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
              Universal Animation Interpretation
              <span className="rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 px-1.5 py-0.2 text-[9px]">
                FORMAT-AGNOSTIC IR
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">
              Normalized intermediate representation: timelines, bone channels, keyframe interpolation, and procedural math.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[10px] font-semibold text-fuchsia-300 hover:text-fuchsia-200 transition"
        >
          {showDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span>{showDetails ? 'Collapse' : 'Inspect IR'}</span>
        </button>
      </div>

      {/* Metric Tiles */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Clips Normalized</span>
          <span className="font-mono text-sm font-bold text-fuchsia-300">{report.clipCount}</span>
          <span className="block truncate text-[9px] text-slate-400">
            {report.perspectivesSummary.firstPersonClips} FP / {report.perspectivesSummary.thirdPersonClips} TP
          </span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Bones & Channels</span>
          <span className="font-mono text-sm font-bold text-violet-300">{report.bonesInterpreted}</span>
          <span className="block truncate text-[9px] text-slate-400">
            {report.channelsNormalized} vector track(s)
          </span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Keyframes & Math</span>
          <span className="font-mono text-sm font-bold text-cyan-300">{report.keyframesInterpreted}</span>
          <span className="block truncate text-[9px] text-slate-400">
            {report.proceduralRulesDetected} procedural formulas
          </span>
        </div>
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
          <span className="block text-[9px] uppercase text-slate-500">Unfamiliar Preserved</span>
          <span className="font-mono text-sm font-bold text-emerald-300">
            {report.unfamiliarPropertiesPreserved}
          </span>
          <span className="block truncate text-[9px] text-slate-400">zero properties discarded</span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-[10px] text-slate-300 leading-relaxed">{report.summary}</p>

      {/* Expanded Inspection Dashboard */}
      {showDetails && (
        <div className="mt-1 flex flex-col gap-2 border-t border-slate-800/80 pt-2 text-[10px]">
          {/* Clip Selector */}
          {clipList.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="text-[9px] font-semibold text-slate-400 uppercase shrink-0">Selected Clip:</span>
              {clipList.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClipId(c.id)}
                  className={`rounded px-2 py-0.5 font-mono text-[9px] truncate max-w-[150px] transition shrink-0 ${
                    (activeClip?.id ?? '') === c.id
                      ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/40 font-bold'
                      : 'bg-slate-950/60 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {c.id}
                </button>
              ))}
            </div>
          )}

          {/* Sub-tab Navigation */}
          <div className="flex gap-1 border-b border-slate-800/60 pb-1.5 text-[10px] overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('timelines')}
              className={`rounded px-2 py-0.5 font-medium transition shrink-0 ${
                activeTab === 'timelines'
                  ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Timeline & Loop
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bones')}
              className={`rounded px-2 py-0.5 font-medium transition shrink-0 ${
                activeTab === 'bones'
                  ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Transform Channels ({activeClip ? Object.keys(activeClip.bones).length : 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('hierarchy')}
              className={`rounded px-2 py-0.5 font-medium transition shrink-0 ${
                activeTab === 'hierarchy'
                  ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Skeletal Hierarchy ({activeClip?.hierarchicalRelationships.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('procedural')}
              className={`rounded px-2 py-0.5 font-medium transition shrink-0 ${
                activeTab === 'procedural'
                  ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Procedural & Cues ({report.proceduralRulesDetected})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('controllers')}
              className={`rounded px-2 py-0.5 font-medium transition shrink-0 ${
                activeTab === 'controllers'
                  ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Controllers ({report.controllerCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unfamiliar')}
              className={`rounded px-2 py-0.5 font-medium transition shrink-0 ${
                activeTab === 'unfamiliar'
                  ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Preserved Metadata
            </button>
          </div>

          {/* Tab 1: Timeline & Loop */}
          {activeTab === 'timelines' && activeClip && (
            <div className="flex flex-col gap-2">
              <div className="rounded bg-slate-950/60 p-2.5 border border-slate-800/60 flex flex-col gap-1.5">
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                  <span className="font-mono font-bold text-fuchsia-300 text-xs">{activeClip.id}</span>
                  <span className="rounded bg-slate-900 border border-slate-700/60 px-1.5 py-0.2 text-[9px] text-slate-300">
                    Owner: {activeClip.owner}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[9px]">
                  <div>
                    <span className="text-slate-500 block">Duration</span>
                    <span className="font-mono font-bold text-slate-200 text-xs">
                      {activeClip.timeline.durationSeconds.toFixed(3)}s
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Time Base</span>
                    <span className="font-mono text-slate-200">
                      {activeClip.timeline.timeUnit} ({activeClip.timeline.fps} FPS)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Looping Mode</span>
                    <span
                      className={`font-semibold ${
                        activeClip.timeline.isLooping ? 'text-emerald-300' : 'text-slate-400'
                      }`}
                    >
                      {activeClip.timeline.isLooping ? activeClip.timeline.loopMode : 'Play Once'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Perspective</span>
                    <span className="font-semibold text-fuchsia-300 capitalize">
                      {activeClip.perspective.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {/* Blending controls */}
                <div className="mt-1 flex flex-wrap gap-2 text-[9px] text-slate-400 bg-slate-900/60 p-1.5 rounded border border-slate-800/40">
                  <span>
                    Blend Weight:{' '}
                    <strong className="text-slate-200">
                      {activeClip.timeline.blendWeight !== undefined ? String(activeClip.timeline.blendWeight) : '1.0'}
                    </strong>
                  </span>
                  <span>
                    Override Previous:{' '}
                    <strong className="text-slate-200">
                      {activeClip.timeline.overridePreviousAnimation ? 'true' : 'false'}
                    </strong>
                  </span>
                  {activeClip.timeline.animTimeUpdate && (
                    <span>
                      Time Query: <code className="text-cyan-300 font-mono">{activeClip.timeline.animTimeUpdate}</code>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Transform Channels */}
          {activeTab === 'bones' && activeClip && (
            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
              {Object.values(activeClip.bones).map((bone) => (
                <div
                  key={bone.boneName}
                  className="rounded bg-slate-950/60 p-2 border border-slate-800/50 flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-200 flex items-center gap-1.5">
                      <Sliders className="h-3 w-3 text-violet-400" />
                      {bone.boneName}
                      {bone.parentBone && (
                        <span className="text-slate-500 text-[8px] font-normal font-sans">
                          (child of {bone.parentBone})
                        </span>
                      )}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[8px] font-semibold ${
                        bone.hasMotion
                          ? 'bg-violet-950/60 text-violet-300 border border-violet-800/40'
                          : 'bg-slate-900 text-slate-500 border border-slate-800'
                      }`}
                    >
                      {bone.hasMotion ? 'Animated' : 'Rest Pose'}
                    </span>
                  </div>

                  {/* Channel Breakdown */}
                  <div className="grid grid-cols-3 gap-1 text-[8px] pt-1 border-t border-slate-800/40">
                    <div className="rounded bg-slate-900/60 p-1">
                      <span className="text-slate-500 block uppercase">Position</span>
                      {bone.position ? (
                        <span className="font-mono text-cyan-300">
                          {bone.position.keyframes.length} keyframe(s)
                          {bone.position.isStatic && ' (static)'}
                        </span>
                      ) : (
                        <span className="text-slate-600">None</span>
                      )}
                    </div>
                    <div className="rounded bg-slate-900/60 p-1">
                      <span className="text-slate-500 block uppercase">Rotation</span>
                      {bone.rotation ? (
                        <span className="font-mono text-emerald-300">
                          {bone.rotation.keyframes.length} keyframe(s)
                          <span className="text-slate-500 ml-1">({bone.rotation.originalRotationUnit ?? 'deg'})</span>
                        </span>
                      ) : (
                        <span className="text-slate-600">None</span>
                      )}
                    </div>
                    <div className="rounded bg-slate-900/60 p-1">
                      <span className="text-slate-500 block uppercase">Scale</span>
                      {bone.scale ? (
                        <span className="font-mono text-amber-300">
                          {bone.scale.keyframes.length} keyframe(s)
                        </span>
                      ) : (
                        <span className="text-slate-600">None</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab 3: Skeletal Hierarchy */}
          {activeTab === 'hierarchy' && activeClip && (
            <div className="flex flex-col gap-1.5">
              <div className="rounded bg-slate-950/60 p-2 border border-slate-800/60">
                <span className="font-semibold text-slate-300 text-[9px] flex items-center gap-1">
                  <GitBranch className="h-3 w-3 text-emerald-400" />
                  Hierarchical Bone Graph Resolution
                </span>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  Transforms evaluate along parent-child linkages to maintain correct anatomical proportions and kinematics.
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="text-[8px] text-slate-500 self-center">Root bones:</span>
                  {activeClip.rootBones.map((rb) => (
                    <span
                      key={rb}
                      className="rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 px-1.5 py-0.2 font-mono text-[8px]"
                    >
                      {rb}
                    </span>
                  ))}
                </div>
              </div>

              {activeClip.hierarchicalRelationships.length > 0 && (
                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                  {activeClip.hierarchicalRelationships.map((rel, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded bg-slate-950/40 p-1.5 border border-slate-800/40 font-mono text-[8px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">{rel.parent}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-fuchsia-300 font-bold">{rel.child}</span>
                      </div>
                      <span className="text-slate-500">depth {rel.depth}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Procedural & Cues */}
          {activeTab === 'procedural' && activeClip && (
            <div className="flex flex-col gap-2">
              {/* Procedural behaviors */}
              {activeClip.proceduralBehaviors.length > 0 ? (
                <div>
                  <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px] flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    Procedural Motion Behaviors ({activeClip.proceduralBehaviors.length})
                  </span>
                  <div className="mt-1 flex flex-col gap-1 max-h-36 overflow-y-auto">
                    {activeClip.proceduralBehaviors.map((pb, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950/60 p-1.5 border border-amber-900/40 flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="font-bold text-amber-300 font-mono">{pb.targetBone}</span>
                          <span className="rounded bg-amber-950 text-amber-200 border border-amber-800 px-1 py-0.1 text-[8px] uppercase">
                            {pb.kind.replace('_', ' ')}
                          </span>
                        </div>
                        <code className="text-slate-300 font-mono text-[8px] truncate">{pb.expression}</code>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded bg-slate-950/40 p-2 text-slate-400 text-[9px]">
                  No continuous procedural Molang formulas detected in this clip; driven via discrete keyframes.
                </div>
              )}

              {/* Sound & Particle Cues */}
              {(activeClip.audioReferences.length > 0 || activeClip.particleReferences.length > 0) && (
                <div>
                  <span className="font-semibold text-slate-300 uppercase tracking-wide text-[9px] flex items-center gap-1">
                    <Volume2 className="h-3 w-3 text-cyan-400" />
                    Audio & Particle Event Cues
                  </span>
                  <div className="mt-1 flex flex-col gap-1">
                    {activeClip.audioReferences.map((a, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950/50 p-1.5 border border-slate-800/40 flex items-center justify-between text-[9px]"
                      >
                        <span className="font-mono text-cyan-300">{a.sound}</span>
                        <span className="text-slate-400 font-mono text-[8px]">{a.time.toFixed(2)}s</span>
                      </div>
                    ))}
                    {activeClip.particleReferences.map((p, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-slate-950/50 p-1.5 border border-slate-800/40 flex items-center justify-between text-[9px]"
                      >
                        <span className="font-mono text-emerald-300">
                          {p.effect} {p.locator && <span className="text-slate-500">(@{p.locator})</span>}
                        </span>
                        <span className="text-slate-400 font-mono text-[8px]">{p.time.toFixed(2)}s</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Controllers */}
          {activeTab === 'controllers' && (
            <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
              {Object.values(report.controllers).map((ctrl) => (
                <div key={ctrl.id} className="rounded bg-slate-950/60 p-2 border border-slate-800/60 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-200 text-[9px] flex items-center gap-1">
                      <Cpu className="h-3 w-3 text-fuchsia-400" />
                      {ctrl.id}
                    </span>
                    <span className="rounded bg-slate-900 border border-slate-800 px-1 py-0.2 text-[8px] text-slate-400">
                      init: {ctrl.initialState}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {ctrl.stateGraph.states.map((st) => (
                      <span
                        key={st}
                        className="rounded bg-slate-900 border border-slate-800 px-1.5 py-0.2 font-mono text-[8px] text-fuchsia-300"
                      >
                        {st}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab 6: Preserved Metadata */}
          {activeTab === 'unfamiliar' && (
            <div className="flex flex-col gap-2">
              <div className="rounded bg-slate-950/60 p-2 border border-slate-800/60 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-300 text-[9px]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Unfamiliar Metadata Preservation Assurance</span>
                </div>
                <span className="rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40 px-1.5 py-0.2 font-mono text-[8px]">
                  {report.unfamiliarPropertiesPreserved} preserved
                </span>
              </div>
              <p className="text-[9px] text-slate-400 leading-relaxed">
                JavaBE adheres strictly to the rule: &quot;Do not discard unfamiliar properties simply because they are
                not immediately recognized.&quot; All custom authoring attributes, vendor-specific easing curves, and
                unknown tags are preserved verbatim in the IR metadata bag.
              </p>
              {activeClip && Object.keys(activeClip.unfamiliarProperties).length > 0 && (
                <div className="rounded bg-slate-950/70 p-2 border border-slate-800/40">
                  <span className="text-[8px] text-slate-500 uppercase block mb-1">
                    Preserved on {activeClip.id}:
                  </span>
                  <pre className="font-mono text-[8px] text-slate-300 max-h-28 overflow-y-auto">
                    {JSON.stringify(activeClip.unfamiliarProperties, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}