import {
  buildAnimationResourceRegistry,
  assertAnimationResourceRegistryCurrent,
  describeRegistryScopes,
  type AnimationRegistryMetrics,
  type AnimationResourceRegistry,
} from '@/utils/animationResourceRegistry';
import type { AnimationStateReport } from '@/utils/animationStateResolver';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';

/**
 * Mandatory animation integration validation.
 *
 * Extraction, conversion, registration, activation and playback are five different facts. A pack
 * can hold perfectly valid animation JSON and still play nothing because no entity registers the
 * clip, because the controller that selects it is never activated, or because the clip moves a
 * bone the bound geometry does not declare. This stage measures each of those facts separately
 * on the exact pack that ships, and reports every gap as a named defect.
 *
 * `playbackVerified` deliberately stays 0: nothing here runs inside a Bedrock client, so a green
 * report means "wired, not watched".
 */

export interface AnimationIntegrationIssue {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  subject: string;
  detail: string;
}

export interface AnimationIntegrationStages {
  /** Source clips the import/discovery stage recovered. */
  extracted: number;
  /** Clips that shipped as Bedrock animation definitions. */
  converted: number;
  /** Converted clips referenced by a client entity definition. */
  registered: number;
  /** Registered clips with a runtime start path through animate, a reachable controller, or script. */
  activated: number;
  /** Registered clips reachable through a `scripts.animate` condition. */
  activatedByAnimate: number;
  /** Registered clips selected by a state of an ACTIVATED animation controller. */
  activatedByController: number;
  /** Registered clips a shipped behaviour script plays. */
  activatedByScript: number;
  /** Registered clips no path reaches — the silent "registered but never plays" population. */
  registeredNoActivation: number;
  /** Activated clips whose bone tracks resolve against the bound geometry. */
  resolvable: number;
  /** Always 0: no live client ran. */
  playbackVerified: number;
}

export interface AnimationIntegrationReport {
  passed: boolean;
  stages: AnimationIntegrationStages;
  definitions: { files: number; clips: number; orphaned: string[] };
  controllers: {
    files: number;
    defined: number;
    registered: number;
    unregistered: string[];
    danglingAnimations: string[];
  };
  entities: {
    clientEntities: number;
    withAnimations: number;
    withAnimate: number;
    unregisteredAnimateKeys: string[];
    unresolvedAnimationRefs: string[];
    danglingGeometryRefs: string[];
  };
  bones: { checked: number; unresolved: string[]; geometries: number };
  triggers: {
    conditional: number;
    unconditional: number;
    /** Source-evidenced clips requested for behaviour-script dispatch. */
    scriptDriven: number;
    /** Such clips with a matching play call found in the final behaviour pack. */
    scriptActivated: number;
    firstPerson: number;
    thirdPerson: number;
  };
  /** Render-controller population by scope: referenced, shipped here, engine-provided, broken. */
  renderControllers: {
    /** Definitions in the final resource pack, independent of whether an entity uses them. */
    declared: number;
    referenced: number;
    definedInPack: number;
    engineProvided: string[];
    unresolved: string[];
  };
  /**
   * Whether this clip set needs an animation controller, and why. A controller is required when two
   * active states cannot be separated by a Molang condition; when they can, independent gating is
   * the destination-native mechanism and a controller would be invented machinery.
   */
  controllerNeed: {
    required: boolean;
    reason: string;
    independentActivation: number;
    controllerDriven: number;
  };
  /** One line per figure, stating the population it measures. */
  metricScopes: string[];
  /** Every animation figure from the exported-resource registry this report was built from. */
  metrics: AnimationRegistryMetrics;
  issues: AnimationIntegrationIssue[];
  summary: string;
}

const VANILLA_ANIMATION = { test: isKnownVanillaPlayerAnimationReference };
const VANILLA_GEOMETRY = /^geometry\.(humanoid|cape|armor_stand|player)\b/i;
const VANILLA_RENDER_CONTROLLER = /^controller\.render\.(player|default|common|humanoid|armor_stand)\b/i;









