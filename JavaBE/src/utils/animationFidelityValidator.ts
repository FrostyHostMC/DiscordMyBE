import type {
  IRAnimationClip,
  IRTransformationChannel,
  UniversalAnimationIRReport,
} from '@/utils/universalAnimationIR';
import type { UniversalAnimationDiscoveryReport } from '@/utils/universalAnimationDiscovery';
import type { SkeletonReconciliationReport } from '@/utils/dynamicBoneRetargeter';
import {
  buildAnimationResourceRegistry,
  assertAnimationResourceRegistryCurrent,
  clipsSelectableBy,
  describeRegistryScopes,
  type AnimationRegistryMetrics,
  type AnimationResourceRegistry,
} from '@/utils/animationResourceRegistry';
import { buildBoneIndex, matchBoneName } from '@/utils/boneRetarget';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';

/**
 * Animation fidelity validation.
 *
 * "The JSON exists" is not evidence that an animation was ported. This stage takes the
 * engine-neutral interpretation of each source clip, re-reads the clip that actually shipped in
 * the pack, samples both curves at the same times, and reports the measured drift between them —
 * so a lost bone, a truncated timeline, a dropped channel or an approximated interpolation shows
 * up as a number instead of a green tick.
 *
 * Every curve is evaluated with the same piecewise-linear sampler, so the comparison measures a
 * data difference, never a difference in the sampler itself. Playback inside a Bedrock client is
 * still not observed here and the report says so.
 */

export interface AnimationFidelityIssue {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  subject: string;
  detail: string;
}

export type AnimationFidelityIssueScope = 'source-comparison' | 'final-export' | 'retarget-pass' | 'runtime-context';

export type AnimationFidelityIssueCounts = Record<AnimationFidelityIssueScope, {
  errors: number;
  warnings: number;
  info: number;
}>;

export interface ClipFidelity {
  clipId: string;
  owner: string;
  perspective: string;
  shipped: boolean;
  registered: boolean;
  activated: boolean;
  /** 0-100, measured from sampled curve drift (100 = every sampled axis identical). */
  fidelity: number;
  bonesSource: number;
  bonesShipped: number;
  bonesLost: string[];
  channelsCompared: number;
  channelsLost: string[];
  keyframesSource: number;
  keyframesShipped: number;
  durationSource: number;
  durationShipped: number;
  maxDrift: number;
}

export interface AnimationFidelityReport {
  /** Every final-pack count in this report comes from the one exported-resource registry. */
  exportedMetrics: AnimationRegistryMetrics | null;
  clipsInterpreted: number;
  clipsShipped: number;
  clipsMissing: number;
  clipsFaithful: number;
  clipsApproximated: number;
  averageFidelity: number | null;
  issueCountsByScope: AnimationFidelityIssueCounts;
  /** @deprecated Alias for final-skeleton compatibility. Source-track retention is `boneTrackCoverage`. */
  boneCoverage: number;
  /** Same figure, named for what it measures so it cannot be read as "the skeleton matches". */
  boneTrackCoverage: number;
  /** Source bone names with tracks in the IR, and those retained in shipped definitions. */
  sourceBoneTracks: number;
  sourceBoneTracksRetained: number;
  /** 0-100: tracked bones that address a bone the owning entity's rendered skeleton declares (registry audit). */
  skeletonCoverage: number;
  /** Mean measured curve drift across shipped clips, %. Non-zero on a composed track is the pose-retargeting error. */
  poseRetargetErrorPct: number | null;
  registeredClips: number;
  activatedClips: number;
  renderIntegratedClips: number;
  /** Always 0: nothing here runs inside a Bedrock client. */
  playbackVerified: number;
  /** Tracks the skeleton stage composed onto an ancestor: same motion, not the same pose. */
  poseApproximations: Array<{ clipId: string; bones: string[]; reason: string }>;
  /** One line per figure, stating the population it measures. */
  metricScopes: string[];
  channelsCompared: number;
  samplesPerChannel: number;
  playbackSimulated: number;
  clips: ClipFidelity[];
  issues: AnimationFidelityIssue[];
  summary: string;
}

