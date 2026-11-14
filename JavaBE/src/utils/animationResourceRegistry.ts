import { buildBoneIndex, matchBoneName } from '@/utils/boneRetarget';
import { PLAYER_SKELETON_BONES, resolvePlayerBone } from '@/utils/playerBoneAliases';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';
import { snapshotAnimationResourceRegistry } from '@/utils/animationRegistrySnapshot';
export { assertAnimationResourceRegistryCurrent } from '@/utils/animationRegistrySnapshot';

/**
 * The exported-resource registry: one reading of the pack that ships.
 *
 * Each auditor reports a different fact unless it reads the same final exported-resource
 * registry. This module defines the populations once so the report never presents a pass-local
 * action count as a final-pack total.
 *
 * It is built from the final file maps — after every writer, repair and post-processing pass —
 * and each counter carries the exact scope it measures:
 *
 *   • defined     — clip identifiers some shipped `*.animation.json` declares.
 *   • registered  — defined clips a client entity can select through a direct animation alias or
 *                   a reachable state in one of its referenced controllers; activation is separate.
 *   • activated   — registered clips with a runtime path: an `scripts.animate` entry, a state that
 *                   can be reached from an active controller's initial state, or a verified
 *                   behaviour-script call. One-shot scripts are not treated as always-running.
 *   • resolved    — owner/clip/bone track bindings addressed to bones the skeleton that owner
 *                   renders declares (pack geometry, plus the engine player rig for the player).
 *
 * Nothing here invents content; it only measures. The validators consume these numbers so they
 * cannot disagree again.
 */

export const ENGINE_ANIMATION_ID = {
  test: isKnownVanillaPlayerAnimationReference,
};
export const VANILLA_GEOMETRY_ID = /^geometry\.(humanoid|cape|armor_stand|player)\b/i;
export const VANILLA_RENDER_CONTROLLER_ID = /^controller\.render\.(player|armor_stand)\b/i;

type FileMap = Record<string, string | Uint8Array>;

export interface RegistryClip {
  id: string;
  path: string;
  bones: string[];
  body: Record<string, any>;
}

export interface RegistryController {
  id: string;
  path: string;
  /** Clip ids the controller's states select (standing in for a playable state). */
  clips: string[];
  /** Clip ids in states reachable from the controller's initial state. */
  reachableClips: string[];
  states: string[];
}

export interface RegistryEntity {
  path: string;
  identifier: string;
  isPlayer: boolean;
  animations: Record<string, string>;
  animateKeys: Set<string>;
  animateEntries: unknown[];
  /** Molang condition by animation-map key; null means a bare/unconditional animate entry. */
  animateConditions: Record<string, string | null>;
  activeControllers: string[];
  /** Unique custom animation IDs selected by this entity, including its declared controller states. */
  registeredClipIds: string[];
  /** Unique selected animation IDs with a direct, active-controller or verified script path. */
  activatedClipIds: string[];
  geometryIds: string[];
  renderControllers: string[];
  initializedVariables: Set<string>;
}

export interface BoneAudit {
  /** Unique entity-registration/clip/bone pairs measured against each owner's rendered skeleton. */
  checked: number;
  resolved: number;
  unresolved: string[];
  /** Entities whose skeleton could not be resolved at all, so nothing could be measured for them. */
  skeletonsUnresolved: string[];
  /** Bones the destination skeleton genuinely lacks, per clip and owner (subset of `unresolved`). */
  missingByClip: Record<string, string[]>;
}

