/**
 * Animation dependency reconstruction.
 *
 * After every writer has run, the pack must be internally consistent: an identifier an entity
 * registers has to exist, an `scripts.animate` entry has to name a declared key, and a controller
 * state has to select a clip the pack really defines. Anything left pointing at nothing is a
 * runtime fault that Bedrock reports once and then ignores — the exact silent failure mode that
 * makes a pack look correct while nothing animates.
 *
 * This pass is read-only. Nothing is invented or deleted: source registrations, controller states,
 * sound cues and particle cues remain in place while unresolved dependency edges are reported.
 */

import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';
import {
  buildAnimationResourceRegistry,
  assertAnimationResourceRegistryCurrent,
  type AnimationResourceRegistry,
} from '@/utils/animationResourceRegistry';

export type AnimationDependencyClassification =
  | 'resolved_faithfully'
  | 'resolved_adapted'
  | 'unsupported'
  | 'missing'
  | 'invalid';

export interface AnimationDependencyEdge {
  kind: 'entity-registration' | 'runtime-activation' | 'controller-state' | 'controller-transition';
  source: string;
  target: string;
  classification: AnimationDependencyClassification;
  sourcePath: string;
  targetPath?: string;
  detail: string;
}

export interface AnimationDependencyReport {
  clipsDefined: number;
  controllersDefined: number;
  entityReferencesChecked: number;
  controllerReferencesChecked: number;
  unresolvedEntityAnimationRefs: string[];
  unresolvedAnimateEntries: string[];
  unresolvedControllerAnimationRefs: string[];
  unresolvedSoundRefs: string[];
  unresolvedParticleRefs: string[];
  unresolvedBoneRefs: string[];
  dependencyGraph: AnimationDependencyEdge[];
  notes: string[];
  summary: string;
}

function parseDocument(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function collectClipIds(files: Record<string, string | Uint8Array>): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const doc = parseDocument(files[path]);
    for (const id of Object.keys(doc?.animations ?? {})) ids.add(id);
  }
  return ids;
}

function collectControllerIds(files: Record<string, string | Uint8Array>): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const doc = parseDocument(files[path]);
    for (const id of Object.keys(doc?.animation_controllers ?? {})) ids.add(id);
  }
  return ids;
}

function collectDefinitionPaths(
  files: Record<string, string | Uint8Array>,
  suffix: string,
  rootKey: 'animations' | 'animation_controllers',
): Map<string, string> {
  const paths = new Map<string, string>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith(suffix)) continue;
    const doc = parseDocument(files[path]);
    const definitions = doc?.[rootKey];
    if (!definitions || typeof definitions !== 'object') continue;
    for (const id of Object.keys(definitions)) if (!paths.has(id)) paths.set(id, path);
  }
  return paths;
}



function collectIdsFromFolder(
  files: Record<string, string | Uint8Array>,
  prefix: string,
  key: string,
): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix) || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parseDocument(files[path]);
    for (const id of Object.keys(doc?.[key] ?? {})) ids.add(id);
  }
  return ids;
}

function collectParticleIdentifiers(files: Record<string, string | Uint8Array>): Set<string> {
  const ids = new Set<string>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith('particles/') || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parseDocument(files[path]);
    const identifier = doc?.particle_effect?.description?.identifier;
    if (typeof identifier === 'string' && identifier.trim()) ids.add(identifier.trim());
    for (const key of Object.keys(doc?.particle_effect ?? {})) ids.add(key);
  }
  return ids;
}



