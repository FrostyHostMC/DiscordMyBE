import type { AnimationConflictFinding } from './mergeEngine';

export type SwitcherDecision = 'not-needed' | 'needs-review' | 'eligible' | 'ineligible' | 'unproven';
export type AnimationChannel = 'position' | 'rotation' | 'scale' | 'unknown';

export interface BoneChannelOverlap {
  bone: string;
  channel: AnimationChannel;
  /** Exact source animation IDs contributing to this overlapping interval. */
  animationIds: string[];
  controllerIds: string[];
  packIds: string[];
  /** Source-specific interval/condition evidence. Empty means the time overlap was not established. */
  overlapEvidence: string;
  /** Proposed single controller/system owner for this group. */
  proposedOwner: string | null;
}

export interface ControllerInliningEvidence {
  controllerId: string;
  scope: 'player' | 'mob' | 'unknown';
  /** All inbound references found by the whole-pack reference scan. */
  inboundReferences: string[];
  /** Every inbound path must be accounted for and rewritable through the entity animate entry. */
  allInboundReferencesRewritable: boolean;
  entityAnimateEntryPaths: string[];
  /** Old state ID -> generated state ID. */
  stateMap: Record<string, string>;
  /** Source transition target -> generated transition target. */
  renamedTransitionTargets: Record<string, string>;
  /** Every transition, on_entry and on_exit target was parsed and rewritten. */
  stateGraphRewriteComplete: boolean;
}

export interface SwitcherDependencyHit {
  category: 'sound_effects' | 'particle_effects' | 'run_command' | 'emit_particle' | 'play_sound' | 'molang' | 'script' | 'external_reference' | 'other';
  source: string;
  detail: string;
}

export interface SwitcherEligibilityInput {
  findings: readonly AnimationConflictFinding[];
  /** Both archive enumeration and relevant JSON parsing completed without omissions. */
  analysisComplete: boolean;
  /** The bone/channel/time-window analysis is complete, not just controller-name overlap detection. */
  overlapAnalysisComplete: boolean;
  overlapGroups: readonly BoneChannelOverlap[];
  controllerEvidence: readonly ControllerInliningEvidence[];
  dependencyHits: readonly SwitcherDependencyHit[];
  geometryMismatches: readonly string[];
  /** Lowest declared min_engine_version across all packs touched by this plan. */
  minEngineVersion: string | null;
  /** Lowest version required by the chosen property/event mechanism. */
  mechanismMinimumVersion: string | null;
  runtimeMechanismSupported: boolean;
}

export interface SwitcherIsolationPlan {
  decision: SwitcherDecision;
  eligible: boolean;
  summary: string;
  conflictingAnimationIds: string[];
  controllerIds: string[];
  boneChannelOverlaps: BoneChannelOverlap[];
  inliningMap: Record<string, Record<string, string>>;
  renamedTransitionTargets: Record<string, Record<string, string>>;
  proposedOwners: Array<{ bone: string; channel: AnimationChannel; owner: string | null }>;
  blockedBy: string[];
  requiresUserConfirmation: true;
}

