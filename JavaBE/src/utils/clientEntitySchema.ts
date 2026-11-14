import type { PackFile } from '@/utils/entityTextureVariants';

const VANILLA_PLAYER_ANIMATIONS = new Set([
  'animation.humanoid.base_pose',
  'animation.humanoid.look_at_target',
  'animation.player.base_pose',
  'animation.player.cape',
  'animation.player.first_person.base_pose',
]);

const VANILLA_PLAYER_CONTROLLERS = new Set([
  'controller.animation.player.root',
  'controller.animation.player.first_person_attack',
]);

/**
 * Optional animation properties on a client entity.
 *
 * Bedrock rejects an empty `animations` object and an empty `scripts.animate` array
 * ("unknown child schema option type" / empty animation node), and a clip that is not
 * declared by a shipped animation file is a dangling reference. An entity with no
 * animations must simply omit both properties — the properties are optional, so the
 * ebtity still loads and renders.
 */

export const CLIENT_ENTITY_ANIMATION_RULE =
  'Client entity animations and scripts.animate are optional. When present, their references must resolve to a shipped resource-pack file or a supported base-game player animation/controller.';

/** Every animation clip id declared by a shipped `animations/*.json` file. */
export function collectShippedClipIds(files: Record<string, PackFile>): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith('animations/') || !path.endsWith('.json')) continue;
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as { animations?: Record<string, unknown> };
      for (const id of Object.keys(parsed.animations ?? {})) ids.add(id);
    } catch {
      // An unreadable animation file contributes no clips; it is reported by validation.
    }
  }
  return ids;
}

/** Every animation controller id declared by a shipped `animation_controllers/*.json`. */
export function collectShippedControllerIds(files: Record<string, PackFile>): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith('animation_controllers/') || !path.endsWith('.json')) continue;
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as { animation_controllers?: Record<string, unknown> };
      for (const id of Object.keys(parsed.animation_controllers ?? {})) ids.add(id);
    } catch {
      // Ignored here: the controller validator reports the broken document.
    }
  }
  return ids;
}

/** Every sound event declared by the shipped sound definitions. */
export function collectShippedSoundEvents(files: Record<string, PackFile>): Set<string> {
  const raw = files['sounds/sound_definitions.json'];
  if (typeof raw !== 'string') return new Set();
  try {
    const parsed = JSON.parse(raw) as { sound_definitions?: Record<string, unknown> };
    return new Set(Object.keys(parsed.sound_definitions ?? {}));
  } catch {
    return new Set();
  }
}

export interface ClientEntitySanitizeResult {
  entities: number;
  filesTouched: number;
  emptyAnimationNodesRemoved: number;
  emptyAnimateArraysRemoved: number;
  danglingAnimationRefsRemoved: number;
  danglingControllersRemoved: number;
  danglingSoundEventsRemoved: number;
  unresolvedAnimationRefs: string[];
  unresolvedAnimateEntries: string[];
}

export function isKnownVanillaAnimationIdentifier(identifier: string): boolean {
  return VANILLA_PLAYER_ANIMATIONS.has(identifier);
}

export function isKnownVanillaAnimationControllerIdentifier(identifier: string): boolean {
  return VANILLA_PLAYER_CONTROLLERS.has(identifier);
}

export function isKnownVanillaPlayerAnimationReference(identifier: string): boolean {
  return isKnownVanillaAnimationIdentifier(identifier)
    || isKnownVanillaAnimationControllerIdentifier(identifier);
}

/**
 * Removes only empty optional animation properties. Unresolved registrations and activation
 * entries stay intact and are reported for the final dependency gate; pruning them would hide
 * the source problem and make an animation look successfully converted when it cannot run.
 */