export function reconstructAnimationDependencies(input: {
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles?: Record<string, string | Uint8Array>;
  registry?: AnimationResourceRegistry;
  onLog?: (line: string) => void;
}): AnimationDependencyReport {
  const { resourcePackFiles } = input;
  const log = (line: string) => input.onLog?.(line);
  const registry = input.registry ?? buildAnimationResourceRegistry({
    resourcePackFiles,
    behaviorPackFiles: input.behaviorPackFiles,
  });
  assertAnimationResourceRegistryCurrent(registry, {
    resourcePackFiles,
    behaviorPackFiles: input.behaviorPackFiles,
  });
  const clips = collectClipIds(resourcePackFiles);
  const controllers = collectControllerIds(resourcePackFiles);
  const clipPaths = collectDefinitionPaths(resourcePackFiles, '.animation.json', 'animations');
  const controllerPaths = collectDefinitionPaths(resourcePackFiles, '.animation_controllers.json', 'animation_controllers');
  const sounds = collectIdsFromFolder(resourcePackFiles, 'sounds/', 'sound_definitions');
  const particles = collectParticleIdentifiers(resourcePackFiles);

  const report: AnimationDependencyReport = {
    clipsDefined: registry.metrics.clipsDefined,
    controllersDefined: registry.metrics.controllersDefined,
    entityReferencesChecked: 0,
    controllerReferencesChecked: 0,
    unresolvedEntityAnimationRefs: [],
    unresolvedAnimateEntries: [],
    unresolvedControllerAnimationRefs: [],

    unresolvedSoundRefs: [],
    unresolvedParticleRefs: [],
    unresolvedBoneRefs: [...registry.metrics.bones.unresolved],
    dependencyGraph: [],
    notes: [],
    summary: '',
  };

  const resolves = (id: string, isPlayer = false): boolean => {
    if (id.startsWith('controller.animation.')) {
      return controllers.has(id) || (isPlayer && isKnownVanillaPlayerAnimationReference(id));
    }
    if (id.startsWith('animation.')) {
      return clips.has(id) || (isPlayer && isKnownVanillaPlayerAnimationReference(id));
    }
    return false;
  };

  const addEdge = (edge: AnimationDependencyEdge): void => {
    report.dependencyGraph.push(edge);
  };

  const controllerOwners = new Map<string, Array<{
    path: string;
    animations: Record<string, unknown>;
    isPlayer: boolean;
    active: boolean;
  }>>();
  // 1. Client entities: preserve registrations and activation entries, and record any unresolved edges.
  for (const path of Object.keys(resourcePackFiles)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const doc = parseDocument(resourcePackFiles[path]);
    const description = doc?.['minecraft:client_entity']?.description;
    if (!description || typeof description !== 'object') continue;

    const animations = description.animations && typeof description.animations === 'object'
      ? description.animations as Record<string, unknown>
      : {};
    const isPlayerEntity = description.identifier === 'minecraft:player';
    const activeAliases = new Set<string>();
    const animateEntries = Array.isArray(description.scripts?.animate)
      ? description.scripts.animate as unknown[]
      : [];
    for (const entry of animateEntries) {
      const names = typeof entry === 'string'
        ? [entry]
        : entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.keys(entry as Record<string, unknown>)
          : [];
      for (const name of names) activeAliases.add(name);
    }

    for (const [alias, target] of Object.entries(animations)) {
      report.entityReferencesChecked += 1;
      const isString = typeof target === 'string';
      const resolved = isString && resolves(target, isPlayerEntity);
      const targetPath = isString && target.startsWith('controller.animation.')
        ? controllerPaths.get(target)
        : isString && target.startsWith('animation.')
          ? clipPaths.get(target)
          : undefined;
      addEdge({
        kind: 'entity-registration',
        source: `${path}#animations.${alias}`,
        target: String(target),
        classification: resolved
          ? targetPath ? 'resolved_faithfully' : 'resolved_adapted'
          : isString ? 'missing' : 'invalid',
        sourcePath: path,
        ...(targetPath ? { targetPath } : {}),
        detail: resolved
          ? targetPath ? 'The registered identifier resolves to a definition in this resource pack.' : 'The player registration resolves to a known engine-provided resource.'
          : 'The registration does not resolve to a definition of the correct animation or controller type.',
      });
      if (!resolved) {
        report.unresolvedEntityAnimationRefs.push(`${path}: ${alias} -> ${String(target)}`);
      }
      if (isString && target.startsWith('controller.animation.')) {
        const owners = controllerOwners.get(target) ?? [];
        owners.push({
          path,
          animations,
          isPlayer: isPlayerEntity,
          active: activeAliases.has(alias),
        });
        controllerOwners.set(target, owners);
      }
    }

    for (const entry of animateEntries) {
      report.entityReferencesChecked += 1;
      const names = typeof entry === 'string'
        ? [entry]
        : entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.keys(entry as Record<string, unknown>)
          : [];
      if (names.length === 0) {
        report.unresolvedAnimateEntries.push(`${path}: malformed scripts.animate entry`);
        continue;
      }
      for (const name of names) {
        const registered = Object.hasOwn(animations, name);
        addEdge({
          kind: 'runtime-activation',
          source: `${path}#scripts.animate`,
          target: name,
          classification: registered ? 'resolved_faithfully' : 'missing',
          sourcePath: path,
          detail: registered
            ? 'The animation alias is named by scripts.animate.'
            : 'The activation entry names no animation alias registered by this client entity.',
        });
        if (!registered) report.unresolvedAnimateEntries.push(`${path}: ${name} is not registered on this entity`);
      }
    }
  }

  // 2. Controllers: preserve every state animation reference and report missing definitions.
  for (const path of Object.keys(resourcePackFiles)) {
    if (!path.toLowerCase().endsWith('.animation_controllers.json')) continue;
    const doc = parseDocument(resourcePackFiles[path]);
    const controllerMap = doc?.animation_controllers;
    if (!controllerMap || typeof controllerMap !== 'object') continue;
    for (const [controllerId, body] of Object.entries(controllerMap as Record<string, any>)) {
      const states = body?.states;
      if (!states || typeof states !== 'object') continue;
      const stateNames = new Set(Object.keys(states));
      const owners = controllerOwners.get(controllerId) ?? [];
      const activeOwners = owners.filter((owner) => owner.active);
      if (owners.length === 0) {
        report.unresolvedControllerAnimationRefs.push(
          `${controllerId}: no client entity registers this controller, so it has no resolving context`,
        );
      } else if (activeOwners.length === 0) {
        report.unresolvedControllerAnimationRefs.push(
          `${controllerId}: registered by a client entity but not activated by its scripts.animate entries`,
        );
      }
      for (const [stateName, state] of Object.entries(states as Record<string, any>)) {
        const statePath = `${path}#${controllerId}/states.${stateName}`;
        const transitions = state && typeof state === 'object' ? state.transitions : undefined;
        if (Array.isArray(transitions)) {
          for (const transition of transitions) {
            const entries = transition && typeof transition === 'object' && !Array.isArray(transition)
              ? Object.entries(transition as Record<string, unknown>)
              : [];
            for (const [destination, condition] of entries) {
              const valid = entries.length === 1 && stateNames.has(destination)
                && typeof condition === 'string' && condition.trim().length > 0;
              addEdge({
                kind: 'controller-transition',
                source: statePath,
                target: `${controllerId}/states.${destination}`,
                classification: valid ? 'resolved_faithfully' : 'invalid',
                sourcePath: path,
                targetPath: valid ? path : undefined,
                detail: valid
                  ? `Transition condition is present and destination state "${destination}" exists.`
                  : `Transition structure or destination "${destination}" is invalid.`,
              });
            }
          }
        }
        if (!Array.isArray(state?.animations)) continue;
        for (const entry of state.animations as unknown[]) {
          report.controllerReferencesChecked += 1;
          const names = typeof entry === 'string'
            ? [entry]
            : entry && typeof entry === 'object' && !Array.isArray(entry)
              ? Object.keys(entry as Record<string, unknown>)
              : [];
          if (names.length === 0) {
            report.unresolvedControllerAnimationRefs.push(`${controllerId}/${stateName}: malformed animation reference`);
            continue;
          }
          for (const name of names) {
            if (owners.length === 0) {
              report.unresolvedControllerAnimationRefs.push(`${controllerId}/${stateName}: no client entity registers this controller, so alias "${name}" has no resolving context`);
              addEdge({
                kind: 'controller-state',
                source: statePath,
                target: name,
                classification: 'missing',
                sourcePath: path,
                detail: 'No entity alias map exists to resolve this controller-state animation reference.',
              });
              continue;
            }
            for (const owner of owners) {
              const target = owner.animations[name];
              const valid = typeof target === 'string' && target.startsWith('animation.')
                && resolves(target, owner.isPlayer);
              const targetPath = typeof target === 'string' ? clipPaths.get(target) : undefined;
              addEdge({
                kind: 'controller-state',
                source: `${statePath} (${owner.path})`,
                target: typeof target === 'string' ? target : name,
                classification: valid
                  ? targetPath ? 'resolved_faithfully' : 'resolved_adapted'
                  : typeof target === 'string' ? 'missing' : 'missing',
                sourcePath: path,
                ...(targetPath ? { targetPath } : {}),
                detail: valid
                  ? `State alias "${name}" resolves through the owning entity registration to an exported animation definition.`
                  : `State alias "${name}" does not resolve to an animation definition in this controller's owning entity.`,
              });
              if (!valid) {
                report.unresolvedControllerAnimationRefs.push(
                  `${owner.path}: ${controllerId}/${stateName} alias "${name}" -> ${String(target ?? '<missing alias>')}`,
                );
              }
            }
          }
        }
      }
    }
  }

  // 3. Cues inside clips: report the ones with no definition behind them.
  for (const path of Object.keys(resourcePackFiles)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const doc = parseDocument(resourcePackFiles[path]);
    for (const [clipId, body] of Object.entries(doc?.animations ?? {})) {
      const record = body && typeof body === 'object' ? (body as Record<string, any>) : {};
      for (const cue of Object.values(record.sound_effects ?? {})) {
        const effect = typeof cue === 'string' ? cue : typeof cue?.effect === 'string' ? cue.effect : '';
        if (!effect || effect.startsWith('minecraft:') || sounds.has(effect)) continue;
        report.unresolvedSoundRefs.push(`${clipId} -> ${effect}`);
      }
      for (const cue of Object.values(record.particle_effects ?? {})) {
        const effect = typeof cue === 'string' ? cue : typeof cue?.effect === 'string' ? cue.effect : '';
        if (!effect || effect.startsWith('minecraft:') || particles.has(effect)) continue;
        report.unresolvedParticleRefs.push(`${clipId} -> ${effect}`);
      }
    }
  }

  if (report.unresolvedEntityAnimationRefs.length > 0 || report.unresolvedAnimateEntries.length > 0) {
    report.notes.push(
      `${report.unresolvedEntityAnimationRefs.length} entity animation reference(s) and ${report.unresolvedAnimateEntries.length} activation entry(ies) remain unresolved; their source registrations were preserved for the final export gate.`,
    );
  }
  if (report.unresolvedControllerAnimationRefs.length > 0) {
    report.notes.push(
      `${report.unresolvedControllerAnimationRefs.length} controller state animation reference(s) remain unresolved; no source clip or state was removed.`,
    );
  }
  if (report.unresolvedBoneRefs.length > 0) {
    report.notes.push(
      `${report.unresolvedBoneRefs.length} bone track(s) animate a bone the bound geometry does not declare; they are reported, never renamed onto a guessed bone.`,
    );
  }

  report.summary =
    `Animation dependencies: ${report.clipsDefined} clip(s) and ${report.controllersDefined} controller(s) defined; ` +
    `${report.entityReferencesChecked} entity activation reference(s) and ${report.controllerReferencesChecked} controller selection(s) inspected. ` +
    `${report.unresolvedEntityAnimationRefs.length + report.unresolvedAnimateEntries.length + report.unresolvedControllerAnimationRefs.length} unresolved animation dependency edge(s) preserved, ` +
    `${report.unresolvedBoneRefs.length} unresolved bone track(s), ${report.unresolvedSoundRefs.length} unresolved sound cue(s), ${report.unresolvedParticleRefs.length} unresolved particle cue(s).`;
  log(`[ANIM:DEPS] ${report.summary}`);
  return report;
}