export interface AnimationRegistryMetrics {
  /** Unique animation identifiers defined by documents in the exported resource pack. */
  clipsDefined: number;
  animationDefinitionFiles: number;
  animationControllerDefinitionFiles: number;
  renderControllerDefinitionFiles: number;
  clientEntities: number;
  clientEntitiesWithAnimations: number;
  clientEntitiesWithAnimate: number;
  /** Map-key bindings on client entities; includes vanilla clips and controller aliases. */
  animationAliasesDeclared: number;
  /** Unique client-entity/clip pairs that can select a defined clip. */
  clipRegistrationEdges: number;
  duplicateAnimationIds: Array<{ id: string; definitions: number }>;
  clipsWithMotion: number;
  clipsRegistered: number;
  /** Clip ids a client entity can select (direct registration or an activated controller state). */
  registeredClipIds: string[];
  clipsActivatedByAnimate: number;
  clipsActivatedByController: number;
  clipsActivatedByScript: number;
  /** Union of animate, reachable active-controller, and verified script play paths. */
  clipsActivated: number;
  activatedClipIds: string[];
  scriptActivatedClipIds: string[];
  /** Registered clips with no path reaching the final resource. */
  unactivatedClips: string[];
  /**
   * Registered clips a later stage deliberately left without an activation entry — a state it
   * shadowed because a higher-priority clip owns the pose, or a clip fired from the behaviour
   * script. They are NOT silent failures, so they are excluded from `unactivatedClips`: the honest
   * figure is "registered, no path, and no reason given".
   */
  deliberatelyInactiveClips: string[];
  /** Defined clips no entity can select at all (neither directly nor through a controller). */
  orphanedClips: string[];
  /** Identifiers an entity registers that no document defines. */
  unresolvedIdentifiers: string[];
  controllersDefined: number;
  controllersRegistered: number;
  controllersActivated: number;
  controllersUnregistered: string[];
  controllersDangling: string[];
  renderControllersReferenced: number;
  /** All unique render-controller definitions found in the exported pack. */
  renderControllersDeclared: number;
  /** Referenced render controllers that resolve to a definition in the exported pack. */
  renderControllersDefinedInPack: number;
  renderControllersEngineProvided: string[];
  renderControllersUnresolved: string[];
  bones: BoneAudit;
  firstPersonStates: number;
  thirdPersonStates: number;
  otherConditionalStates: number;
  conditionalStates: number;
  unconditionalStates: number;
  /** Unique defined clip ids directly gated to first person by a client-entity animate condition. */
  firstPersonClipIds: string[];
}

export interface AnimationResourceRegistry {
  clips: Map<string, RegistryClip>;
  controllers: Map<string, RegistryController>;
  entities: RegistryEntity[];
  /** Geometry identifier → declared bone names (every `.json` that declares a geometry entry). */
  geometries: Map<string, string[]>;
  renderControllers: Map<string, string>;
  scriptText: string;
  metrics: AnimationRegistryMetrics;
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function collectJson(files: FileMap): Map<string, Record<string, any>> {
  const out = new Map<string, Record<string, any>>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.json')) continue;
    const doc = parseJson(files[path]);
    if (doc) out.set(path, doc);
  }
  return out;
}

function collectClips(json: Map<string, Record<string, any>>): {
  clips: Map<string, RegistryClip>;
  definitionFiles: number;
  duplicateIds: Array<{ id: string; definitions: number }>;
} {
  const clips = new Map<string, RegistryClip>();
  const pathsById = new Map<string, Set<string>>();
  let definitionFiles = 0;
  for (const [path, doc] of json) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const animations = doc.animations;
    if (!animations || typeof animations !== 'object' || Array.isArray(animations)) continue;
    definitionFiles += 1;
    for (const [clipId, body] of Object.entries(animations as Record<string, any>)) {
      const paths = pathsById.get(clipId) ?? new Set<string>();
      paths.add(path);
      pathsById.set(clipId, paths);
      if (clips.has(clipId)) continue;
      const record = body && typeof body === 'object' ? (body as Record<string, any>) : {};
      const bones = record.bones && typeof record.bones === 'object' && !Array.isArray(record.bones)
        ? Object.keys(record.bones as Record<string, unknown>)
        : [];
      clips.set(clipId, { id: clipId, path, bones, body: record });
    }
  }
  return {
    clips,
    definitionFiles,
    duplicateIds: [...pathsById.entries()]
      .filter(([, paths]) => paths.size > 1)
      .map(([id, paths]) => ({ id, definitions: paths.size })),
  };
}