export function sanitizeClientEntities(
  files: Record<string, PackFile>,
  options?: { onLog?: (line: string) => void },
): ClientEntitySanitizeResult {
  const clipIds = collectShippedClipIds(files);
  const controllerIds = collectShippedControllerIds(files);
  const soundEvents = collectShippedSoundEvents(files);
  const result: ClientEntitySanitizeResult = {
    entities: 0,
    filesTouched: 0,
    emptyAnimationNodesRemoved: 0,
    emptyAnimateArraysRemoved: 0,
    danglingAnimationRefsRemoved: 0,
    danglingControllersRemoved: 0,
    danglingSoundEventsRemoved: 0,
    unresolvedAnimationRefs: [],
    unresolvedAnimateEntries: [],
  };

  for (const path of Object.keys(files)) {
    if (!/^entity\/[^/]+\.entity\.json$/.test(path)) continue;
    const raw = files[path];
    if (typeof raw !== 'string') continue;
    let doc: Record<string, any>;
    try {
      doc = JSON.parse(raw) as Record<string, any>;
    } catch {
      continue;
    }
    const desc = doc?.['minecraft:client_entity']?.description;
    if (!desc || typeof desc !== 'object') continue;
    result.entities += 1;
    let changed = false;
    const isPlayer = desc.identifier === 'minecraft:player';

    // 1. animations — preserve unresolved source bindings for the export gate to diagnose.
    if (desc.animations != null && typeof desc.animations === 'object' && !Array.isArray(desc.animations)) {
      const entries = Object.entries(desc.animations as Record<string, unknown>);
      if (entries.length === 0) {
        delete desc.animations;
        result.emptyAnimationNodesRemoved += 1;
        changed = true;
      } else {
        for (const [key, value] of entries) {
          if (typeof value !== 'string' || value.length === 0) {
            result.unresolvedAnimationRefs.push(`${path}: ${key} has no valid identifier`);
            continue;
          }
          const resolves = controllerIds.has(value) || (isPlayer && VANILLA_PLAYER_CONTROLLERS.has(value))
            || clipIds.has(value) || (isPlayer && VANILLA_PLAYER_ANIMATIONS.has(value));
          if (!resolves) result.unresolvedAnimationRefs.push(`${path}: ${key} -> ${value}`);
        }
      }
    }

    // 2. scripts.animate — keep unresolved activation entries visible for validation.
    const scripts = desc.scripts;
    if (scripts && typeof scripts === 'object') {
      const animate = (scripts as Record<string, unknown>).animate;
      if (Array.isArray(animate) && animate.length === 0) {
        delete (scripts as Record<string, unknown>).animate;
        result.emptyAnimateArraysRemoved += 1;
        changed = true;
      } else if (Array.isArray(animate)) {
        const boundKeys = desc.animations && typeof desc.animations === 'object'
          ? new Set(Object.keys(desc.animations as Record<string, unknown>))
          : new Set<string>();
        for (const entry of animate) {
          if (typeof entry === 'string') {
            if (!boundKeys.has(entry)) result.unresolvedAnimateEntries.push(`${path}: ${entry}`);
            continue;
          }
          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            result.unresolvedAnimateEntries.push(`${path}: malformed scripts.animate entry`);
            continue;
          }
          const bindings = Object.entries(entry as Record<string, unknown>);
          if (bindings.length !== 1) {
            result.unresolvedAnimateEntries.push(`${path}: animate object has ${bindings.length} bindings`);
            continue;
          }
          const [name, expression] = bindings[0];
          if (!boundKeys.has(name) || typeof expression !== 'string' || !expression.trim()) {
            result.unresolvedAnimateEntries.push(`${path}: ${name} is not a valid registered activation`);
          }
        }
      }
      if (Object.keys(scripts as Record<string, unknown>).length === 0) {
        delete desc.scripts;
        changed = true;
      }
    }

    // 3. sound_effects — a custom event that does not ship plays nothing. Vanilla
    // engine events are left untouched because the engine already provides them.
    if (desc.sound_effects && typeof desc.sound_effects === 'object') {
      const kept: Record<string, string> = {};
      for (const [key, value] of Object.entries(desc.sound_effects as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        const isCustomEvent = /^[a-z0-9_]+\.[a-z0-9_.]+$/i.test(value) && !value.startsWith('mob.') && !value.startsWith('random.') && !value.startsWith('ambient.') && !value.startsWith('block.') && !value.startsWith('damage.') && !value.startsWith('item.') && !value.startsWith('ui.') && !value.startsWith('music.') && !value.startsWith('note.') && !value.startsWith('dig.');
        if (isCustomEvent && !soundEvents.has(value)) {
          result.danglingSoundEventsRemoved += 1;
          continue;
        }
        kept[key] = value;
      }
      if (Object.keys(kept).length === 0) delete desc.sound_effects;
      else desc.sound_effects = kept;
      changed = true;
    }

    if (!changed) continue;
    files[path] = JSON.stringify(doc, null, 2);
    result.filesTouched += 1;
  }

  if (result.unresolvedAnimationRefs.length > 0 || result.unresolvedAnimateEntries.length > 0) {
    options?.onLog?.(
      `[SCHEMA:UNRESOLVED] Preserved ${result.unresolvedAnimationRefs.length} animation registration(s) and ${result.unresolvedAnimateEntries.length} activation entry(ies) that could not be resolved; the final gate must block these rather than hiding them.`,
    );
  }

  return result;
}