interface CurvePoint {
  time: number;
  value: number[];
}

interface ShippedClip {
  id: string;
  path: string;
  bones: Record<string, Record<string, unknown>>;
  length: number;
}

function createIssueCountsByScope(): AnimationFidelityIssueCounts {
  return {
    'source-comparison': { errors: 0, warnings: 0, info: 0 },
    'final-export': { errors: 0, warnings: 0, info: 0 },
    'retarget-pass': { errors: 0, warnings: 0, info: 0 },
    'runtime-context': { errors: 0, warnings: 0, info: 0 },
  };
}

export function getAnimationFidelityIssueScope(rule: string): AnimationFidelityIssueScope {
  if (['extracted-not-shipped', 'bone-track-lost', 'channel-lost', 'duration-drift', 'curve-drift', 'curve-not-numerically-comparable'].includes(rule)) {
    return 'source-comparison';
  }
  if (['pose-approximated', 'bone-reconstructed'].includes(rule)) return 'retarget-pass';
  if (rule === 'uninitialized-variable') return 'runtime-context';
  return 'final-export';
}

function summarizeIssueCounts(issues: AnimationFidelityIssue[]): AnimationFidelityIssueCounts {
  const counts = createIssueCountsByScope();
  for (const issue of issues) {
    const scope = counts[getAnimationFidelityIssueScope(issue.rule)];
    if (issue.severity === 'error') scope.errors += 1;
    else if (issue.severity === 'warning') scope.warnings += 1;
    else scope.info += 1;
  }
  return counts;
}

const SAMPLE_COUNT = 12;
const ENGINE_VANILLA = { test: isKnownVanillaPlayerAnimationReference };
/** Variables the vanilla player client entity defines itself; they are never "uninitialized". */
const ENGINE_VARIABLES = new Set(['attack_time', 'hurt_time', 'item_use_time', 'is_using_item']);

function sampleCurve(points: CurvePoint[], duration: number): number[][] {
  const span = Math.max(duration, points[points.length - 1]?.time ?? 0, 0.001);
  const out: number[][] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const time = (span * index) / (SAMPLE_COUNT - 1);
    out.push([evalAxis(points, time, 0), evalAxis(points, time, 1), evalAxis(points, time, 2)]);
  }
  return out;
}

function evalAxis(points: CurvePoint[], time: number, axis: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (time <= first.time) return first.value[axis] ?? 0;
  if (time >= last.time) return last.value[axis] ?? 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (time < a.time || time > b.time) continue;
    const span = b.time - a.time;
    if (span <= 0) return b.value[axis] ?? 0;
    const ratio = (time - a.time) / span;
    return (a.value[axis] ?? 0) + ((b.value[axis] ?? 0) - (a.value[axis] ?? 0)) * ratio;
  }
  return last.value[axis] ?? 0;
}

function numericSamplesFromIR(channel: IRTransformationChannel, duration: number): number[][] | null {
  const points: CurvePoint[] = [];
  for (const keyframe of channel.keyframes) {
    if (keyframe.isMolang) continue;
    const value: number[] = [];
    for (const axis of keyframe.value) {
      value.push(typeof axis === 'number' ? axis : Number(axis));
    }
    if (value.some((axis) => !Number.isFinite(axis))) continue;
    points.push({ time: keyframe.time, value });
  }
  return points.length > 0 ? sampleCurve(points, duration) : null;
}

function numericSamplesFromBedrock(raw: unknown, duration: number): number[][] | null {
  const points: CurvePoint[] = [];
  const push = (time: number, value: unknown) => {
    if (!Array.isArray(value) || value.length < 3) return;
    const parsed: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const axis = value[index];
      if (typeof axis !== 'number' || !Number.isFinite(axis)) return;
      parsed.push(axis);
    }
    points.push({ time, value: parsed });
  };

  if (Array.isArray(raw)) {
    push(0, raw);
  } else if (raw && typeof raw === 'object') {
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      const time = parseFloat(key);
      if (!Number.isFinite(time)) continue;
      if (Array.isArray(entry)) {
        push(time, entry);
        continue;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        push(time, record.post ?? record.pre ?? record);
      }
    }
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.time - b.time);
  return sampleCurve(points, duration);
}

