import { safeFileId } from '@/utils/bedrockIds';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { PlayerClipTrigger } from '@/utils/playerAnimationTriggers';
import { translateMolangExpression } from '@/utils/molangCompatibility';
import {
  VANILLA_PLAYER_ANIMATE as PLAYER_BASELINE_ANIMATE,
  VANILLA_PLAYER_ANIMATIONS as PLAYER_BASELINE_ANIMATIONS,
  VANILLA_PLAYER_GEOMETRY_IDS,
} from '@/utils/vanillaPlayerBaseline';
import { ARMOR_LAYER_VISIBILITY_MAP } from '@/utils/molangScopeBinder';

/**
 * Player client-entity wiring for Java player-animation mods.
 *
 * A Bedrock pack that overrides `entity/player.entity.json` REPLACES the whole vanilla file,
 * so a port that ships player clips but no entity file plays nothing: the clips exist in the
 * pack and nothing references them. This module builds that file from the full vanilla base
 * (materials, texture, geometry, render controllers, root controller) and then registers the
 * ported clips and controllers on top of it.
 *
 * Registration is not activation. Every ported clip therefore gets a `scripts.animate` entry —
 * either the condition translated from its Java trigger, the structurally inferred state, or an
 * unconditional entry that is explicitly reported — plus view gating so a first-person hand
 * track can never deform the third-person body and vice versa.
 */

export interface PlayerEntityWiringReport {
  generated: boolean;
  entityFile: string;
  vanillaAnimationsPreserved: number;
  clipsRegistered: number;
  /** Clips with at least one animation, controller or script route in this generation pass. */
  clipsActivated: number;
  clipsActivatedByAnimate: number;
  clipsActivatedByController: number;
  clipsActivatedByScript: number;
  /** Clips bound with no recoverable condition (activated continuously, reported). */
  unconditionalClips: string[];
  /** Clips fired from the behaviour-pack script instead of Molang. */
  scriptedClips: string[];
  controllersRegistered: number;
  /** Clips whose activation runs through a generated animation controller state. */
  controllerDrivenClips: string[];
  animateEntries: number;
  firstPersonClips: string[];
  thirdPersonClips: string[];
  unresolvedClips: string[];
  /** Queries the player context cannot evaluate, and the supported expression that replaced each. */
  molangRepairs: string[];
  note: string;
}

export interface PlayerWiringResult {
  files: Record<string, string>;
  scriptCode: string;
  report: PlayerEntityWiringReport;
}

/** Names the runtime playback self-test responds to (`/<id>:animation_test`). */
export const PLAYER_ANIMATION_TEST_EVENT = 'animation_test';

/**
 * The vanilla player entries a pack override must keep, or the player loses its animation.
 * They come from the shared baseline contract so the alias map, the `scripts.animate` entries and
 * the dependency gate can never disagree about which resources the engine provides.
 */
const VANILLA_PLAYER_ANIMATIONS = PLAYER_BASELINE_ANIMATIONS;
const VANILLA_ANIMATE = PLAYER_BASELINE_ANIMATE;

