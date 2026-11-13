import type { SkeletonReconciliationReport } from '@/utils/dynamicBoneRetargeter';
import type { AnimationStateReport } from '@/utils/animationStateResolver';
import type { ReferenceIntegrityReport } from '@/utils/referenceIntegrityAuditor';
import type { AnimationIntegrationReport } from '@/utils/animationIntegrationValidator';
import type { AnimationFidelityReport } from '@/utils/animationFidelityValidator';
import {
  buildAnimationResourceRegistry,
  assertAnimationResourceRegistryCurrent,
  describeRegistryScopes,
  type AnimationRegistryMetrics,
  type AnimationResourceRegistry,
} from '@/utils/animationResourceRegistry';
import { auditMolangCompatibility, type MolangCompatibilityReport } from '@/utils/molangCompatibility';


/**
 * Real animation validation pipeline.
 *
 * This is the pass that has to be green before a port may be called converted. It re-scans the
 * exact pack that exports and answers each question with evidence from that pack:
 *
 *   definitions · bone references · geometry references · controller definitions ·
 *   entity registrations · animation identifiers · render-controller references ·
 *   activation conditions · first-person playback wiring · third-person playback wiring ·
 *   animation conflicts · missing dependencies.
 *
 * Every check is `pass`, `repaired` (a named repair changed the pack), `unresolved` (still
 * broken, reported with the exact subject) or `not-measured` (nothing in the pack to measure —
 * never reported as a pass). `playbackVerified` stays 0: no check here runs inside a Bedrock
 * client, so a green report means "wired and consistent", not "watched moving".
 */

export type RuntimeCheckStatus = 'pass' | 'repaired' | 'unresolved' | 'not-measured';

/**
 * One of the ten pipeline stages. `playback` never leaves `not-verified`: nothing in this
 * pipeline observes a live Bedrock client, so structural success is never reported as playback.
 */
export type AnimationPipelineStageStatus = 'pass' | 'repaired' | 'unresolved' | 'not-measured' | 'not-verified';

export interface AnimationPipelineStage {
  index: number;
  id: string;
  label: string;
  status: AnimationPipelineStageStatus;
  detail: string;
}

export interface RuntimeCheck {
  id: string;
  label: string;
  rule: string;
  status: RuntimeCheckStatus;
  detail: string;
}

/**
 * One compatibility dimension, measured on its own. A curve match is not a skeleton match, a
 * registered clip is not an activated clip, and an activated clip is not verified playback, so
 * these are reported side by side and never averaged into a single "compatibility" figure.
 */
export interface AnimationCompatibilityScore {
  id: string;
  label: string;
  /** Measured percentage for this dimension, or null when the pack offers nothing to measure. */
  percent: number | null;
  /** What the percentage counts, in words, so two numbers can never be read as one claim. */
  basis: string;
  status: 'pass' | 'partial' | 'fail' | 'not-measured' | 'not-verified';
  detail: string;
}

export interface AnimationRuntimeReport {
  checks: RuntimeCheck[];
  passed: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    definitions: number;
    definitionsWithMotion: number;
    clipsRegistered: number;
    clipsActivated: number;
    boneTracksChecked: number;
    boneTracksUnresolved: number;
    controllersDefined: number;
    controllersActivated: number;
    firstPersonStates: number;
    thirdPersonStates: number;
    unconditionalStates: number;
  };
  /** The sole source for every final exported animation count and population. */
  exportedMetrics: AnimationRegistryMetrics;
  skeleton?: SkeletonReconciliationReport;
  states?: AnimationStateReport;
  references?: ReferenceIntegrityReport;
  integration?: AnimationIntegrationReport;
  fidelity?: AnimationFidelityReport;
  /** Always 0 — nothing in this pipeline observes a live client. */
  /** The ten pipeline stages, each with its own status, all measured on the exported pack. */
  pipelineStages: AnimationPipelineStage[];
  /**
   * Ten independent dimensions, reported side by side and never averaged: a 100% curve match says
   * nothing about skeleton fidelity, activation validity, Molang validity or playback.
   */
  scores: AnimationCompatibilityScore[];
  /** Molang context audit of the exported pack (measured, or the repair pass's own report). */
  molang?: MolangCompatibilityReport;
  playbackVerified: 0;
  summary: string;
}

type FileMap = Record<string, string | Uint8Array>;