export function auditAnimationIntegration(options: {
  modId: string;
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles: Record<string, string | Uint8Array>;
  /** Clips the pipeline intended to make playable; an orphan in this set is a hard error. */
  expectedClips?: string[];
  extractedClipCount?: number;
  /** Unique source animation IDs recovered across discovery, interpretation and layout importers. */
  extractedClipIds?: string[];
  scriptDrivenClips?: string[];
  /** Registry built from the exported pack; every count is read from it so no two stages disagree. */
  registry?: AnimationResourceRegistry;
  /** State-conflict analysis, so the report can say WHY zero controllers exist instead of assuming zero is fine. */
  states?: AnimationStateReport;
}): AnimationIntegrationReport {
  const { resourcePackFiles, behaviorPackFiles } = options;
  const registry =
    options.registry ?? buildAnimationResourceRegistry({
      resourcePackFiles,
      behaviorPackFiles,
      scriptDrivenClips: options.scriptDrivenClips,
    });
  assertAnimationResourceRegistryCurrent(registry, { resourcePackFiles, behaviorPackFiles });
  const definitionFiles = registry.metrics.animationDefinitionFiles;
  const clips = Object.fromEntries(
    [...registry.clips.entries()].map(([clipId, clip]) => [clipId, { bones: clip.bones, path: clip.path }]),
  );
  const controllerFiles = registry.metrics.animationControllerDefinitionFiles;
  const controllers = Object.fromEntries(
    [...registry.controllers.entries()].map(([controllerId, controller]) => [
      controllerId,
      { animations: controller.clips, path: controller.path },
    ]),
  );
  const geometries = Object.fromEntries(registry.geometries.entries());
  const entities = registry.entities;
  const expected = new Set(options.expectedClips ?? []);

  const issues: AnimationIntegrationIssue[] = [];
  const boneUnresolved: string[] = [];
  const conditional = registry.metrics.conditionalStates;
  const unregisteredAnimateKeys: string[] = [];
  const unresolvedAnimationRefs: string[] = [];
  const danglingGeometryRefs: string[] = [];

  for (const { id, definitions } of registry.metrics.duplicateAnimationIds) {
    issues.push({
      severity: 'error',
      rule: 'duplicate-animation-id',
      subject: id,
      detail: `${definitions} final animation documents declare this identifier; counts use its unique id once, while the duplicate source definitions are a schema defect.`,
    });
  }

  for (const entity of entities) {
    const isPlayer = entity.identifier === 'minecraft:player';
    for (const geometryId of entity.geometryIds) {
      if (!geometries[geometryId] && !VANILLA_GEOMETRY.test(geometryId) && !isPlayer) {
        danglingGeometryRefs.push(`${entity.path}: ${geometryId}`);
      }
    }
    for (const controllerId of entity.renderControllers) {
      if (!VANILLA_RENDER_CONTROLLER.test(controllerId) && !registry.renderControllers.has(controllerId)) {
        danglingGeometryRefs.push(`${entity.path}: render controller ${controllerId}`);
      }
    }

    // Activation: only keys named in scripts.animate can run.
    const animateKeys = new Set<string>();
    for (const entry of entity.animateEntries) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        continue;
      }
      if (entry && typeof entry === 'object') {
        for (const key of Object.keys(entry as Record<string, unknown>)) animateKeys.add(key);
      }
    }
    for (const key of animateKeys) {
      const target = entity.animations[key];
      if (!target) {
        unregisteredAnimateKeys.push(`${entity.path}: "${key}"`);
        continue;
      }
    }


    for (const [key, clipId] of Object.entries(entity.animations)) {
      if (clipId.startsWith('controller.animation.')) continue;
      if (clipId.startsWith('controller.')) continue;
      if (!clipId.startsWith('animation.')) continue;
      if (VANILLA_ANIMATION.test(clipId)) continue;
      const clip = clips[clipId];
      if (!clip) {
        unresolvedAnimationRefs.push(`${entity.path}: ${key} -> ${clipId}`);
        continue;
      }
      if (clip.bones.length === 0) {
        issues.push({
          severity: 'error',
          rule: 'animation-moves-nothing',
          subject: clipId,
          detail: `${entity.path} registers this clip but it declares no bone channel, so it can never move the model.`,
        });
        continue;
      }
      // Bone resolution is not re-measured here: the registry resolves every track against the
      // skeleton its owning entity really renders, and every auditor reads that one result.
    }
  }

  // Bone resolution comes from the exported-resource registry ... one measurement, one number.
  boneUnresolved.push(...registry.metrics.bones.unresolved);

  // Controllers: defined → named by an entity → reachable from scripts.animate.
  const unregisteredControllers = registry.metrics.controllersUnregistered;
  if (unregisteredControllers.length > 0) {
    issues.push({
      severity: 'error',
      rule: 'controller-never-registered',
      subject: `${unregisteredControllers.length} controller(s)`,
      detail: `Defined but no client entity names them, so they can never run: ${unregisteredControllers.slice(0, 6).join(', ')}${unregisteredControllers.length > 6 ? ' …' : ''}.`,
    });
  }
  const danglingControllerAnimations: string[] = [];
  for (const [controllerId, controller] of Object.entries(controllers)) {
    for (const animationId of controller.animations) {
      if (!animationId.startsWith('animation.')) continue;
      if (VANILLA_ANIMATION.test(animationId) || clips[animationId]) continue;
      danglingControllerAnimations.push(`${controllerId} -> ${animationId}`);
    }
  }
  if (danglingControllerAnimations.length > 0) {
    issues.push({
      severity: 'warning',
      rule: 'controller-dangling-animation',
      subject: `${danglingControllerAnimations.length} state animation(s)`,
      detail: `A controller state selects an animation the pack does not define; that state plays nothing: ${danglingControllerAnimations.slice(0, 5).join(', ')}.`,
    });
  }

  const orphaned = registry.metrics.orphanedClips;
  for (const clipId of orphaned) {
    const hard = expected.has(clipId);
    issues.push({
      severity: 'error',
      rule: hard ? 'expected-clip-orphaned' : 'clip-orphaned',
      subject: clipId,
      detail: hard
        ? 'This source clip was selected for playback but no client entity or controller references it; it can never play.'
        : `The clip ships in ${clips[clipId].path} but nothing references it (standalone clip set, reported not invented).`,
    });
  }
  if (unregisteredAnimateKeys.length > 0) {
    issues.push({
      severity: 'error',
      rule: 'animate-entry-unregistered',
      subject: `${unregisteredAnimateKeys.length} animate entry(ies)`,
      detail: `A scripts.animate entry names a key the entity's animations map does not declare, so it is silently ignored: ${unregisteredAnimateKeys.slice(0, 5).join(', ')}.`,
    });
  }
  if (unresolvedAnimationRefs.length > 0) {
    issues.push({
      severity: 'error',
      rule: 'animation-identifier-unresolved',
      subject: `${unresolvedAnimationRefs.length} reference(s)`,
      detail: `An entity registers an animation identifier no document defines: ${unresolvedAnimationRefs.slice(0, 5).join(', ')}.`,
    });
  }
  if (boneUnresolved.length > 0) {
    issues.push({
      severity: 'error',
      rule: 'bone-not-in-geometry',
      subject: `${boneUnresolved.length} bone track(s)`,
      detail: `These tracks animate bones the bound geometry does not declare, so the affected limb does not move: ${boneUnresolved.slice(0, 6).join(', ')}.`,
    });
  }
  if (danglingGeometryRefs.length > 0) {
    issues.push({
      severity: 'error',
      rule: 'entity-reference-unresolved',
      subject: `${danglingGeometryRefs.length} entity reference(s)`,
      detail: `Client entity geometry/render-controller references that resolve to nothing: ${danglingGeometryRefs.slice(0, 5).join(', ')}.`,
    });
  }

  const scriptActivated = new Set(registry.metrics.scriptActivatedClipIds);
  const declaredScripted = [...new Set(options.scriptDrivenClips ?? [])];
  const scriptDriven = declaredScripted.filter((clipId) => scriptActivated.has(clipId)).length;
  if (declaredScripted.length > scriptDriven) {
    issues.push({
      severity: 'error',
      rule: 'script-activation-missing',
      subject: `${declaredScripted.length - scriptDriven} clip(s)`,
      detail: 'These source-evidenced clips need a behaviour-script play call, but no matching call resolves in the final behaviour pack. Text mentions and playback self-tests do not count as automatic activation.',
    });
  }

  // ── ONE measurement, three activation paths ───────────────────────────────────────────────
  // The registry counts activation through every path the engine evaluates: a scripts.animate
  // condition, a state of an ACTIVATED animation controller, and a shipped behaviour-script call.
  // The local scan above recognises only the first, which is exactly why this report could say
  // "27 registered but 17 with no activation path" about one archive.
  const registryActivated = new Set(registry.metrics.activatedClipIds);
  const resolvable = [...registryActivated].filter((clipId) => {
    const clip = registry.clips.get(clipId);
    return Boolean(clip && clip.bones.length > 0 && !(registry.metrics.bones.missingByClip[clipId]?.length));
  }).length;
  const extracted = options.extractedClipIds === undefined
    ? options.extractedClipCount ?? 0
    : new Set(options.extractedClipIds).size;
  const stages: AnimationIntegrationStages = {
    extracted,
    converted: registry.metrics.clipsDefined,
    registered: registry.metrics.clipsRegistered,
    activated: registry.metrics.clipsActivated,
    activatedByAnimate: registry.metrics.clipsActivatedByAnimate,
    activatedByController: registry.metrics.clipsActivatedByController,
    activatedByScript: registry.metrics.clipsActivatedByScript,
    registeredNoActivation: registry.metrics.unactivatedClips.length,
    resolvable,
    playbackVerified: 0,
  };
  for (const clipId of registry.metrics.unactivatedClips) {
    issues.push({
      severity: 'error',
      rule: 'registered-not-activated',
      subject: clipId,
      detail: 'The final client entity can select this defined clip, but no animate entry, reachable active controller state, or verified script play call can start it.',
    });
  }
  for (const clipId of expected) {
    if (!registry.clips.has(clipId)) {
      issues.push({
        severity: 'error',
        rule: 'expected-clip-missing',
        subject: clipId,
        detail: 'The animation pipeline expected this source clip, but no animation definition for it exists in the final exported resource pack.',
      });
      continue;
    }
    if (!registry.metrics.registeredClipIds.includes(clipId) && !registry.metrics.orphanedClips.includes(clipId)) {
      issues.push({
        severity: 'error',
        rule: 'expected-clip-unregistered',
        subject: clipId,
        detail: 'The expected source clip has a final definition but no client entity can select it.',
      });
      continue;
    }
    if (!registry.metrics.activatedClipIds.includes(clipId) && !registry.metrics.unactivatedClips.includes(clipId)) {
      issues.push({
        severity: 'error',
        rule: 'expected-clip-not-activated',
        subject: clipId,
        detail: 'This expected source clip was deliberately withheld from automatic activation, so it cannot be counted as a successful playable conversion.',
      });
    }
  }

  // ── is a controller actually required? ─────────────────────────────────────────────────────
  // "0 controllers defined" was printed next to "two states share a condition" without any
  // explanation. A controller exists to own mutually exclusive poses; when the state resolver could
  // separate them with a Molang guard, no controller is needed and inventing one would play the
  // same clips twice. When it could not, the missing controller is an error, not a zero.
  const controllerConflictPairs = (options.states?.conflicts ?? []).filter(
    (conflict) => conflict.resolution === 'controller',
  ).length;
  const guardedPairs = options.states?.guarded.length ?? 0;
  const controllersActivated = registry.metrics.controllersActivated;
  const controllerNeed = {
    required: controllerConflictPairs > 0,
    reason:
      controllerConflictPairs > 0
        ? `${controllerConflictPairs} pair(s) of active states cannot be separated by a Molang condition, so only an animation controller can keep exactly one of them owning the pose; ${controllersActivated} controller(s) are activated.`
        : `No state pair needs a controller: ${guardedPairs} overlapping state(s) were separated by a generated Molang guard, which keeps them mutually exclusive without an extra state machine. ${registry.metrics.controllersDefined} controller definition(s) exist (${controllersActivated} activated, ${registry.metrics.controllersUnregistered.length} unregistered).`,
    independentActivation: registry.metrics.clipsActivatedByAnimate,
    controllerDriven: registry.metrics.clipsActivatedByController,
  };
  if (controllerNeed.required && controllersActivated === 0) {
    issues.push({
      severity: 'error',
      rule: 'controller-required-missing',
      subject: `${controllerConflictPairs} inseparable state pair(s)`,
      detail:
        'These states cannot be separated by a Molang condition and no activated animation controller selects them, so both poses play at once. A controller definition must be generated, registered and activated for them.',
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const metricScopes = [
    `source discovery: ${stages.extracted} unique source animation id(s) recovered across discovery, interpretation and layout importers; this is input evidence, not an export total.`,
    ...describeRegistryScopes(registry.metrics),
    `controller requirement: ${controllerNeed.reason}`,
    'Pipeline writer counts and retarget-pass candidates are diagnostic-only; final definition, registration, activation and bone totals below come from the exported-resource registry.',
    'playback: 0 verified — no live Bedrock client was run.',
  ];
  const summary =
    `Final-pack animation integration: ${stages.extracted} source clips recovered → ${stages.converted} unique definitions shipped → ` +
    `${stages.registered} selectable by client entities → ${stages.activated} with a runtime start path ` +
    `(${stages.activatedByAnimate} animate / ${stages.activatedByController} controller / ${stages.activatedByScript} script; ` +
    `${stages.registeredNoActivation} have no path); playback verified 0 (no live client). ` +
    `${registry.metrics.controllersDefined} animation controllers defined (${controllersActivated} active); ` +
    `${registry.metrics.renderControllersDeclared} render controller definitions shipped, ${registry.metrics.renderControllersReferenced} referenced, ` +
    `${registry.metrics.renderControllersUnresolved.length} unresolved; ${registry.metrics.clientEntities} client entities; ` +
    `${registry.metrics.bones.resolved}/${registry.metrics.bones.checked} owner/clip/bone bindings resolved; ${errors} error(s), ${warnings} warning(s).`;

  return {
    passed: errors === 0,
    stages,
    definitions: { files: definitionFiles, clips: registry.metrics.clipsDefined, orphaned },
    controllers: {
      files: controllerFiles,
      defined: registry.metrics.controllersDefined,
      registered: registry.metrics.controllersRegistered,
      unregistered: registry.metrics.controllersUnregistered,
      danglingAnimations: danglingControllerAnimations,
    },
    entities: {
      clientEntities: registry.metrics.clientEntities,
      withAnimations: registry.metrics.clientEntitiesWithAnimations,
      withAnimate: registry.metrics.clientEntitiesWithAnimate,
      unregisteredAnimateKeys,
      unresolvedAnimationRefs,
      danglingGeometryRefs,
    },
    bones: {
      checked: registry.metrics.bones.checked,
      unresolved: registry.metrics.bones.unresolved,
      geometries: registry.geometries.size,
    },
    triggers: {
      conditional: conditional,
      unconditional: registry.metrics.unconditionalStates,
      scriptDriven: declaredScripted.length,
      scriptActivated: scriptDriven,
      firstPerson: registry.metrics.firstPersonStates,
      thirdPerson: registry.metrics.thirdPersonStates,
    },
    renderControllers: {
      declared: registry.metrics.renderControllersDeclared,
      referenced: registry.metrics.renderControllersReferenced,
      definedInPack: registry.metrics.renderControllersDefinedInPack,
      engineProvided: registry.metrics.renderControllersEngineProvided,
      unresolved: registry.metrics.renderControllersUnresolved,
    },
    controllerNeed,
    metricScopes,
    metrics: registry.metrics,
    issues,
    summary,
  };
}