function readExistingPlayerDescription(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const client = doc['minecraft:client_entity'] as Record<string, unknown> | undefined;
    const description = client?.description;
    return description && typeof description === 'object' && !Array.isArray(description)
      ? description as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function uniqueEntries<T>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildPlayerClientEntity(options: {
  portedClips: Record<string, BedrockAnimationClip>;
  triggers: PlayerClipTrigger[];
  controllerIds: string[];
  /**
   * Clips a generated animation controller activates. They are registered on the entity but kept
   * out of `scripts.animate`: driving one clip from both places starts two instances of it, and two
   * instances of one clip at different times average into a blurred pose that reads as no animation.
   */
  controllerDrivenClipIds?: string[];
  templateClipIds?: string[];
  /**
   * Geometry identifier for a verified Bedrock-compatible player model. Source-only geometry
   * is not safe to use as a skin rig and is deliberately omitted by the player port.
   */
  geometryIdentifier?: string;
  /** Variable initialization statements from the Universal Variable Resolver */
  variableInitializations?: string[];
  /** Namespace used by the runtime playback self-test script event. */
  modId?: string;
  /** Existing player definition to merge over, rather than replacing its vanilla or pack wiring. */
  existingPlayerEntity?: string;
}): PlayerWiringResult {
  const { triggers, controllerIds, variableInitializations } = options;
  const existingDescription = readExistingPlayerDescription(options.existingPlayerEntity);
  const existingScripts = existingDescription.scripts && typeof existingDescription.scripts === 'object'
    ? existingDescription.scripts as Record<string, unknown>
    : {};
  const existingPreAnimation = Array.isArray(existingScripts.pre_animation)
    ? existingScripts.pre_animation.filter((entry): entry is string => typeof entry === 'string')
    : typeof existingScripts.pre_animation === 'string' ? [existingScripts.pre_animation] : [];
  const existingAnimations = existingDescription.animations && typeof existingDescription.animations === 'object' && !Array.isArray(existingDescription.animations)
    ? existingDescription.animations as Record<string, string>
    : {};
  const existingAnimate = Array.isArray(existingScripts.animate)
    ? existingScripts.animate.filter((entry): entry is string | Record<string, string> => typeof entry === 'string' || (typeof entry === 'object' && entry !== null && !Array.isArray(entry)))
    : [];
  const existingGeometry = existingDescription.geometry && typeof existingDescription.geometry === 'object'
    ? existingDescription.geometry as Record<string, string>
    : {};
  const existingMaterials = existingDescription.materials && typeof existingDescription.materials === 'object'
    ? existingDescription.materials as Record<string, string>
    : {};
  const existingTextures = existingDescription.textures && typeof existingDescription.textures === 'object'
    ? existingDescription.textures as Record<string, string>
    : {};
  const existingRenderControllers = Array.isArray(existingDescription.render_controllers)
    ? existingDescription.render_controllers.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const controllerDriven = new Set(options.controllerDrivenClipIds ?? []);
  const controllerDrivenClips: string[] = [];
  const animations: Record<string, string> = { ...existingAnimations, ...VANILLA_PLAYER_ANIMATIONS };
  const animate: Array<string | Record<string, string>> = uniqueEntries([...VANILLA_ANIMATE, ...existingAnimate]);
  const usedShortNames = new Set(Object.keys(animations));
  const scriptedClips: string[] = [];
  const activatedClips: string[] = [];
  const unconditionalClips: string[] = [];
  const firstPersonClips: string[] = [];
  const thirdPersonClips: string[] = [];
  const unresolvedClips: string[] = [];
  const preAnimation: string[] = [...existingPreAnimation];
  // Every variable is declared through the Molang compatibility analyzer: a query the player
  // client-entity context cannot evaluate (`query.attack_time`) is replaced by a proxy built from
  // queries it CAN evaluate, and each replacement is reported. Deleting the query would satisfy
  // validation and silently stop every attack pose from playing.
  const molangRepairs: string[] = [];
  const declareVariable = (variable: string, expression: string): void => {
    if (preAnimation.some((statement) => new RegExp(`\\bvariable\\.${variable}\\s*=`).test(statement))) return;
    const translation = translateMolangExpression(expression, 'player_entity');
    preAnimation.push(`variable.${variable} = ${translation.expression};`);
    for (const change of translation.changes) {
      molangRepairs.push(`variable.${variable}: ${change.from} → ${change.to} (${change.fidelity}) — ${change.reason}`);
    }
    for (const entry of translation.unresolved) {
      molangRepairs.push(`variable.${variable}: UNRESOLVED ${entry.query} — ${entry.reason}`);
    }
    for (const entry of translation.rejected) {
      molangRepairs.push(`variable.${variable}: REJECTED ${entry.call} — ${entry.reason}`);
    }
  };
  declareVariable('is_first_person', 'query.is_first_person');
  declareVariable('attack_time', 'query.attack_time');
  declareVariable('hurt_time', 'query.hurt_time');
  declareVariable('is_using_item', 'query.is_using_item');
  // Armour-layer visibility comes from the shared equipment catalog: `query.get_equipped_item_name`
  // accepts only the two hand slots, so an armour slot passed to it is rejected by the engine and
  // the layer flag would never evaluate. The slot-presence query keeps the flag live per frame.
  for (const [armorLayerVariable, resolution] of Object.entries(ARMOR_LAYER_VISIBILITY_MAP)) {
    declareVariable(armorLayerVariable, resolution.query);
  }
  for (const statement of variableInitializations ?? []) {
    const translation = translateMolangExpression(statement, 'player_entity');
    preAnimation.push(translation.expression);
    for (const change of translation.changes) {
      molangRepairs.push(`${change.from} → ${change.to} (${change.fidelity}) — ${change.reason}`);
    }
    for (const entry of translation.unresolved) {
      molangRepairs.push(`UNRESOLVED ${entry.query} — ${entry.reason}`);
    }
  }

  const register = (clipId: string, preferred: string, aliasOnly = false): string => {
    // The player entity can be rebuilt when bytecode discovery finds a controller late in the
    // pipeline. Reuse the alias already pointing at this exact identifier; allocating "_2" aliases
    // on each pass causes duplicate animation layers and contradictory Molang gates.
    const existingAlias = Object.entries(animations).find(([, target]) => target === clipId)?.[0];
    if (existingAlias) return existingAlias;

    let short = preferred;
    let index = 2;
    while (usedShortNames.has(short)) {
      short = `${preferred}_${index}`;
      index += 1;
    }
    usedShortNames.add(short);
    animations[short] = clipId;
    // The behaviour-pack script addresses clips by their full id, so both keys resolve.
    // A CONTROLLER identifier is never registered as its own key: the animations map holds
    // aliases, and an identifier-shaped key invites `scripts.animate` to address the controller as
    // if it were an animation definition, which the engine reports as "cannot find".
    if (!aliasOnly && !usedShortNames.has(clipId)) {
      usedShortNames.add(clipId);
      animations[clipId] = clipId;
    }
    return short;
  };

  for (const trigger of triggers) {
    const short = register(trigger.clipId, trigger.shortName);
    if (trigger.perspective === 'first') firstPersonClips.push(trigger.clipId);
    else thirdPersonClips.push(trigger.clipId);
    if (trigger.status === 'unresolved') unresolvedClips.push(trigger.clipId);

    // Molang cannot express arbitrary Java control flow, so one-shot logic is fired from the
    // behaviour-pack script. Those clips stay out of scripts.animate or they would loop.
    if (trigger.scriptDriven) {
      scriptedClips.push(trigger.clipId);
      continue;
    }

    // The generated controller owns this clip's activation. It is registered here (so the
    // controller can reference it and validation can see it) but it is not also put on the
    // scripts.animate path.
    if (controllerDriven.has(trigger.clipId)) {
      controllerDrivenClips.push(trigger.clipId);
      activatedClips.push(trigger.clipId);
      continue;
    }

    const viewGate = trigger.perspective === 'first'
      ? 'query.is_first_person'
      : '!query.is_first_person';
    // The translated Java condition runs in the player client-entity context, so it is checked
    // against that context before it ships: an unsupported query is replaced by a supported proxy
    // instead of being emitted and silently failing to resolve.
    const conditionTranslation = trigger.condition
      ? translateMolangExpression(trigger.condition, 'player_entity')
      : null;
    for (const change of conditionTranslation?.changes ?? []) {
      molangRepairs.push(`${trigger.clipId}: ${change.from} → ${change.to} (${change.fidelity}) — ${change.reason}`);
    }
    for (const entry of conditionTranslation?.unresolved ?? []) {
      molangRepairs.push(`${trigger.clipId}: UNRESOLVED ${entry.query} — ${entry.reason}`);
    }
    for (const entry of conditionTranslation?.rejected ?? []) {
      molangRepairs.push(`${trigger.clipId}: REJECTED ${entry.call} — ${entry.reason}`);
    }
    const condition = conditionTranslation?.expression;
    if (!condition || (conditionTranslation?.unresolved.length ?? 0) > 0) {
      // A registered clip with a condition the player context cannot evaluate is otherwise dead
      // JSON: Bedrock quietly leaves the vanilla pose in place. Keep the clip reachable through
      // its perspective gate as a clearly reported continuous fallback instead of silently
      // dropping its only activation path. This is intentionally a degraded approximation; the
      // source-state condition remains in the report so it can be repaired with better evidence.
      unconditionalClips.push(trigger.clipId);
      animate.push({ [short]: viewGate });
      activatedClips.push(trigger.clipId);
      if (!unresolvedClips.includes(trigger.clipId)) unresolvedClips.push(trigger.clipId);
      const reason = conditionTranslation?.unresolved.map((entry) => entry.reason).join('; ') || 'no translated condition was available';
      molangRepairs.push(`${trigger.clipId}: CONDITION FALLBACK — continuous playback behind ${viewGate}; ${reason}`);
      continue;
    }
    animate.push({
      [short]: `(${condition}) && ${viewGate}`,
    });
    activatedClips.push(trigger.clipId);
  }

  // INVENTED template clips (playable mode only) are registered so scripted playback of them
  // resolves too; they ship no controller of their own here.
  for (const clipId of options.templateClipIds ?? []) {
    if (options.portedClips[clipId]) continue;
    register(clipId, safeFileId(clipId.split(/[.:/]+/).pop() ?? clipId) || 'clip');
  }

  // Ensure every ported player clip is registered in the animations map so pack validation
  // never flags an unregistered player clip error.
  for (const clipId of Object.keys(options.portedClips ?? {})) {
    if (usedShortNames.has(clipId)) continue;
    register(clipId, safeFileId(clipId.split(/[.:/]+/).pop() ?? clipId) || 'clip');
    // A clip missing from the trigger report has no source-state or perspective evidence.
    // Keep it registered and report the gap; do not guess an activation path.
    unresolvedClips.push(clipId);
  }

  // A controller that is never referenced by an entity definition is dead JSON: every
  // controller handed to this stage is both declared and driven from scripts.animate.
  let controllersRegistered = 0;
  for (const controllerId of controllerIds) {
    if (!controllerId) continue;
    const preferred = safeFileId(controllerId.split(/[.:/]+/).pop() ?? controllerId) || 'controller';
    const short = register(controllerId, preferred, true);
    animate.push(short);
    controllersRegistered += 1;
  }

  const json = JSON.stringify(
    {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          ...existingDescription,
          identifier: 'minecraft:player',
          materials: { default: 'entity_alphatest', cape: 'entity_alphatest', ...existingMaterials },
          textures: { default: 'textures/entity/steve', cape: 'textures/entity/cape_invisible', ...existingTextures },
          // A source mod's geometry file is not automatically a valid player skin rig.
          // In the fixture, the imported geometry used snake_case limb names while the converted
          // clips targeted Bedrock's camelCase player bones, so every limb track missed. Only keep
          // geometry IDs explicitly present in the vanilla player geometry contract; otherwise
          // bind to the engine's native player skeleton.
          geometry: {
            ...existingGeometry,
            default: options.geometryIdentifier && VANILLA_PLAYER_GEOMETRY_IDS.has(options.geometryIdentifier)
              ? options.geometryIdentifier
              : existingGeometry.default && VANILLA_PLAYER_GEOMETRY_IDS.has(existingGeometry.default)
                ? existingGeometry.default
                : 'geometry.humanoid.custom',
            cape: existingGeometry.cape === 'geometry.cape' ? existingGeometry.cape : 'geometry.cape',
          },
          scripts: {
            ...existingScripts,
            scale: existingScripts.scale ?? '0.9375',
            pre_animation: uniqueEntries(preAnimation),
            animate: uniqueEntries(animate),
          },
          animations,
          render_controllers: uniqueEntries([
            'controller.render.player.first_person',
            'controller.render.player.third_person',
            'controller.render.player.cape',
            ...existingRenderControllers,
          ]),
        },
      },
    },
    null,
    2,
  );

  const registeredPlayerClipIds = new Set([
    ...Object.keys(options.portedClips),
    ...(options.templateClipIds ?? []),
    ...triggers.map((trigger) => trigger.clipId),
  ]);
  const controllerActivatedIds = new Set(controllerDrivenClips);
  const scriptActivatedIds = new Set(scriptedClips);
  const animateActivatedIds = new Set(activatedClips.filter((clipId) => !controllerActivatedIds.has(clipId)));
  const runtimeActivatedIds = new Set([
    ...animateActivatedIds,
    ...controllerActivatedIds,
    ...scriptActivatedIds,
  ]);

  const report: PlayerEntityWiringReport = {
    generated: true,
    entityFile: 'entity/player.entity.json',
    vanillaAnimationsPreserved: Object.keys(VANILLA_PLAYER_ANIMATIONS).length,
    clipsRegistered: registeredPlayerClipIds.size,
    clipsActivated: runtimeActivatedIds.size,
    clipsActivatedByAnimate: animateActivatedIds.size,
    clipsActivatedByController: controllerActivatedIds.size,
    clipsActivatedByScript: scriptActivatedIds.size,
    unconditionalClips,
    scriptedClips,
    controllersRegistered,
    controllerDrivenClips,
    animateEntries: animate.length,
    firstPersonClips,
    thirdPersonClips,
    unresolvedClips: [...new Set(unresolvedClips)],
    note:
      `Full player client entity written because a pack override replaces the whole vanilla file: root and base poses are preserved, including the first-person hand pose and attack controller. ` +
      `${runtimeActivatedIds.size} unique player clip(s) have an activation path — ${controllerActivatedIds.size} through a generated animation controller state, declared after the vanilla root controller so an active ported state answers last and wins while vanilla keeps driving whenever no ported state is true; ${scriptActivatedIds.size} are fired from the behaviour-pack script and ${animateActivatedIds.size} carry a client-entity animate condition. ` +
      `${molangRepairs.length} Molang context repair(s) keep every emitted query valid inside a player client entity. Geometry: ${options.geometryIdentifier || 'geometry.humanoid.custom (vanilla skeleton)'}.`,
  };

  return {
    files: { 'entity/player.entity.json': json },
    scriptCode: buildPlayerScript(triggers, options.modId ?? 'aippy', Object.keys(options.portedClips)),
    report,
  };
}