function collectShippedClips(registry: AnimationResourceRegistry): Record<string, ShippedClip> {
  const clips: Record<string, ShippedClip> = {};
  for (const [id, definition] of registry.clips) {
    const rawBones = definition.body.bones && typeof definition.body.bones === 'object'
      ? definition.body.bones as Record<string, unknown>
      : {};
    const bones: Record<string, Record<string, unknown>> = {};
    for (const [boneName, track] of Object.entries(rawBones)) {
      if (track && typeof track === 'object') bones[boneName] = track as Record<string, unknown>;
    }
    clips[id] = {
      id,
      path: definition.path,
      bones,
      length: Number(definition.body.animation_length) || 0,
    };
  }
  return clips;
}



function collectDefinedIdentifiers(
  files: Record<string, string | Uint8Array>,
  prefix: string,
  key: string,
): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix) || !path.toLowerCase().endsWith('.json')) continue;
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const id of Object.keys((parsed[key] as Record<string, unknown>) ?? {})) ids.add(id);
    } catch {
      continue;
    }
  }
  return ids;
}

function compareClip(
  source: IRAnimationClip,
  shipped: ShippedClip | undefined,
): { channelsCompared: number; channelsLost: string[]; bonesLost: string[]; maxDrift: number; keyframesShipped: number; bonesShipped: number } {
  const result = {
    channelsCompared: 0,
    channelsLost: [] as string[],
    bonesLost: [] as string[],
    maxDrift: 0,
    keyframesShipped: 0,
    bonesShipped: 0,
  };
  if (!shipped) return result;
  result.bonesShipped = Object.keys(shipped.bones).length;
  for (const track of Object.values(shipped.bones)) {
    for (const channel of ['rotation', 'position', 'scale']) {
      const value = track[channel];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result.keyframesShipped += Object.keys(value as Record<string, unknown>).length;
      } else if (value) {
        result.keyframesShipped += 1;
      }
    }
  }

  const duration = Math.max(source.timeline?.durationSeconds ?? 0, shipped.length, 0.001);
  // The shipped clip may name the same bone differently (`leftArm` vs `left_arm`). A renamed
  // track is a mapping, not a lost one, so the same general matcher the retargeting stage uses
  // resolves the source bone before a track is reported as lost.
  const shippedIndex = buildBoneIndex(Object.keys(shipped.bones));
  for (const bone of Object.values(source.bones)) {
    const resolvedBone = matchBoneName(bone.boneName, shippedIndex).bone;
    const track = shipped.bones[bone.boneName] ?? (resolvedBone ? shipped.bones[resolvedBone] : undefined);
    if (!track) {
      result.bonesLost.push(bone.boneName);
      continue;
    }
    for (const channelName of ['rotation', 'position', 'scale'] as const) {
      const channel = bone[channelName];
      if (!channel) continue;
      const shippedRaw = track[channelName];
      if (shippedRaw === undefined) {
        result.channelsLost.push(`${bone.boneName}.${channelName}`);
        continue;
      }
      const sourceSamples = numericSamplesFromIR(channel, duration);
      const shippedSamples = numericSamplesFromBedrock(shippedRaw, duration);
      // Molang-driven axes are not numerically comparable; they are reported by the emitter.
      if (!sourceSamples || !shippedSamples) continue;
      result.channelsCompared += 1;
      for (let index = 0; index < sourceSamples.length; index += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const expected = sourceSamples[index][axis];
          const actual = shippedSamples[index][axis];
          const drift = Math.abs(expected - actual) / Math.max(Math.abs(expected), 1);
          if (drift > result.maxDrift) result.maxDrift = drift;
        }
      }
    }
  }
  return result;
}