export function validateAnimationRuntime(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  skeleton?: SkeletonReconciliationReport;
  states?: AnimationStateReport;
  references?: ReferenceIntegrityReport;
  integration?: AnimationIntegrationReport;
  fidelity?: AnimationFidelityReport;
  /** Clips the discovery pass recovered from the archive (stage 1 evidence). */
  extractedClips?: number;
  /** Clips the interpretation IR produced (stage 2 evidence). */
  interpretedClips?: number;
  /** Clips the pipeline intended to make playable; an orphan among them is a hard failure. */
  expectedClips?: string[];
  /** Registry of the exported pack; when absent this validator builds it from the same maps. */
  registry?: AnimationResourceRegistry;
  /** Molang context audit of the exported pack; when absent this validator measures it. */
  molang?: MolangCompatibilityReport;
  onLog?: (line: string) => void;
}): AnimationRuntimeReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  // The registry is built once per run and shared, so every figure below describes the same pack.
  const registry =
    input.registry ??
    buildAnimationResourceRegistry({
      resourcePackFiles: files,
      behaviorPackFiles: input.behaviorPackFiles,
    });
  assertAnimationResourceRegistryCurrent(registry, {
    resourcePackFiles: files,
    behaviorPackFiles: input.behaviorPackFiles,
  });
  const checks: RuntimeCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  // A later stage's failure can never be overridden by an earlier stage's success: the
  // integration audit and the ten pipeline stages are evaluated on the same final pack, and any
  // integration error keeps the whole run unresolved.
  const integrationFailure = input.integration !== undefined && input.integration.passed === false;

  const definitions = new Map<string, { bones: string[]; path: string }>(
    [...registry.clips.entries()].map(([clipId, clip]) => [clipId, { bones: clip.bones, path: clip.path }]),
  );
  const motionDefinitions = [...definitions.values()].filter((entry) => entry.bones.length > 0);

  checks.push({
    id: 'definitions',
    label: 'Animation definitions',
    rule: 'Every shipped animation defines at least one bone channel; a definition that moves nothing can never be played.',
    status: definitions.size === 0 ? 'not-measured' : motionDefinitions.length === definitions.size ? 'pass' : 'unresolved',
    detail:
      definitions.size === 0
        ? 'The pack ships no animation definition, so there is nothing to play (not measured, never passed).'
        : `${motionDefinitions.length}/${definitions.size} definition(s) carry bone channels; ${definitions.size - motionDefinitions.length} move nothing.`,
  });
  if (definitions.size > 0 && motionDefinitions.length < definitions.size) {
    for (const [clipId, entry] of definitions) {
      if (entry.bones.length === 0) errors.push(`${clipId} (${entry.path}) declares no bone channel and can never move the model`);
    }
  }

  const clipsRegistered = registry.metrics.clipsRegistered;
  const clipsActivated = registry.metrics.clipsActivated;
  const firstPersonStates = registry.metrics.firstPersonStates;
  const thirdPersonStates = registry.metrics.thirdPersonStates;
  const firstPersonClipIds = new Set(registry.metrics.firstPersonClipIds);
  const unconditionalStates = registry.metrics.unconditionalStates;
  const unresolvedIdentifiers = registry.metrics.unresolvedIdentifiers.length;
  const unresolvedControllers = [
    ...new Set([
      ...registry.metrics.unresolvedIdentifiers.filter((entry) => entry.startsWith('controller.animation.')),
      ...registry.metrics.controllersDangling,
    ]),
  ].length;
  const unactivatedRegistrations = [...registry.metrics.unactivatedClips];

  const boneTracksChecked = registry.metrics.bones.checked;
  const boneTracksUnresolved = registry.metrics.bones.unresolved.length;

  checks.push({
    id: 'bone-references',
    label: 'Bone references',
    rule: 'Every animated bone must exist on the geometry the owning client entity renders, matched by name, canonical form, limb family or token.',
    status:
      boneTracksChecked === 0
        ? 'not-measured'
        : boneTracksUnresolved > 0 || registry.metrics.bones.skeletonsUnresolved.length > 0
          ? 'unresolved'
          : input.skeleton && input.skeleton.bonesRenamed > 0
            ? 'repaired'
            : 'pass',
    detail: `${boneTracksChecked - boneTracksUnresolved}/${boneTracksChecked} final owner/clip/bone binding(s) resolve; ${boneTracksUnresolved} missing bone(s), ${registry.metrics.bones.skeletonsUnresolved.length} owner skeleton(s) unmeasured; ${input.skeleton?.bonesRenamed ?? 0} bone name(s) were changed during the separate retarget pass.`,
  });
  if (boneTracksUnresolved > 0) {
    for (const entry of registry.metrics.bones.unresolved.slice(0, 8)) {
      errors.push(`unresolved bone track — ${entry}`);
    }
  }

  const refs = input.references;
  checks.push({
    id: 'geometry-references',
    label: 'Geometry references',
    rule: 'Every geometry identifier a client entity binds and every render controller names must be declared by a shipped document (or be a vanilla rig).',
    status: refs === undefined ? 'not-measured' : refs.geometryRefsUnresolved.length > 0 ? 'unresolved' : refs.geometryRefsRepaired.length > 0 ? 'repaired' : 'pass',
    detail:
      refs === undefined
        ? 'Reference integrity was not measured.'
        : `${refs.geometriesDeclared} geometry definition(s) declared; ${refs.geometryRefsRepaired.length} binding(s) repaired, ${refs.geometryRefsUnresolved.length} unresolved.`,
  });
  for (const entry of refs?.geometryRefsUnresolved ?? []) errors.push(`unresolved geometry reference — ${entry}`);

  checks.push({
    id: 'controller-definitions',
    label: 'Controller definitions',
    rule: 'Every animation controller an entity references must be defined, and its states/transitions must resolve.',
    status:
      unresolvedControllers > 0 || registry.metrics.controllersUnregistered.length > 0 || (refs?.controllerRefsRemoved.length ?? 0) > 0
        ? 'unresolved'
        : registry.metrics.controllersDefined === 0 && !input.integration?.controllerNeed.required
          ? 'not-measured'
          : refs?.controllerStateRepairs.length
            ? 'repaired'
            : 'pass',
    detail:
      refs === undefined
        ? 'Controller definitions were not audited.'
        : `${registry.metrics.controllersDefined} final animation-controller definition(s), ${registry.metrics.controllersRegistered} entity-registered, ${registry.metrics.controllersActivated} active; ${refs.controllerStateRepairs.length} repair action(s), ${unresolvedControllers} unresolved reference(s).`,
  });
  if (unresolvedControllers > 0) errors.push(`${unresolvedControllers} controller reference(s) point at a definition that does not exist`);

  checks.push({
    id: 'entity-registrations',
    label: 'Entity registrations',
    rule: 'Every playable clip must be registered by a client entity, and every registered identifier must resolve.',
    status:
      clipsRegistered === 0
        ? 'not-measured'
        : unresolvedIdentifiers > 0 || unactivatedRegistrations.length > 0
          ? 'unresolved'
          : 'pass',
    detail:
      clipsRegistered === 0
        ? 'No client entity registers a resolvable animation, so nothing can be selected at runtime.'
        : `${clipsRegistered} unique clip id(s) selectable by an entity, ${clipsActivated} with a runtime start path across animate/controller/script, ${unactivatedRegistrations.length} with no path, ${unresolvedIdentifiers} unresolved exported references.`,
  });
  if (unresolvedIdentifiers > 0) errors.push(`${unresolvedIdentifiers} registered animation identifier(s) are defined by no document`);
  if (clipsRegistered > 0 && clipsActivated === 0) errors.push('clips are registered by a client entity but no runtime start path activates any of them');
  for (const clipId of unactivatedRegistrations.slice(0, 8)) {
    errors.push(`${clipId} is registered by a client entity but no activation path reaches it, so it can never play`);
  }

  checks.push({
    id: 'render-controllers',
    label: 'Render-controller references',
    rule: 'A client entity needs a render controller that exists, and its geometry/texture/material expressions must address keys the entity declares.',
    status:
      refs === undefined
        ? 'not-measured'
        : registry.metrics.renderControllersUnresolved.length > 0 || refs.renderControllerRefsUnresolved.length > 0
          ? 'unresolved'
          : refs.renderControllerRepairs.length > 0 || refs.renderControllersGenerated.length > 0
            ? 'repaired'
            : registry.metrics.renderControllersReferenced === 0
              ? 'not-measured'
              : 'pass',
    detail:
      refs === undefined
        ? 'Render-controller references were not audited.'
        : `${registry.metrics.renderControllersDeclared} render-controller definition(s) in the final pack; ${refs.renderControllersGenerated.length} generated by this repair pass, ${registry.metrics.renderControllersReferenced} referenced, ${registry.metrics.renderControllersUnresolved.length} unresolved.`,
  });
  for (const entry of refs?.renderControllerRefsUnresolved ?? []) errors.push(`unresolved render-controller reference — ${entry}`);

  const conflictShadowed = input.states?.shadowed.length ?? 0;
  checks.push({
    id: 'state-conflicts',
    label: 'Animation state conflicts',
    rule: 'Two clips that can be active at once must not drive the same bones; overlapping states are guarded, blended or shadowed with a diagnostic.',
    status:
      input.states === undefined
        ? 'not-measured'
        : conflictShadowed > 0
          ? 'unresolved'
          : input.states.guarded.length > 0 || input.states.duplicateRegistrations.length > 0
            ? 'repaired'
            : 'pass',
    detail:
      input.states === undefined
        ? 'No state analysis ran.'
        : `${input.states.conflicts.length} interaction(s): ${input.states.guarded.length} guarded mutually exclusive, ${input.states.blendedPairs} blended across different limbs, ${conflictShadowed} shadowed (reported, not silently played twice), ${input.states.exclusivePairs} already exclusive.`,
  });
  if (conflictShadowed > 0) {
    for (const entry of input.states?.shadowed.slice(0, 6) ?? []) warnings.push(`state shadowed — ${entry}`);
  }

  const LOWER_BODY_BONE = /leg|pants|boot|foot|shin|thigh/i;
  const firstPersonLowerBody = [...firstPersonClipIds].filter((clipId) =>
    (definitions.get(clipId)?.bones ?? []).some((bone) => LOWER_BODY_BONE.test(bone)),
  );
  const firstPersonRendererBound = (refs?.firstPersonRenderers.length ?? 0) > 0;
  checks.push({
    id: 'first-person',
    label: 'First-person wiring',
    rule: 'A clip gated on query.is_first_person only plays when the player entity binds a first-person render controller; arm and held-item positioning depends on it.',
    status:
      firstPersonStates === 0
        ? 'not-measured'
        : firstPersonRendererBound
          ? refs && refs.renderControllerRepairs.some((repair) => repair.includes('controller.render.player.first_person'))
            ? 'repaired'
            : 'pass'
          : 'unresolved',
    detail:
      firstPersonStates === 0
        ? 'No activation entry is gated on the first-person view, so first-person playback is not applicable to this port.'
        : `${firstPersonStates} first-person state(s) over ${firstPersonClipIds.size} clip(s); ${firstPersonRendererBound ? (refs?.firstPersonRenderers[0] ?? '') : 'no first-person render controller is bound to the player entity'}; ${firstPersonLowerBody.length} clip(s) also animate lower-body bones that the first-person pass never draws.`,
  });
  for (const clipId of firstPersonLowerBody.slice(0, 6)) {
    warnings.push(`${clipId} is gated to the first-person view but animates lower-body bones, which the first-person pass does not draw`);
  }
  if (firstPersonStates > 0 && !firstPersonRendererBound) {
    errors.push('first-person states exist but the player entity binds no first-person render controller');
  }

  checks.push({
    id: 'third-person',
    label: 'Third-person wiring',
    rule: 'Body clips must be gated off the first-person view so hand tracks cannot deform the third-person skeleton.',
    status: thirdPersonStates === 0 ? 'not-measured' : 'pass',
    detail:
      thirdPersonStates === 0
        ? 'No activation entry targets the third-person view.'
        : `${thirdPersonStates} third-person state(s) gated with !query.is_first_person or a state condition.`,
  });

  const danglingDependencies = [
    ...(input.integration?.controllers.danglingAnimations ?? []),
    ...(input.integration?.entities.unresolvedAnimationRefs ?? []),
  ];
  checks.push({
    id: 'dependencies',
    label: 'Animation dependencies',
    rule: 'Controllers, entities and clip sets must reference only identifiers some shipped document defines.',
    status:
      input.integration === undefined
        ? 'not-measured'
        : danglingDependencies.length > 0
          ? 'unresolved'
          : 'pass',
    detail:
      input.integration === undefined
        ? 'The integration audit did not run.'
        : `${danglingDependencies.length} dangling animation reference(s); ${input.integration.definitions.orphaned.length} clip(s) shipped but referenced by nobody.`,
  });
  for (const entry of danglingDependencies.slice(0, 8)) errors.push(`dangling animation dependency — ${entry}`);

  // The integration audit runs on the same pack. Its failure is inherited here, so the runtime
  // report can never contradict the integration report it was given.
  checks.push({
    id: 'integration',
    label: 'Animation integration audit',
    rule: 'Every converted clip must be registered on a shipped entity, activated, and drive bones its geometry declares, with no orphaned clip left behind.',
    status: input.integration === undefined ? 'not-measured' : integrationFailure ? 'unresolved' : 'pass',
    detail:
      input.integration === undefined
        ? 'The integration audit did not run, so registration and activation are not measured.'
        : `${input.integration.issues.filter((issue) => issue.severity === 'error').length} error(s), ` +
          `${input.integration.issues.filter((issue) => issue.severity === 'warning').length} warning(s); ` +
          `${input.integration.stages.extracted} extracted → ${input.integration.stages.converted} converted → ` +
          `${input.integration.stages.registered} registered → ${input.integration.stages.activated} activated → 0 playback-verified.`,
  });
  if (integrationFailure) {
    errors.push(
      `animation integration FAILED: ${input.integration?.issues
        .filter((issue) => issue.severity === 'error')
        .slice(0, 4)
        .map((issue) => `${issue.rule} (${issue.subject})`)
        .join('; ')}`,
    );
  }

  if (input.fidelity) {
    const fidelityErrors = input.fidelity.issues.filter((issue) => issue.severity === 'error');
    const sourceComparisonErrors = input.fidelity.issueCountsByScope['source-comparison'].errors;
    checks.push({
      id: 'fidelity',
      label: 'Animation audit findings',
      rule: 'Source curve comparisons and final exported binding checks are shown separately; a final-export defect is not counted as curve drift.',
      status: input.fidelity.issues.some((issue) => issue.severity === 'error') || input.fidelity.clipsMissing > 0
        ? 'unresolved'
        : input.fidelity.averageFidelity === null
          ? 'not-measured'
          : input.fidelity.averageFidelity >= 95
            ? 'pass'
            : 'repaired',
      detail: `${input.fidelity.clipsShipped}/${input.fidelity.clipsInterpreted} clip(s) shipped, average curve fidelity ${input.fidelity.averageFidelity === null ? 'not measured' : `${input.fidelity.averageFidelity}%`}, source-track retention ${input.fidelity.boneTrackCoverage}%, ${input.fidelity.issues.filter((issue) => issue.severity === 'error').length} total audit error(s) across ${sourceComparisonErrors} source-comparison finding(s), ${input.fidelity.issueCountsByScope['final-export'].errors} final-export finding(s), ${input.fidelity.clipsMissing} missing.`,
    });
    if (input.fidelity.clipsMissing > 0) {
      warnings.push(`${input.fidelity.clipsMissing} interpreted clip(s) never reached the pack`);
    }
    for (const issue of fidelityErrors) errors.push(`animation fidelity error — ${issue.subject}: ${issue.detail}`);
  }

  // Molang validity is measured per context: the same query can be legal in a mob clip and
  // unresolved in the player client entity. Every rewrite and every remaining gap is named.
  const molangReport =
    input.molang ??
    auditMolangCompatibility({ resourcePackFiles: files, behaviorPackFiles: input.behaviorPackFiles });
  checks.push({
    id: 'molang',
    label: 'Molang compatibility',
    rule: 'Every query must exist in the context its expression runs in; an unsupported query is translated into a supported equivalent or reported, never deleted.',
    status:
      molangReport.queriesScanned === 0
        ? 'not-measured'
        : molangReport.unresolved.length > 0
          ? 'unresolved'
          : molangReport.approximations.length + molangReport.unsupported.length > 0
            ? 'repaired'
            : 'pass',
    detail: molangReport.summary,
  });
  for (const entry of molangReport.unresolved.slice(0, 6)) {
    errors.push(`unsupported Molang — ${entry.file}: ${entry.query} — ${entry.reason}`);
  }

  checks.push({
    id: 'playback',
    label: 'Live playback',
    rule: 'Playback inside a Bedrock client cannot be observed by this pipeline.',
    status: 'not-measured',
    detail:
      'No check in this pipeline runs inside a Bedrock client. Everything above is measured on the exported files; in-game playback stays unverified until it is run. The activation script logs every failed registration and exposes /<namespace>:animation_test to replay each ported clip on demand.',
  });

  // ── the ten pipeline stages, each measured independently on the exported pack ──
  // A failed stage stays failed until it is genuinely repaired: no stage is upgraded because a
  // later one passed, and structural success never becomes "playback verified".
  const extractedClips = input.extractedClipIds === undefined
    ? input.extractedClips ?? input.integration?.stages.extracted ?? 0
    : new Set(input.extractedClipIds).size;
  const interpretedClips = input.interpretedClips ?? 0;
  const skeletonReport = input.skeleton;
  const skeletonMeasured = registry.metrics.bones.checked > 0 || registry.metrics.bones.skeletonsUnresolved.length > 0;
  const skeletonUnresolved = registry.metrics.bones.unresolved.length;
  const skeletonWorked =
    (skeletonReport?.bonesRenamed ?? 0) + (skeletonReport?.bonesInjected.length ?? 0) + (skeletonReport?.bonesCollapsed.length ?? 0) > 0;
  const geometryUnresolved = (refs?.geometryRefsUnresolved.length ?? 0) + (input.integration?.entities.danglingGeometryRefs.length ?? 0);
  const expectedClipSet = new Set(input.expectedClips ?? []);
  const missingExpectedDefinitions = [...expectedClipSet].filter((clipId) => !registry.clips.has(clipId));
  const expectedOrphans = registry.metrics.orphanedClips.filter((clipId) => expectedClipSet.has(clipId));
  const expectedUnactivated = [...expectedClipSet].filter(
    (clipId) => registry.clips.has(clipId) && !registry.metrics.activatedClipIds.includes(clipId),
  );
  const unregisteredControllers = input.integration?.controllers.unregistered.length ?? 0;

  const pipelineStages: AnimationPipelineStage[] = [
    {
      index: 1,
      id: 'source-discovery',
      label: 'Source discovery',
      status: extractedClips > 0 ? 'pass' : 'not-measured',
      detail:
        extractedClips > 0
          ? `${extractedClips} clip(s) recovered from the archive's own animation resources.`
          : 'The archive exposed no animation resource, so no source clip existed to port.',
    },
    {
      index: 2,
      id: 'interpretation',
      label: 'Animation interpretation',
      status: interpretedClips > 0 ? 'pass' : extractedClips > 0 ? 'unresolved' : 'not-measured',
      detail:
        interpretedClips > 0
          ? `${interpretedClips} clip(s) normalised into the intermediate representation (timelines, bone transforms, interpolation).`
          : extractedClips > 0
            ? `${extractedClips} discovered clip(s) produced no interpreted representation, so none of them can be translated.`
            : 'Nothing was interpreted because nothing was discovered.',
    },
    {
      index: 3,
      id: 'conversion',
      label: 'Animation conversion',
      status:
        definitions.size === 0
          ? 'not-measured'
          : missingExpectedDefinitions.length > 0
            ? 'unresolved'
            : 'pass',
      detail: `${definitions.size} unique animation id(s) are declared in final shipped documents; ${expectedClipSet.size - missingExpectedDefinitions.length}/${expectedClipSet.size} expected source id(s) resolve in that same export; ${definitions.size - motionDefinitions.length} definitions carry no bone tracks.`,
    },
    {
      index: 4,
      id: 'skeleton',
      label: 'Skeleton compatibility',
      status: !skeletonMeasured
        ? 'not-measured'
        : skeletonUnresolved > 0 || registry.metrics.bones.skeletonsUnresolved.length > 0
          ? 'unresolved'
          : skeletonWorked
            ? 'repaired'
            : 'pass',
      detail: !skeletonMeasured
        ? 'No final owner/clip/bone binding was available, so skeleton compatibility is not measured.'
        : `${boneTracksChecked - boneTracksUnresolved}/${boneTracksChecked} final owner/clip/bone bindings resolve; ${skeletonReport?.bonesRenamed ?? 0} names were changed and ${(skeletonReport?.bonesInjected.length ?? 0) + (skeletonReport?.bonesCollapsed.length ?? 0)} nodes were adjusted during the separate retarget pass.`,
    },
    {
      index: 5,
      id: 'geometry',
      label: 'Geometry compatibility',
      status:
        refs === undefined
          ? 'not-measured'
          : geometryUnresolved > 0
            ? 'unresolved'
            : refs.geometryRefsRepaired.length > 0 || refs.geometryOwnershipRepaired.length > 0
              ? 'repaired'
              : 'pass',
      detail:
        refs === undefined
          ? 'Geometry bindings were not audited.'
          : `${geometryUnresolved} unresolved geometry reference(s); ${refs.geometryRefsRepaired.length} rebound, ${refs.geometryOwnershipRepaired.length} unused model(s) bound to an owner, ${refs.orphanGeometries.length} still unbound.`,
    },
    {
      index: 6,
      id: 'registration',
      label: 'Resource registration',
      status:
        definitions.size === 0
          ? 'not-measured'
          : clipsRegistered === 0 || registry.metrics.orphanedClips.length > 0 || expectedOrphans.length > 0
            ? 'unresolved'
            : 'pass',
    detail:
      definitions.size === 0
        ? 'No final animation definition exists to register.'
        : `${clipsRegistered}/${definitions.size} unique final clip id(s) are selectable by an entity; ${registry.metrics.orphanedClips.length} definitions are selectable by nobody; ${expectedOrphans.length} expected source clip(s) are orphaned.`,
    },
    {
      index: 7,
      id: 'controller-registration',
      label: 'Controller registration',
    status:
      registry.metrics.controllersDefined === 0 && !input.integration?.controllerNeed.required
        ? 'not-measured'
        : unregisteredControllers > 0 || (refs?.controllerRefsRemoved.length ?? 0) > 0 || unresolvedControllers > 0
          ? 'unresolved'
          : 'pass',
    detail: `${registry.metrics.controllersDefined} final animation-controller definition(s), ${registry.metrics.controllersRegistered} registered, ${registry.metrics.controllersActivated} activated, ${unregisteredControllers} unregistered; ${registry.metrics.controllersDangling.length} dangling state references.`,
    },
    {
      index: 8,
      id: 'activation',
      label: 'Runtime activation',
    status:
      clipsRegistered === 0
        ? 'not-measured'
        : unactivatedRegistrations.length > 0 || expectedUnactivated.length > 0 || clipsActivated === 0 ||
          input.integration?.issues.some((issue) => issue.rule === 'script-activation-missing')
          ? 'unresolved'
          : 'pass',
    detail:
      clipsRegistered === 0
        ? 'No registered final clip exists, so activation is not measured.'
        : `${clipsActivated}/${clipsRegistered} unique registered clip id(s) have a runtime start path — ${registry.metrics.clipsActivatedByAnimate} animate, ${registry.metrics.clipsActivatedByController} controller, ${registry.metrics.clipsActivatedByScript} verified script call(s); ${unactivatedRegistrations.length} have no path, ${expectedUnactivated.length} expected id(s) lack a path. A script path may be event-driven rather than continuously evaluated.`,
    },
    {
      index: 9,
      id: 'rendering',
      label: 'Rendering integration',
      status:
        refs === undefined
          ? 'not-measured'
          : integrationFailure || (input.integration?.entities.danglingGeometryRefs.length ?? 0) > 0
            ? 'unresolved'
            : 'pass',
      detail: `${refs?.entitiesAudited ?? 0} client entit(ies) audited; ${refs?.renderControllersDeclared ?? 0} render controller(s) declared, ${refs?.renderControllersGenerated.length ?? 0} generated; ${firstPersonStates} first-person and ${thirdPersonStates} third-person state(s).`,
    },
    {
      index: 10,
      id: 'playback',
      label: 'Playback verification',
      status: 'not-verified',
      detail:
        'Nothing in this pipeline runs inside a Bedrock client. Every stage above is measured on the exported files; actual playback stays unverified until it is observed in game or an equivalent live runtime.',
    },
  ];

  // ── ten compatibility dimensions, measured side by side ──────────────────────────────
  // No figure below is averaged with another. A port can hold 100% curve fidelity and 0%
  // activation validity at the same time, and reporting one "compatibility" number for both is
  // exactly the misleading claim this pipeline exists to prevent.
  const scoreStatusFrom = (id: string): AnimationCompatibilityScore['status'] => {
    const check = checks.find((entry) => entry.id === id);
    if (!check) return 'not-measured';
    if (check.status === 'pass') return 'pass';
    if (check.status === 'repaired') return 'partial';
    if (check.status === 'unresolved') return 'fail';
    return 'not-measured';
  };
  const percentOf = (part: number, total: number): number | null =>
    total > 0 ? Math.round((part / total) * 100) : null;
  const gradedStatus = (percent: number | null): AnimationCompatibilityScore['status'] => {
    if (percent === null) return 'not-measured';
    if (percent >= 95) return 'pass';
    return percent >= 70 ? 'partial' : 'fail';
  };
  const boneAudit = registry.metrics.bones;
  const molangClean =
    molangReport.queriesScanned -
    molangReport.approximations.length -
    molangReport.unsupported.length -
    molangReport.unresolved.length;
  const scores: AnimationCompatibilityScore[] = [
    {
      id: 'curve-fidelity',
      label: 'Animation curve fidelity',
      percent: input.fidelity?.averageFidelity ?? null,
      basis: 'sampled agreement between the interpreted source curves and the shipped clips',
      status: input.fidelity === undefined
        ? 'not-measured'
        : input.fidelity.issueCountsByScope['source-comparison'].errors > 0 || input.fidelity.clipsMissing > 0
          ? 'fail'
          : gradedStatus(input.fidelity.averageFidelity),
      detail: input.fidelity
        ? `${input.fidelity.clipsShipped}/${input.fidelity.clipsInterpreted} interpreted clip(s) shipped, ${input.fidelity.averageFidelity === null ? 'curve agreement not measured' : `${input.fidelity.averageFidelity}% curve agreement`}, ${input.fidelity.issueCountsByScope['source-comparison'].errors} source-comparison error(s); final-export findings are scored separately.`
        : 'No curve comparison ran, so curve preservation is not measured.',
    },
    {
      id: 'skeleton-fidelity',
      label: 'Skeleton compatibility',
      percent: percentOf(boneAudit.resolved, boneAudit.checked),
      basis: 'shipped bone tracks that reach a bone the owning entity actually renders',
      status: scoreStatusFrom('bone-references'),
      detail: `${boneAudit.resolved}/${boneAudit.checked} track(s) resolve; ${boneAudit.skeletonsUnresolved.length} entity skeleton(s) could not be resolved at all.`,
    },
    {
      id: 'retarget-fidelity',
      label: 'Bone retarget fidelity',
      percent: input.skeleton?.retargetFidelityPct ?? null,
      basis: 'tracks that reached an anatomically exact counterpart (same region, joint and side)',
      status:
        input.skeleton === undefined
          ? 'not-measured'
          : input.skeleton.crossRegionRefused.length > 0
            ? 'fail'
            : gradedStatus(input.skeleton.retargetFidelityPct),
      detail: input.skeleton
        ? `${input.skeleton.approximations.length} same-region approximation(s) carrying ${input.skeleton.poseErrorPct}% mean anatomical cost, ${input.skeleton.auxiliary.length} control node(s) withheld, ${input.skeleton.crossRegionRefused.length} cross-region mapping(s) refused. This is not the same number as skeleton compatibility above.`
        : 'No retargeting ran, so bone-level fidelity is not measured.',
    },
    {
      id: 'registration',
      label: 'Animation registration',
      percent: percentOf(clipsRegistered, definitions.size),
      basis: 'shipped clip definitions a client entity can select',
      status: scoreStatusFrom('entity-registrations'),
      detail: `${clipsRegistered}/${definitions.size} definition(s) registered; ${registry.metrics.orphanedClips.length} defined clip(s) selectable by nobody.`,
    },
    {
      id: 'activation-validity',
      label: 'Activation validity',
      percent: percentOf(clipsActivated, clipsRegistered),
      basis: 'registered clips with any structurally evidenced start path; behaviour-script paths may be event-driven',
      status:
        clipsRegistered === 0
          ? 'not-measured'
          : expectedUnactivated.length > 0 || unactivatedRegistrations.length > 0
            ? clipsActivated === 0 || expectedUnactivated.length > 0
              ? 'fail'
              : 'partial'
            : 'pass',
      detail: `${clipsActivated}/${clipsRegistered} registered clip(s) reachable — ${registry.metrics.clipsActivatedByAnimate} scripts.animate, ${registry.metrics.clipsActivatedByController} activated controller state(s), ${registry.metrics.clipsActivatedByScript} script call(s); ${unactivatedRegistrations.length} have no path; ${registry.metrics.controllersDangling.length} controller state(s) select a clip that does not exist.`,
    },
    {
      id: 'molang-compatibility',
      label: 'Molang compatibility',
      percent: percentOf(molangClean, molangReport.queriesScanned),
      basis: 'query references that are valid, unchanged, in the context they run in',
      status:
        molangReport.queriesScanned === 0
          ? 'not-measured'
          : molangReport.unresolved.length > 0
            ? 'fail'
            : molangReport.approximations.length + molangReport.unsupported.length > 0
              ? 'partial'
              : 'pass',
      detail: `${molangReport.queriesScanned} query reference(s): ${molangReport.approximations.length} translated to a supported proxy, ${molangReport.unsupported.length} preserved as a script-driven variable, ${molangReport.unresolved.length} with no destination equivalent.`,
    },
    {
      id: 'rendering-integration',
      label: 'Rendering compatibility',
      percent: percentOf(
        registry.metrics.renderControllersReferenced - registry.metrics.renderControllersUnresolved.length,
        registry.metrics.renderControllersReferenced,
      ),
      basis: 'render-controller references that resolve to a shipped or engine-provided controller',
      status: scoreStatusFrom('render-controllers'),
      detail: `${registry.metrics.renderControllersDefinedInPack} render controller(s) shipped, ${registry.metrics.renderControllersEngineProvided.length} engine-provided, ${registry.metrics.renderControllersUnresolved.length} unresolved; ${refs?.geometryRefsUnresolved.length ?? 0} geometry reference(s) unresolved.`,
    },
    {
      id: 'first-person',
      label: 'First-person compatibility',
      percent: null,
      basis: 'first-person activation states bound to a first-person render controller',
      status: scoreStatusFrom('first-person'),
      detail: checks.find((entry) => entry.id === 'first-person')?.detail ?? 'Not measured.',
    },
    {
      id: 'third-person',
      label: 'Third-person compatibility',
      percent: null,
      basis: 'body clips gated off the first-person view',
      status: scoreStatusFrom('third-person'),
      detail: checks.find((entry) => entry.id === 'third-person')?.detail ?? 'Not measured.',
    },
    {
      id: 'playback',
      label: 'Actual playback',
      percent: null,
      basis: 'observed animation playback inside a Bedrock client',
      status: 'not-verified',
      detail: 'No check in this pipeline runs inside a Bedrock client, so playback stays unverified regardless of every figure above.',
    },
  ];

  const unresolvedChecks = checks.filter((check) => check.status === 'unresolved');
  const failedStages = pipelineStages.filter((stage) => stage.status === 'unresolved');
  const report: AnimationRuntimeReport = {
    checks,
    passed: unresolvedChecks.length === 0 && failedStages.length === 0 && !integrationFailure,
    pipelineStages,
    errors,
    warnings,
    counts: {
      definitions: registry.metrics.clipsDefined,
      definitionsWithMotion: registry.metrics.clipsWithMotion,
      clipsRegistered,
      clipsActivated,
      boneTracksChecked,
      boneTracksUnresolved,
      controllersDefined: registry.metrics.controllersDefined,
      controllersActivated: registry.metrics.controllersActivated,
      firstPersonStates,
      thirdPersonStates,
      unconditionalStates,
    },
    exportedMetrics: registry.metrics,
    skeleton: input.skeleton,
    states: input.states,
    references: input.references,
    integration: input.integration,
    fidelity: input.fidelity,
    scores,
    molang: molangReport,
    playbackVerified: 0,
    summary: '',
  };

  report.summary =
    `Animation runtime validation: ${report.passed ? 'PASS' : 'FAIL'} — ${checks.length - unresolvedChecks.length}/${checks.length} check(s) clean, ` +
    `${unresolvedChecks.length} unresolved${unresolvedChecks.length > 0 ? ` (${unresolvedChecks.map((check) => check.id).join(', ')})` : ''}; ` +
    `${definitions.size} definition(s), ${clipsRegistered} registered identifier(s), ${clipsActivated} activated, ` +
    `${boneTracksChecked - boneTracksUnresolved}/${boneTracksChecked} bone binding(s) resolved, ${registry.metrics.controllersDefined} animation-controller definition(s), ` +
    `${firstPersonStates} first-person and ${thirdPersonStates} third-person state(s). ` +
    `Pipeline stages: ${pipelineStages.map((stage) => `${stage.index}.${stage.id}=${stage.status}`).join(' · ')}. ` +
    `Compatibility is reported as ${scores.length} separate dimension(s) (${scores.map((score) => `${score.id}=${score.status}`).join(', ')}); no combined percentage is produced. ` +
    'Playback in a live client: NOT VERIFIED.';
  log(`[ANIM:RUNTIME:${report.passed ? 'PASS' : 'FAIL'}] ${report.summary}`);
  // Every figure above is printed together with the population it measures, so two numbers that
  // describe different scopes can never be read as a contradiction again.
  for (const line of describeRegistryScopes(registry.metrics)) {
    log(`[ANIM:SCOPE] ${line}`);
  }
  // The ten dimensions are logged one per line: a reader must never have to guess whether a
  // percentage describes curve agreement, bone mapping, activation or playback.
  for (const score of scores) {
    const value = score.percent === null ? 'not measured' : `${score.percent}%`;
    log(`[ANIM:SCORE] ${score.label}: ${value} (${score.status}) — ${score.basis}. ${score.detail}`);
  }
  for (const check of checks) {
    if (check.status === 'pass') continue;
    log(`[ANIM:RUNTIME:${check.status.toUpperCase()}] ${check.label} — ${check.detail}`);
  }
  for (const error of errors.slice(0, 10)) log(`[ANIM:RUNTIME:ERROR] ${error}`);
  // Pipeline stages are logged separately from the checks: each stage is a distinct claim, and a
  // failed one stays visible even when a later stage passed.
  for (const stage of pipelineStages) {
    if (stage.status === 'pass') continue;
    log(`[ANIM:PIPELINE:${stage.status.toUpperCase()}] ${stage.index}. ${stage.label} — ${stage.detail}`);
  }
  return report;
}