function compareVersion(a: string, b: string): number {
  const parts = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * Read-only dry-run assessment. This function cannot write archives or generate a
 * controller. It only returns eligible when the caller supplies explicit evidence
 * for every required analysis and rewrite gate; missing evidence is unproven.
 */
export function assessSwitcherEligibility(input: SwitcherEligibilityInput): SwitcherIsolationPlan {
  const blockedBy: string[] = [];
  const criticalFindings = input.findings.filter((finding) => finding.severity === 'critical');
  const orderedControllers = [...input.controllerEvidence].sort((a, b) => a.controllerId.localeCompare(b.controllerId));
  const orderedGroups = [...input.overlapGroups].sort((a, b) => `${a.bone}|${a.channel}|${a.animationIds.slice().sort().join(',')}|${a.controllerIds.slice().sort().join(',')}`.localeCompare(`${b.bone}|${b.channel}|${b.animationIds.slice().sort().join(',')}|${b.controllerIds.slice().sort().join(',')}`));
  const controllerIds = [...new Set(orderedControllers.map((item) => item.controllerId))].sort();
  const conflictingAnimationIds = [...new Set(orderedGroups.flatMap((group) => group.animationIds))].sort();
  const inliningMap = Object.fromEntries(orderedControllers.map((item) => [item.controllerId, item.stateMap]));
  const renamedTransitionTargets = Object.fromEntries(orderedControllers.map((item) => [item.controllerId, item.renamedTransitionTargets]));
  const proposedOwners = orderedGroups.map(({ bone, channel, proposedOwner }) => ({ bone, channel, owner: proposedOwner }));

  const plan = (decision: SwitcherDecision, summary: string): SwitcherIsolationPlan => ({
    decision,
    eligible: decision === 'eligible',
    summary,
    conflictingAnimationIds,
    controllerIds,
    boneChannelOverlaps: orderedGroups.map((group) => ({ ...group, animationIds: [...group.animationIds].sort(), controllerIds: [...group.controllerIds].sort(), packIds: [...group.packIds].sort() })),
    inliningMap,
    renamedTransitionTargets,
    proposedOwners,
    blockedBy: [...new Set(blockedBy)],
    requiresUserConfirmation: true,
  });

  if (!input.analysisComplete) {
    blockedBy.push('Archive/file analysis is incomplete or at least one relevant file could not be parsed.');
    return plan('unproven', 'Cannot build a trustworthy isolation plan from incomplete input.');
  }
  if (!input.overlapAnalysisComplete) {
    blockedBy.push('Bone/channel/time-window overlap analysis is not complete; controller-name overlap alone is insufficient.');
    return plan('unproven', 'The analyzer has not proved which bone channels actually overlap.');
  }
  if (input.overlapGroups.length === 0) {
    return plan('not-needed', criticalFindings.length
      ? 'No bone/channel overlap group was proven; do not trigger Switcher from a coarse critical finding alone.'
      : 'No conflicting bone/channel group was found; use the standard merge path.');
  }
  if (input.overlapGroups.some((group) => group.channel === 'unknown' || !group.overlapEvidence.trim())) {
    blockedBy.push('At least one bone/channel group lacks a known channel or reproducible time-window overlap evidence.');
  }
  if (input.overlapGroups.some((group) => !group.proposedOwner || !group.controllerIds.length || !group.animationIds.length)) {
    blockedBy.push('At least one conflict group has no proposed owner or is missing animation/controller IDs.');
  }
  if (input.controllerEvidence.length === 0) {
    blockedBy.push('No controller inlining evidence was supplied.');
  }
  for (const controller of input.controllerEvidence) {
    if (controller.scope === 'unknown') blockedBy.push(`Controller ${controller.controllerId} has unknown player/mob scope.`);
    if (!controller.allInboundReferencesRewritable) blockedBy.push(`Controller ${controller.controllerId} has an inbound reference that cannot be rewritten through the entity animate list.`);
    if (controller.entityAnimateEntryPaths.length !== 1) blockedBy.push(`Controller ${controller.controllerId} does not have exactly one proven rewritable entity animate entry path.`);
    if (!controller.stateGraphRewriteComplete) blockedBy.push(`Controller ${controller.controllerId} has an incomplete state-graph rewrite; transitions, on_entry, and on_exit must be rewritten structurally.`);
    if (!Object.keys(controller.stateMap).length) blockedBy.push(`Controller ${controller.controllerId} has no state inlining map.`);
  }
  if (input.dependencyHits.length) {
    for (const hit of input.dependencyHits) blockedBy.push(`${hit.category} dependency at ${hit.source}: ${hit.detail}`);
  }
  for (const mismatch of input.geometryMismatches) blockedBy.push(`Geometry mismatch: ${mismatch}. Gating cannot create a missing bone.`);
  if (!input.minEngineVersion || !input.mechanismMinimumVersion) {
    blockedBy.push('The declared minimum engine version or mechanism minimum version is unknown.');
  } else if (compareVersion(input.minEngineVersion, input.mechanismMinimumVersion) < 0) {
    blockedBy.push(`Declared min_engine_version ${input.minEngineVersion} is below the mechanism requirement ${input.mechanismMinimumVersion}.`);
  }
  if (!input.runtimeMechanismSupported) {
    blockedBy.push('The selector/gatekeeper runtime mechanism has not been verified for the target Bedrock version.');
  }

  if (blockedBy.length) {
    const isUnknown = blockedBy.some((reason) => /unknown|incomplete|not supplied|not been proved|not been verified|not have a/i.test(reason));
    return plan(isUnknown ? 'unproven' : 'ineligible', 'Switcher plan is blocked; do not generate or modify files.');
  }

  return plan('eligible', 'A dry-run isolation plan passed all supplied static gates. User confirmation and generated-output validation are still required.');
}