/**
 * Behaviour-pack activation script for clips whose Java trigger is one-shot logic.
 *
 * Nothing here is silent: a missing API, a failed registration and a failed playback attempt
 * each produce a content-log line, and `/<namespace>:animation_test` replays every ported clip
 * on the executing player so playback can be verified in game instead of assumed.
 */
function buildPlayerScript(triggers: PlayerClipTrigger[], modId: string, portedClipIds: string[]): string {
  // Diagnostics must not depend on source trigger recovery. Many player-animation mods
  // contain animation assets without bytecode/event hooks; returning '' here silently removed
  // the only direct playback test from precisely those conversions.
  if (portedClipIds.length === 0) return '';
  const namespace = safeFileId(modId) || 'aippy';
  const triggerByClip = new Map(triggers.map((trigger) => [trigger.clipId, trigger]));
  const entries = [...new Set(portedClipIds)]
    .map((clipId) => {
      const trigger = triggerByClip.get(clipId);
      return `  { clip: ${JSON.stringify(clipId)}, concept: ${JSON.stringify(trigger?.concept ?? 'unclassified')}, scriptDriven: ${trigger?.scriptDriven ? 'true' : 'false'} },`;
    })
    .join('\n');

  return `
// Generated by JavaBE: player animation activation and in-game playback diagnostics.
// The self-test is emitted for every player animation port, not only one-shot/script-driven clips.
import { world, system } from '@minecraft/server';

const PORTED_CLIPS = [
${entries}
];

function playPortedClip(entity, entry) {
  if (!entity) {
    console.warn('[JAVABE-ANIM] no entity supplied for ' + entry.clip + '; activation skipped.');
    return false;
  }
  if (typeof entity.playAnimation !== 'function') {
    console.warn('[JAVABE-ANIM] ' + (entity.typeId ?? 'entity') + ' cannot play ' + entry.clip + ': playAnimation is unavailable on this script API version.');
    return false;
  }
  try {
    entity.playAnimation(entry.clip, { blendOutTime: 0.15 });
    console.info('[JAVABE-ANIM] activated ' + entry.clip + ' on ' + entity.typeId);
    return true;
  } catch (error) {
    console.warn('[JAVABE-ANIM] activation FAILED for ' + entry.clip + ': ' + (error instanceof Error ? error.message : String(error)));
    return false;
  }
}

function playConcept(entity, concept) {
  let played = 0;
  for (const entry of PORTED_CLIPS) {
    if (!entry.scriptDriven || entry.concept !== concept) continue;
    if (playPortedClip(entity, entry)) played += 1;
  }
  return played;
}

const hitEvent = world.afterEvents.entityHitEntity;
if (!hitEvent) {
  console.warn('[JAVABE-ANIM] entityHitEntity event is unavailable; script-driven combat clips cannot auto-activate.');
} else {
  hitEvent.subscribe((event) => playConcept(event.damagingEntity, 'attacking'));
}

const itemUseEvent = world.afterEvents.itemUse;
if (!itemUseEvent) {
  console.warn('[JAVABE-ANIM] itemUse event is unavailable; script-driven item-use clips cannot auto-activate.');
} else {
  itemUseEvent.subscribe((event) => playConcept(event.source, 'using-item'));
}

// Run in game with: /<namespace>:animation_test
// This deliberately bypasses Molang conditions and tests the exported animation IDs themselves.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== '${namespace}:${PLAYER_ANIMATION_TEST_EVENT}') return;
  const player = event.sourceEntity;
  if (!player) {
    console.warn('[JAVABE-ANIM] /<namespace>:${PLAYER_ANIMATION_TEST_EVENT} needs a player source entity.');
    return;
  }
  const requested = (event.message ?? '').trim();
  const selected = requested && requested !== 'all'
    ? PORTED_CLIPS.filter((entry) => entry.clip.toLowerCase().includes(requested.toLowerCase()))
    : PORTED_CLIPS;
  if (selected.length === 0) {
    player.sendMessage('§c[JAVABE] No player animation matched: ' + requested);
    return;
  }
  let played = 0;
  for (const entry of selected) if (playPortedClip(player, entry)) played += 1;
  player.sendMessage('§b[JAVABE] Playback test: ' + played + '/' + selected.length + ' clip(s) started. Check Content Log for [JAVABE-ANIM] failures.');
});
`;
}