function collectControllers(json: Map<string, Record<string, any>>): {
  controllers: Map<string, RegistryController>;
  definitionFiles: number;
} {
  const controllers = new Map<string, RegistryController>();
  let definitionFiles = 0;
  for (const [path, doc] of json) {
    if (!path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const root = doc.animation_controllers;
    if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
    definitionFiles += 1;
    for (const [controllerId, body] of Object.entries(root as Record<string, any>)) {
      const clips: string[] = [];
      const states = body && typeof body === 'object' ? (body as Record<string, any>).states : null;
      const stateNames: string[] = states && typeof states === 'object' ? Object.keys(states) : [];
      if (states && typeof states === 'object') {
        for (const state of Object.values(states as Record<string, any>)) {
          const list = state && typeof state === 'object' ? (state as Record<string, any>).animations : null;
          if (!Array.isArray(list)) continue;
          for (const entry of list) {
            if (typeof entry === 'string') clips.push(entry);
            else if (entry && typeof entry === 'object') clips.push(...Object.keys(entry));
          }
        }
      }
      const initial = body && typeof body.initial_state === 'string'
        ? body.initial_state
        : stateNames[0];
      const reachable = new Set<string>();
      const pending = initial && states && Object.hasOwn(states, initial) ? [initial] : [];
      while (pending.length > 0) {
        const stateName = pending.pop();
        if (!stateName || reachable.has(stateName)) continue;
        reachable.add(stateName);
        const transitions = (states as Record<string, any>)[stateName]?.transitions;
        if (!Array.isArray(transitions)) continue;
        for (const transition of transitions) {
          if (!transition || typeof transition !== 'object' || Array.isArray(transition)) continue;
          for (const destination of Object.keys(transition)) {
            if (Object.hasOwn(states, destination) && !reachable.has(destination)) pending.push(destination);
          }
        }
      }
      const reachableClips: string[] = [];
      for (const stateName of reachable) {
        const list = (states as Record<string, any>)[stateName]?.animations;
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          if (typeof entry === 'string') reachableClips.push(entry);
          else if (entry && typeof entry === 'object') reachableClips.push(...Object.keys(entry));
        }
      }
      controllers.set(controllerId, {
        id: controllerId,
        path,
        clips: [...new Set(clips)],
        reachableClips: [...new Set(reachableClips)],
        states: stateNames,
      });
    }
  }
  return { controllers, definitionFiles };
}

function collectGeometries(json: Map<string, Record<string, any>>): Map<string, string[]> {
  const geometries = new Map<string, string[]>();
  for (const doc of json.values()) {
    const raw = doc['minecraft:geometry'] ?? doc.geometry;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const identifier = (entry as Record<string, any>).description?.identifier;
      if (typeof identifier !== 'string' || !identifier.trim()) continue;
      const bones = Array.isArray((entry as Record<string, any>).bones)
        ? ((entry as Record<string, any>).bones as unknown[])
            .filter((bone) => Boolean(bone) && typeof bone === 'object')
            .map((bone) => String((bone as any).name ?? ''))
            .filter(Boolean)
        : [];
      geometries.set(identifier.trim(), bones);
    }
  }
  return geometries;
}

function collectRenderControllers(json: Map<string, Record<string, any>>): {
  controllers: Map<string, string>;
  definitionFiles: number;
} {
  const controllers = new Map<string, string>();
  let definitionFiles = 0;
  for (const [path, doc] of json) {
    if (!path.toLowerCase().startsWith('render_controllers/')) continue;
    const root = doc.render_controllers ?? doc['minecraft:render_controllers'];
    if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
    definitionFiles += 1;
    for (const controllerId of Object.keys(root as Record<string, unknown>)) {
      controllers.set(controllerId, path);
    }
  }
  return { controllers, definitionFiles };
}