export function validateAnimationFidelity(input: {
  ir?: UniversalAnimationIRReport;
  discovery?: UniversalAnimationDiscoveryReport;
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles?: Record<string, string | Uint8Array>;
  expectedClips?: string[];
  /** Registry of the exported pack; every count below is read from it so no two stages disagree. */
  registry?: AnimationResourceRegistry;
  /** Skeleton reconciliation, so composed tracks are reported as pose approximations. */
  skeleton?: SkeletonReconciliationReport;
  onLog?: (line: string) => void;
}): AnimationFidelityReport {
  const { ir, resourcePackFiles } = input;
  const log = (line: string) => input.onLog?.(line);
  const issues: AnimationFidelityIssue[] = [];
  const registry =
    input.registry ??
    buildAnimationResourceRegistry({
      resourcePackFiles,
      behaviorPackFiles: input.behaviorPackFiles,
    });
  assertAnimationResourceRegistryCurrent(registry, {
    resourcePackFiles,
    behaviorPackFiles: input.behaviorPackFiles,
  });
  const registryRegistered = new Set(registry.metrics.registeredClipIds);
  const registryActivated = new Set(registry.metrics.activatedClipIds);
  const report: AnimationFidelityReport = {
    exportedMetrics: registry.metrics,
    clipsInterpreted: 0,
    clipsShipped: 0,
    clipsMissing: 0,
    clipsFaithful: 0,
    clipsApproximated: 0,
    averageFidelity: null,
    issueCountsByScope: createIssueCountsByScope(),
    boneCoverage: registry.metrics.bones.checked > 0
      ? Math.round((registry.metrics.bones.resolved / registry.metrics.bones.checked) * 100)
      : 0,
    boneTrackCoverage: 0,
    sourceBoneTracks: 0,
    sourceBoneTracksRetained: 0,
    skeletonCoverage: registry.metrics.bones.checked > 0
      ? Math.round((registry.metrics.bones.resolved / registry.metrics.bones.checked) * 100)
      : 0,
    poseRetargetErrorPct: null,
    registeredClips: registry.metrics.clipsRegistered,
    activatedClips: registry.metrics.clipsActivated,
    renderIntegratedClips: 0,
    playbackVerified: 0,
    poseApproximations: [],
    metricScopes: [],
    channelsCompared: 0,
    samplesPerChannel: SAMPLE_COUNT,
    playbackSimulated: 0,
    clips: [],
    issues,
    summary: '',
  };
  if (!ir || ir.clipCount === 0) {
    report.metricScopes = [
      'source curves: not measured because the interpretation stage produced no clips.',
      ...describeRegistryScopes(registry.metrics),
    ];
    report.summary = `Animation fidelity: source curves not measured; final export has ${registry.metrics.clipsDefined} definition(s), ${registry.metrics.clipsRegistered} selectable and ${registry.metrics.clipsActivated} with a start path.`;
    log(`[ANIM:FIDELITY] ${report.summary}`);
    for (const scope of report.metricScopes) log(`[ANIM:FIDELITY:SCOPE] ${scope}`);
    return report;
  }

  const shipped = collectShippedClips(registry);
  const entities = registry.entities;
  /** Clips an entity that binds geometry can select — the population that can actually render. */
  const clipsRendered = new Set<string>();
  for (const entity of registry.entities) {
    if (entity.geometryIds.length === 0) continue;
    for (const clipId of clipsSelectableBy(entity)) clipsRendered.add(clipId);
  }
  const sounds = collectDefinedIdentifiers(resourcePackFiles, 'sounds/', 'sound_definitions');
  const particles = collectDefinedIdentifiers(resourcePackFiles, 'particles/', 'particle_effect');
  const expected = new Set(input.expectedClips ?? []);

  for (const { id: clipId, definitions } of registry.metrics.duplicateAnimationIds) {
    issues.push({
      severity: 'error',
      rule: 'duplicate-animation-id',
      subject: clipId,
      detail: `${definitions} final animation documents define this identifier; the engine keeps one and silently discards the rest, so part of the motion is lost.`,
    });
  }

  let fidelityTotal = 0;
  let fidelityWeight = 0;
  let sourceBones = 0;
  let resolvedBones = 0;

  for (const clip of Object.values(ir.clips)) {
    report.clipsInterpreted += 1;
    const shippedClip = shipped[clip.id];
    // Bones the rendered skeleton genuinely lacks come from the registry's single bone audit:
    // pack geometry plus the engine player rig the entity really renders. Re-deriving the
    // skeleton here measured pack geometry only, which is what turned the player rig's own
    // joints into false "missing bone" errors.
    const missingBones = registry.metrics.bones.missingByClip[clip.id] ?? [];

    const comparison = compareClip(clip, shippedClip);
    const drift = Math.min(1, comparison.maxDrift);
    const sourceKeyframes = Object.values(clip.bones).reduce(
      (total, bone) =>
        total + (bone.position?.keyframes.length ?? 0) + (bone.rotation?.keyframes.length ?? 0) + (bone.scale?.keyframes.length ?? 0),
      0,
    );
    const entry: ClipFidelity = {
      clipId: clip.id,
      owner: clip.owner,
      perspective: clip.perspective,
      shipped: Boolean(shippedClip),
      registered: registryRegistered.has(clip.id),
      activated: registryActivated.has(clip.id),
      fidelity: shippedClip && comparison.channelsCompared > 0 ? Math.round(100 * (1 - drift)) : 0,
      bonesSource: Object.keys(clip.bones).length,
      bonesShipped: comparison.bonesShipped,
      bonesLost: comparison.bonesLost,
      channelsCompared: comparison.channelsCompared,
      channelsLost: comparison.channelsLost,
      keyframesSource: sourceKeyframes,
      keyframesShipped: comparison.keyframesShipped,
      durationSource: clip.timeline?.durationSeconds ?? 0,
      durationShipped: shippedClip?.length ?? 0,
      maxDrift: Math.round(comparison.maxDrift * 10000) / 10000,
    };
    report.clips.push(entry);
    report.channelsCompared += comparison.channelsCompared;
    report.playbackSimulated += comparison.channelsCompared > 0 ? 1 : 0;
    sourceBones += entry.bonesSource;
    report.sourceBoneTracks = sourceBones;

    const hadMotion = sourceKeyframes > 0;
    if (!shippedClip) {
      report.clipsMissing += 1;
      if (hadMotion || expected.has(clip.id)) {
        issues.push({
          severity: 'error',
          rule: 'extracted-not-shipped',
          subject: clip.id,
          detail: `${clip.owner} clip carries ${sourceKeyframes} keyframe(s) in the source IR but no animation document in the pack defines it, so the extracted motion never reaches the game.`,
        });
      }
      continue;
    }

    report.clipsShipped += 1;
    resolvedBones += Math.max(0, entry.bonesSource - comparison.bonesLost.length);
    report.sourceBoneTracksRetained = resolvedBones;
    if (hadMotion && comparison.channelsCompared > 0) {
      fidelityTotal += entry.fidelity;
      fidelityWeight += 1;
      if (entry.fidelity >= 95) report.clipsFaithful += 1;
      else report.clipsApproximated += 1;
    } else if (hadMotion) {
      issues.push({
        severity: 'info',
        rule: 'curve-not-numerically-comparable',
        subject: clip.id,
        detail: 'The clip carries source motion, but no numeric source/shipped channel pair was available for curve scoring; curve fidelity is not measured for this clip.',
      });
    }
    if (comparison.bonesLost.length > 0) {
      issues.push({
        severity: 'error',
        rule: 'bone-track-lost',
        subject: clip.id,
        detail: `${comparison.bonesLost.length} animated bone(s) are missing from the shipped definition (${comparison.bonesLost.slice(0, 5).join(', ')}), so those limbs stay in their rest pose.`,
      });
    }
    if (comparison.channelsLost.length > 0) {
      issues.push({
        severity: 'error',
        rule: 'channel-lost',
        subject: clip.id,
        detail: `Source channels with keyframes were dropped from the shipped clip: ${comparison.channelsLost.slice(0, 5).join(', ')}.`,
      });
    }
    if (entry.durationSource > 0 && Math.abs(entry.durationShipped - entry.durationSource) / entry.durationSource > 0.05) {
      issues.push({
        severity: 'warning',
        rule: 'duration-drift',
        subject: clip.id,
        detail: `Source timeline is ${entry.durationSource}s but the shipped clip declares ${entry.durationShipped}s; the motion is played at a different speed.`,
      });
    }
    if (hadMotion && comparison.channelsCompared > 0 && entry.fidelity < 95) {
      issues.push({
        severity: entry.fidelity < 70 ? 'error' : 'warning',
        rule: 'curve-drift',
        subject: clip.id,
        detail: `Sampled curve drift is ${(entry.maxDrift * 100).toFixed(1)}% across ${entry.channelsCompared} compared channel(s) (${SAMPLE_COUNT} samples each), so the shipped motion is not identical to the interpreted source.`,
      });
    }
    if (!entry.registered) {
      issues.push({
        severity: 'error',
        rule: 'shipped-not-registered',
        subject: clip.id,
        detail: 'The clip ships as a definition but no client entity registers it, so it can never be selected.',
      });
    } else if (!entry.activated) {
      issues.push({
        severity: 'error',
        rule: 'registered-not-activated',
        subject: clip.id,
        detail: `Registered but no verified animate, reachable-controller, or behaviour-script start path reaches this clip in the final pack.`,
      });
    }
    if (missingBones.length > 0) {
      issues.push({
        severity: 'error',
        rule: 'bone-not-in-skeleton',
        subject: clip.id,
        detail: `${missingBones.length} animated bone(s) address no bone of the skeleton its owning client entity renders (registry measurement: ${registry.metrics.bones.resolved}/${registry.metrics.bones.checked} shipped track(s) resolve): ${missingBones.slice(0, 5).join(', ')}.`,
      });
    } else if (entry.registered && clip.targetClassification !== 'player' && registry.metrics.bones.checked === 0) {
      issues.push({
        severity: 'warning',
        rule: 'skeleton-unmeasured',
        subject: clip.id,
        detail: 'The owning client entity renders no skeleton this pack declares, so bone resolution could not be measured for this clip. It is reported as unmeasured, never counted as resolved.',
      });
    }
    for (const reference of clip.audioReferences ?? []) {
      if (sounds.has(reference.sound) || reference.sound.startsWith('minecraft:')) continue;
      issues.push({
        severity: 'warning',
        rule: 'sound-reference-unresolved',
        subject: `${clip.id} @ ${reference.time}s`,
        detail: `Sound event "${reference.sound}" is not declared in sounds/sound_definitions.json, so the cue is silent at runtime.`,
      });
    }
    for (const reference of clip.particleReferences ?? []) {
      if (particles.has(reference.effect) || reference.effect.startsWith('minecraft:')) continue;
      issues.push({
        severity: 'warning',
        rule: 'particle-reference-unresolved',
        subject: `${clip.id} @ ${reference.time}s`,
        detail: `Particle effect "${reference.effect}" ships no definition, so the effect does not spawn.`,
      });
    }
  }

  // Clips that ship but the interpretation stage never saw: registered motion with no source
  // record is a conflict/override risk and is reported rather than assumed correct.
  for (const clipId of Object.keys(shipped)) {
    if (ir.clips[clipId]) continue;
    if (ENGINE_VANILLA.test(clipId)) continue;
    issues.push({
      severity: 'info',
      rule: 'uninterpreted-clip',
      subject: clipId,
      detail: `Ships in ${shipped[clipId].path} but no source record exists for it, so its fidelity could not be measured.`,
    });
  }

  // Variables referenced by activation conditions that nothing initialises: the classic
  // "can't find variable" runtime error, which silently disables the condition.
  for (const entity of entities) {
    const conditions = Object.values(entity.animateConditions)
      .filter((condition): condition is string => typeof condition === 'string')
      .join('\n');
    for (const match of conditions.matchAll(/variable\.([a-z0-9_]+)/gi)) {
      const name = String(match[1]).toLowerCase();
      if (ENGINE_VARIABLES.has(name) || entity.initializedVariables.has(name)) continue;
      issues.push({
        severity: 'warning',
        rule: 'uninitialized-variable',
        subject: `${entity.identifier}: ${name}`,
        detail: `Activation logic uses variable.${name} but this client entity never initialises it; the expression evaluates to nothing at runtime instead of the intended state.`,
      });
    }
  }

  // ── the figures, each reported with the population it measures ─────────────────────────────
  // A curve match, a bone mapping, a registration and a playback are four different facts. They
  // are never collapsed into one "compatibility" number, because a ship-ready percentage made of
  // copies can hide a pose that a Bedrock client would never reproduce.
  report.averageFidelity = fidelityWeight > 0 ? Math.round(fidelityTotal / fidelityWeight) : null;
  report.boneTrackCoverage = sourceBones > 0 ? Math.round((resolvedBones / sourceBones) * 100) : 0;
  report.skeletonCoverage =
    registry.metrics.bones.checked > 0
      ? Math.round((registry.metrics.bones.resolved / registry.metrics.bones.checked) * 100)
      : 0;
  report.boneCoverage = report.skeletonCoverage;
  const driftSamples = report.clips.filter((clip) => clip.shipped && clip.channelsCompared > 0);
  report.poseRetargetErrorPct =
    driftSamples.length > 0
      ? Math.round((driftSamples.reduce((total, clip) => total + clip.maxDrift, 0) / driftSamples.length) * 10000) / 100
      : null;
  report.registeredClips = registry.metrics.clipsRegistered;
  report.activatedClips = registry.metrics.clipsActivated;
  report.renderIntegratedClips = [...clipsRendered].filter((clipId) => registryRegistered.has(clipId)).length;
  report.playbackVerified = 0;
  // A track composed onto an ancestor keeps the motion but not the pose. It is reported per clip
  // instead of being folded into the curve figure, because a copied curve measures identical even
  // when the bone it drives is not the bone the source animates.
  const collapsedByClip = new Map<string, string[]>();
  for (const collapse of input.skeleton?.bonesCollapsed ?? []) {
    const list = collapsedByClip.get(collapse.clipId) ?? [];
    list.push(`${collapse.from}→${collapse.to}`);
    collapsedByClip.set(collapse.clipId, list);
  }
  for (const [clipId, bones] of collapsedByClip) {
    report.poseApproximations.push({
      clipId,
      bones,
      reason: 'the rendered rig cannot gain these bones, so their transform is composed onto an ancestor: the limb still moves, but the resulting pose is an approximation of the source pose',
    });
  }
  for (const approximation of report.poseApproximations.slice(0, 8)) {
    issues.push({
      severity: 'warning',
      rule: 'pose-approximated',
      subject: approximation.clipId,
      detail: `${approximation.bones.length} source bone(s) were composed onto an ancestor (${approximation.bones.slice(0, 4).join(', ')}), so this clip's pose is an approximation of the source pose, not a faithful reproduction.`,
    });
  }
  const reconstructedByClip = new Map<string, string[]>();
  for (const injection of input.skeleton?.bonesInjected ?? []) {
    const bones = reconstructedByClip.get(injection.clipId) ?? [];
    bones.push(injection.bone);
    reconstructedByClip.set(injection.clipId, bones);
  }
  for (const [clipId, bones] of reconstructedByClip) {
    issues.push({
      severity: 'warning',
      rule: 'bone-reconstructed',
      subject: clipId,
      detail:
        `${bones.length} missing source bone/socket node(s) were rebuilt automatically ` +
        `(${bones.slice(0, 4).join(', ')}). Their original pivots were unavailable in the ` +
        `converted geometry, so the nearest compatible parent pivot was used; local placement ` +
        `still needs in-game confirmation.`,
    });
  }
  report.issueCountsByScope = summarizeIssueCounts(issues);
  const curveFidelityLabel = report.averageFidelity === null ? 'not measured' : `${report.averageFidelity}%`;
  const poseDriftLabel = report.poseRetargetErrorPct === null ? 'not measured' : `${report.poseRetargetErrorPct}%`;
  const errorsAfterPose = issues.filter((issue) => issue.severity === 'error').length;
  const warningsAfterPose = issues.filter((issue) => issue.severity === 'warning').length;
  const issueScopeSummary = (Object.entries(report.issueCountsByScope) as Array<[AnimationFidelityIssueScope, AnimationFidelityIssueCounts[AnimationFidelityIssueScope]]>)
    .map(([scope, counts]) => `${counts.errors} ${scope}`)
    .join(', ');
  report.metricScopes = [
    `source curves: ${report.clipsShipped}/${report.clipsInterpreted} interpreted clip(s) shipped; ${curveFidelityLabel} average sampled curve preservation across ${fidelityWeight} clip(s) with comparable numeric channels and ${report.channelsCompared} channel(s).`,
    `bone tracks: ${report.sourceBoneTracksRetained}/${report.sourceBoneTracks} source bone names carry a track in shipped definitions (${report.boneTrackCoverage}%; this does not measure whether the owning skeleton contains those bones).`,
    `skeleton: ${registry.metrics.bones.checked > 0 ? `${report.skeletonCoverage}% (${registry.metrics.bones.resolved}/${registry.metrics.bones.checked}) of measured final owner/clip/bone bindings resolve` : 'not measured'}; ${registry.metrics.bones.unresolved.length} checked bindings do not and ${registry.metrics.bones.skeletonsUnresolved.length} owner skeleton(s) were not measurable.`,
    `retarget pass: ${poseDriftLabel} mean sampled curve drift on comparable shipped clips, ${report.poseApproximations.length} clip(s) with tracks composed onto an ancestor, and ${reconstructedByClip.size} with rebuilt bones using unverified parent pivots.`,
    `registration: ${report.registeredClips} unique clip id(s) selectable by a client entity; activation: ${report.activatedClips}/${report.registeredClips} unique registered id(s) have a start path.`,
    `rendering: ${report.renderIntegratedClips} registered clip id(s) belong to an entity that binds geometry; path-type activation counts can overlap.`,
    `findings: ${errorsAfterPose} errors (${issueScopeSummary}), ${warningsAfterPose} warnings, ${issues.filter((issue) => issue.severity === 'info').length} informational; final-export findings may also appear in integration, so panel totals are not additive.`,
    'playback: 0 verified — nothing here runs inside a Bedrock client.',
  ];
  report.summary =
    `Animation audit: ${report.clipsInterpreted} interpreted → ${report.clipsShipped} shipped (${report.clipsMissing} missing); ` +
    `${report.channelsCompared} channel(s) sampled at ${SAMPLE_COUNT} points, curve preservation ${curveFidelityLabel} ` +
    `(${report.clipsFaithful} faithful, ${report.clipsApproximated} approximated); source bone tracks ${report.sourceBoneTracksRetained}/${report.sourceBoneTracks} retained (${report.boneTrackCoverage}%), ` +
    `final skeleton bindings ${registry.metrics.bones.checked > 0 ? `${report.skeletonCoverage}% (${registry.metrics.bones.resolved}/${registry.metrics.bones.checked})` : 'not measured'} with ${registry.metrics.bones.unresolved.length} unresolved; ` +
    `${report.poseApproximations.length} approximated clip(s); registered ${report.registeredClips}, activated ${report.activatedClips}, ` +
    `rendering-integrated ${report.renderIntegratedClips}, playback verified 0; ${errorsAfterPose} error(s), ${warningsAfterPose} warning(s).`;
  log(`[ANIM:FIDELITY] ${report.summary}`);
  for (const scope of report.metricScopes) log(`[ANIM:FIDELITY:SCOPE] ${scope}`);
  for (const issue of issues.slice(0, 12)) {
    log(`[ANIM:FIDELITY:${issue.severity.toUpperCase()}] ${issue.subject} — ${issue.detail}`);
  }
  return report;
}