function collectEntities(
  json: Map<string, Record<string, any>>,
  controllers: Map<string, RegistryController>,
): RegistryEntity[] {
  const entities: RegistryEntity[] = [];
  for (const [path, doc] of json) {
    const description = doc['minecraft:client_entity']?.description;
    if (!description || typeof description !== 'object') continue;
    const isPlayerDocument = (description as Record<string, unknown>).identifier === 'minecraft:player';
    // Mod archives and pack mergers can preserve extra directory prefixes around entity files.
    // Identify the player by its declared engine identifier, not only by the canonical path.
    if (!(new RegExp('^entity/[^/]+[.]entity[.]json$', 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}, 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}, 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}, 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}, 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}, 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}, 'i')).test(path) && !isPlayerDocument) continue;
    const animations: Record<string, string> = {};
    if (description.animations && typeof description.animations === 'object') {
      for (const [key, value] of Object.entries(description.animations as Record<string, unknown>)) {
        if (typeof value === 'string') animations[key] = value;
      }
    }
    const animateKeys = new Set<string>();
    const animateConditions: Record<string, string | null> = {};
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    for (const entry of animate) {
      if (typeof entry === 'string') {
        animateKeys.add(entry);
        animateConditions[entry] = null;
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        animateKeys.add(key);
        animateConditions[key] = typeof condition === 'string' ? condition : null;
      }
    }
    const initializedVariables = new Set<string>();
    for (const field of ['initialize', 'pre_animation']) {
      const statements = description.scripts?.[field];
      const text = Array.isArray(statements)
        ? statements.filter((value: unknown): value is string => typeof value === 'string').join(' ')
        : typeof statements === 'string' ? statements : '';
      for (const match of text.matchAll(/variable\.([a-z0-9_]+)\s*=/gi)) {
        initializedVariables.add(String(match[1]).toLowerCase());
      }
    }
    const activeControllers: string[] = [];
    for (const [key, value] of Object.entries(animations)) {
      if (!value.startsWith('controller.animation.')) continue;
      if (animateKeys.has(key)) activeControllers.push(value);
    }
    entities.push({
      path,
      identifier: typeof description.identifier === 'string' ? description.identifier : path,
      isPlayer: description.identifier === 'minecraft:player',
      animations,
      animateKeys,
      animateConditions,
      animateEntries: animate,
      activeControllers,
      registeredClipIds: [],
      activatedClipIds: [],
      initializedVariables,
      geometryIds: description.geometry && typeof description.geometry === 'object'
        ? Object.values(description.geometry as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      renderControllers: Array.isArray(description.render_controllers)
        ? (description.render_controllers as unknown[]).filter(
            (value): value is string => typeof value === 'string',
          )
        : Object.values(animations).filter((value) => value.startsWith('controller.render.')),
    });
  }
  return entities;
}

function resolveControllerAnimationAlias(entity: RegistryEntity, reference: string): string | null {
  const target = entity.animations[reference];
  return typeof target === 'string' && target.startsWith('animation.') ? target : null;
}

/** Clip ids an entity can select, as established once by the exported-resource registry. */
export function clipsSelectableBy(entity: RegistryEntity): Set<string> {
  return new Set(entity.registeredClipIds);
}

/** Skeleton the entity actually renders: pack geometry bones, plus the engine rig for the player. */
export function skeletonFor(
  entity: RegistryEntity,
  geometries: Map<string, string[]>,
): { bones: string[]; measured: boolean } {
  const bones = new Set<string>();
  for (const geometryId of entity.geometryIds) {
    for (const bone of geometries.get(geometryId) ?? []) bones.add(bone);
  }
  const engineRig =
    entity.isPlayer && (entity.geometryIds.length === 0 || entity.geometryIds.some((id) => VANILLA_GEOMETRY_ID.test(id)));
  if (engineRig) for (const bone of PLAYER_SKELETON_BONES) bones.add(bone);
  return { bones: [...bones], measured: bones.size > 0 };
}

function auditBones(
  clips: Map<string, RegistryClip>,
  entities: RegistryEntity[],
  geometries: Map<string, string[]>,
): BoneAudit {
  const resolvedPairs = new Map<string, { entityPath: string; identifier: string; clipId: string; bone: string; resolved: boolean }>();
  const skeletonsUnresolved: string[] = [];
  for (const entity of entities) {
    const selectable = clipsSelectableBy(entity);
    const owned = [...selectable].filter((clipId) => clips.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId));
    if (owned.length === 0) continue;
    const skeleton = skeletonFor(entity, geometries);
    if (!skeleton.measured) {
      skeletonsUnresolved.push(`${entity.identifier} (${entity.path})`);
      continue;
    }
    const index = buildBoneIndex(skeleton.bones);
    for (const clipId of owned) {
      for (const bone of clips.get(clipId)?.bones ?? []) {
        const key = JSON.stringify([entity.path, clipId, bone]);
        const matched = Boolean(matchBoneName(bone, index).bone) || Boolean(entity.isPlayer && resolvePlayerBone(bone));
        resolvedPairs.set(key, { entityPath: entity.path, identifier: entity.identifier, clipId, bone, resolved: matched });
      }
    }
  }
  const unresolved: string[] = [];
  const missingByClipSets = new Map<string, Set<string>>();
  let resolved = 0;
  for (const pair of resolvedPairs.values()) {
    if (pair.resolved) {
      resolved += 1;
      continue;
    }
    unresolved.push(`${pair.identifier} (${pair.entityPath}): ${pair.clipId} → ${pair.bone}`);
    const missing = missingByClipSets.get(pair.clipId) ?? new Set<string>();
    missing.add(pair.bone);
    missingByClipSets.set(pair.clipId, missing);
  }
  const missingByClip: Record<string, string[]> = {};
  for (const [clipId, bones] of missingByClipSets) missingByClip[clipId] = [...bones];
  return {
    checked: resolvedPairs.size,
    resolved,
    unresolved,
    skeletonsUnresolved,
    missingByClip,
  };
}

function hasScriptActivation(scriptText: string, clipId: string, sourceEvidenced: Set<string>): boolean {
  const compact = scriptText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  const literal = JSON.stringify(clipId);
  const directCall = compact.includes(`.playAnimation(${literal}`);
  const generatedCall = sourceEvidenced.has(clipId) &&
    compact.includes('entity.playAnimation(entry.clip') &&
    compact.includes(`{clip:${literal},`);
  return directCall || generatedCall;
}

/**
 * Reads one file map pair and produces every animation figure the report shows. The behaviour pack
 * is scanned only for actual play calls; a clip mentioned in a test list or comment is not activation.
 */
export function buildAnimationResourceRegistry(input: {
  resourcePackFiles: FileMap;
  behaviorPackFiles?: FileMap;
  /** Clips a later stage deliberately deactivated (shadowed states, script-fired one-shots). */
  deactivatedClips?: string[];
  /** Source-evidenced clips intentionally dispatched by a behaviour-pack animation script. */
  scriptDrivenClips?: string[];
}): AnimationResourceRegistry {
  const json = collectJson(input.resourcePackFiles);
  const clipScan = collectClips(json);
  const clips = clipScan.clips;
  const controllerScan = collectControllers(json);
  const controllers = controllerScan.controllers;
  const geometries = collectGeometries(json);
  const renderControllerScan = collectRenderControllers(json);
  const renderControllers = renderControllerScan.controllers;
  const entities = collectEntities(json, controllers);
  const scriptText = Object.keys(input.behaviorPackFiles ?? {})
    .filter((path) => path.startsWith('scripts/'))
    .map((path) => input.behaviorPackFiles?.[path])
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  /** Filled in below, next to the counters it belongs with. */
  const registered = new Set<string>();
  const registrationEdges = new Set<string>();
  const animateActivated = new Set<string>();
  const controllerActivated = new Set<string>();
  const unresolvedIdentifiers = new Set<string>();
  const referencedControllers = new Set<string>();
  let firstPersonStates = 0;
  let thirdPersonStates = 0;
  let otherConditionalStates = 0;
  let conditionalStates = 0;
  let unconditionalStates = 0;
  const firstPersonClipIds = new Set<string>();

  for (const entity of entities) {
    const entityRegistered = new Set<string>();
    const entityAnimateActivated = new Set<string>();
    const entityControllerActivated = new Set<string>();
    for (const controllerId of entity.renderControllers) referencedControllers.add(controllerId);
    for (const [key, condition] of Object.entries(entity.animateConditions)) {
      if (condition === null || !condition.trim()) {
        unconditionalStates += 1;
        continue;
      }
      conditionalStates += 1;
      const hasFirstPersonNegation = /!\s*\(?\s*query\.is_first_person\s*\)?/.test(condition);
      const hasPositiveFirstPerson = /query\.is_first_person/.test(
        condition.replace(/!\s*\(?\s*query\.is_first_person\s*\)?/g, ''),
      );
      if (hasPositiveFirstPerson) {
        firstPersonStates += 1;
        const clipId = entity.animations[key];
        if (clipId && clips.has(clipId)) firstPersonClipIds.add(clipId);
      } else if (hasFirstPersonNegation) {
        thirdPersonStates += 1;
      } else {
        otherConditionalStates += 1;
      }
    }
    for (const [key, value] of Object.entries(entity.animations)) {
      if (value.startsWith('controller.animation.')) {
        referencedControllers.add(value);
        const controller = controllers.get(value);
        if (!controller && !ENGINE_ANIMATION_ID.test(value)) {
          unresolvedIdentifiers.add(value);
          continue;
        }
        if (!controller) continue;
        const controllerActivatedForEntity = entity.activeControllers.includes(value);
        for (const reference of controller.clips) {
          const clipId = resolveControllerAnimationAlias(entity, reference);
          if (!clipId) {
            unresolvedIdentifiers.add(`${value} state reference "${reference}" is not registered as an animation alias on ${entity.identifier}`);
            continue;
          }
          if (!clips.has(clipId)) {
            if (!ENGINE_ANIMATION_ID.test(clipId)) unresolvedIdentifiers.add(`${value} state alias "${reference}" -> ${clipId}`);
            continue;
          }
          if (!controller.reachableClips.includes(reference)) continue;
          registered.add(clipId);
          entityRegistered.add(clipId);
          registrationEdges.add(JSON.stringify([entity.path, clipId]));
          if (controllerActivatedForEntity) {
            controllerActivated.add(clipId);
            entityControllerActivated.add(clipId);
          }
        }
        continue;
      }
      if (!value.startsWith('animation.')) continue;
      if (ENGINE_ANIMATION_ID.test(value) && !clips.has(value)) continue;
      if (!clips.has(value)) {
        unresolvedIdentifiers.add(value);
        continue;
      }
      registered.add(value);
      entityRegistered.add(value);
      registrationEdges.add(JSON.stringify([entity.path, value]));
      if (entity.animateKeys.has(key)) {
        animateActivated.add(value);
        entityAnimateActivated.add(value);
      }
    }
    entity.registeredClipIds = [...entityRegistered];
    entity.activatedClipIds = [...new Set([...entityAnimateActivated, ...entityControllerActivated])];
  }

  const scriptActivated = new Set<string>();
  const sourceEvidencedScriptClips = new Set(input.scriptDrivenClips ?? []);
  for (const clipId of registered) {
    if (hasScriptActivation(scriptText, clipId, sourceEvidencedScriptClips)) scriptActivated.add(clipId);
  }
  for (const entity of entities) {
    const scriptPathClips = entity.registeredClipIds.filter((clipId) =>
      scriptActivated.has(clipId) && (!entity.isPlayer || sourceEvidencedScriptClips.has(clipId)),
    );
    entity.activatedClipIds = [...new Set([...entity.activatedClipIds, ...scriptPathClips])];
  }

  const activated = new Set<string>([...animateActivated, ...controllerActivated, ...scriptActivated]);
  // A clip the state resolver shadowed, or one only a script fires, has no scripts.animate path ON
  // PURPOSE. Counting it as a silent failure inflated the activation gap with decisions the pipeline
  // had already justified, so deliberate cases are separated from unexplained ones here.
  const deliberate = new Set(input.deactivatedClips ?? []);
  const unactivated = [...registered].filter(
    (clipId) => !activated.has(clipId) && !deliberate.has(clipId),
  );
  const deliberatelyInactive = [...registered].filter(
    (clipId) => !activated.has(clipId) && deliberate.has(clipId),
  );
  const orphaned = [...clips.keys()].filter(
    (clipId) => !registered.has(clipId) && !ENGINE_ANIMATION_ID.test(clipId),
  );
  const danglingControllers: string[] = [];
  for (const [controllerId, controller] of controllers) {
    const owners = entities.filter((entity) => entity.activeControllers.includes(controllerId));
    for (const reference of controller.clips) {
      if (owners.length === 0) continue;
      const unresolvedOwner = owners.find((entity) => {
        const clipId = resolveControllerAnimationAlias(entity, reference);
        return !clipId || (!ENGINE_ANIMATION_ID.test(clipId) && !clips.has(clipId));
      });
      if (unresolvedOwner) {
        const target = resolveControllerAnimationAlias(unresolvedOwner, reference);
        danglingControllers.push(`${controllerId} → ${reference}${target ? ` (${target})` : ` (no entity alias on ${unresolvedOwner.identifier})`}`);
      }
    }
  }
  const controllersUnregistered = [...controllers.keys()].filter((controllerId) => !referencedControllers.has(controllerId));
  const controllersActivated = [...controllers.keys()].filter((controllerId) =>
    entities.some((entity) => entity.activeControllers.includes(controllerId)),
  );
  const renderControllerIds = [...referencedControllers].filter(
    (controllerId) => controllerId.startsWith('controller.render.'),
  );
  const engineProvided = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const renderUnresolved = renderControllerIds.filter(
    (controllerId) => !renderControllers.has(controllerId) && !VANILLA_RENDER_CONTROLLER_ID.test(controllerId),
  );
  const bones = auditBones(clips, entities, geometries);

  const metrics: AnimationRegistryMetrics = {
    clipsDefined: clips.size,
    animationDefinitionFiles: clipScan.definitionFiles,
    animationControllerDefinitionFiles: controllerScan.definitionFiles,
    renderControllerDefinitionFiles: renderControllerScan.definitionFiles,
    clientEntities: entities.length,
    clientEntitiesWithAnimations: entities.filter((entity) => Object.keys(entity.animations).length > 0).length,
    clientEntitiesWithAnimate: entities.filter((entity) => entity.animateKeys.size > 0).length,
    animationAliasesDeclared: entities.reduce(
      (total, entity) => total + Object.keys(entity.animations).length,
      0,
    ),
    clipRegistrationEdges: registrationEdges.size,
    duplicateAnimationIds: clipScan.duplicateIds,
    clipsWithMotion: [...clips.values()].filter((clip) => clip.bones.length > 0).length,
    clipsRegistered: registered.size,
    registeredClipIds: [...registered],
    clipsActivatedByAnimate: animateActivated.size,
    clipsActivatedByController: controllerActivated.size,
    clipsActivatedByScript: scriptActivated.size,
    clipsActivated: activated.size,
    activatedClipIds: [...activated],
    scriptActivatedClipIds: [...scriptActivated],
    unactivatedClips: unactivated,
    deliberatelyInactiveClips: deliberatelyInactive,
    orphanedClips: orphaned,
    unresolvedIdentifiers: [...unresolvedIdentifiers],
    controllersDefined: controllers.size,
    controllersRegistered: controllers.size - controllersUnregistered.length,
    controllersActivated: controllersActivated.length,
    controllersUnregistered,
    controllersDangling: danglingControllers,
    renderControllersReferenced: renderControllerIds.length,
    renderControllersDeclared: renderControllers.size,
    renderControllersDefinedInPack: renderControllerIds.filter((controllerId) => renderControllers.has(controllerId)).length,
    renderControllersEngineProvided: engineProvided,
    renderControllersUnresolved: renderUnresolved,
    bones,
    firstPersonStates,
    thirdPersonStates,
    otherConditionalStates,
    conditionalStates,
    unconditionalStates,
    firstPersonClipIds: [...firstPersonClipIds],
  };

  const activationPartition =
    metrics.clipsActivated + metrics.unactivatedClips.length + metrics.deliberatelyInactiveClips.length;
  if (
    metrics.clipsActivated > metrics.clipsRegistered ||
    metrics.activatedClipIds.some((clipId) => !registered.has(clipId)) ||
    activationPartition !== metrics.clipsRegistered ||
    metrics.bones.resolved + metrics.bones.unresolved.length !== metrics.bones.checked
  ) {
    throw new Error('[Aippy] Final animation registry populations failed consistency checks.');
  }

  const registry: AnimationResourceRegistry = {
    clips,
    controllers,
    entities,
    geometries,
    renderControllers,
    scriptText,
    metrics,
  };
  snapshotAnimationResourceRegistry(registry, input);
  return registry;
}

export function describeRegistryScopes(metrics: AnimationRegistryMetrics): string[] {
  return [
    `definitions: ${metrics.clipsDefined} unique animation id(s) in ${metrics.animationDefinitionFiles} final animation document(s); ${metrics.clipsWithMotion} have bone tracks${metrics.duplicateAnimationIds.length > 0 ? `; ${metrics.duplicateAnimationIds.length} id(s) are defined in multiple documents` : ''}.`,
    `entity bindings: ${metrics.animationAliasesDeclared} final animation-map alias(es) across ${metrics.clientEntities} client entities; these include vanilla names and controller aliases. ${metrics.clipRegistrationEdges} unique entity/clip selection edge(s) resolve to ${metrics.clipsRegistered} unique custom clip id(s).`,
    `registration: ${metrics.clipsRegistered}/${metrics.clipsDefined} unique defined ids can be selected by at least one client entity through a direct alias or a reachable controller state.`,
    `activation: ${metrics.clipsActivated}/${metrics.clipsRegistered} unique registered ids have at least one final activation path; path-type counts can overlap — ${metrics.clipsActivatedByAnimate} animate, ${metrics.clipsActivatedByController} controller, ${metrics.clipsActivatedByScript} verified script calls; ${metrics.unactivatedClips.length} have no path, ${metrics.deliberatelyInactiveClips.length} are intentionally withheld.`,
    `animation controllers: ${metrics.controllersDefined} animation-controller definition(s) in ${metrics.animationControllerDefinitionFiles} final file(s), ${metrics.controllersRegistered} referenced by entities, ${metrics.controllersActivated} activated by scripts.animate; ${metrics.controllersDangling.length} dangling state selections. Render controllers are a separate resource type.`,
    `render controllers: ${metrics.renderControllersDeclared} definitions across ${metrics.renderControllerDefinitionFiles} final file(s), ${metrics.renderControllersReferenced} unique ids referenced, ${metrics.renderControllersDefinedInPack} referenced definitions found in this pack, ${metrics.renderControllersEngineProvided.length} engine-provided, ${metrics.renderControllersUnresolved.length} unresolved.`,
    `final bone bindings: ${metrics.bones.resolved}/${metrics.bones.checked} unique entity-file/clip/bone bindings match the owning entity's final rendered skeleton; ${metrics.bones.unresolved.length} do not, and ${metrics.bones.skeletonsUnresolved.length} owner skeleton(s) could not be measured.`,
    `view conditions: ${metrics.firstPersonStates} first-person, ${metrics.thirdPersonStates} explicit !first-person, ${metrics.otherConditionalStates} other conditional, ${metrics.unconditionalStates} unconditional animate key(s) (${metrics.conditionalStates} conditional total); ${metrics.firstPersonClipIds.length} unique clips directly gated to first person.`,
  ];
}