import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';
import { safeFileId } from '@/utils/bedrockIds';
import { translateMolangExpression } from '@/utils/molangCompatibility';
import { findPlayerClientEntityPath } from '@/utils/vanillaPlayerBaseline';

/**
 * Active player wiring enforcement.
 *
 * A pack can ship perfectly converted animation documents, generate controllers and register clips,
 * and still make the player animate exactly like vanilla in game. That happens for one reason only:
 * `entity/player.entity.json` — the file that overrides the vanilla player definition — does not
 * actually point at the generated content. Because a pack override REPLACES the whole vanilla file,
 * Bedrock then has a player whose definition never asks for the ported animations, so the engine
 * quietly falls back to the built-in locomotion and reports nothing.
 *
 * This pass runs on the exact file map that is about to be zipped and closes that gap:
 *
 *  1. every player-scoped animation controller that ships on disk is registered in the entity's
 *     `animations` map and hooked into `scripts.animate` (the controller path is logged, so the
 *     activation chain is visible instead of assumed);
 *  2. every ported player clip that ships on disk is registered, so a clip can never exist in the
 *     archive while nothing references it;
 *  3. every Molang string in the player entity is checked in the player client-entity context and
 *     rewritten into a supported equivalent — an unsupported query is reported, never silently
 *     replaced with a constant;
 *  4. controller definitions are validated: initial state, non-empty states and animation ids that
 *     really exist in a shipped animation document;
 *  5. geometry and render controllers the entity references are resolved against what ships (the
 *     vanilla player render controllers are part of the engine contract and stay valid).
 *
 * Nothing here invents content: it re-points the player definition at the files the port already
 * produced, and it reports anything it cannot resolve instead of claiming success.
 */

export interface PlayerWiringEnforcementReport {
  playerEntityFound: boolean;
  playerEntityFile: string | null;
  controllersShipped: number;
  controllersPlayerScoped: string[];
  /** Controllers whose hook was already present before this pass. */
  controllersAlreadyHooked: string[];
  /** Controllers this pass hooked into `scripts.animate`, with the document they live in. */
  controllersInjected: Array<{ controller: string; controllerPath: string }>;
  controllersMissing: string[];
  controllerDefects: string[];
  clipsShipped: number;
  animationAliasesDeclared: number;
  clipsRegisteredInjected: string[];
  animateEntries: number;
  molangExpressionsChecked: number;
  molangRewritten: number;
  molangUnresolved: string[];
  /** Equipped-item calls whose slot argument has no valid destination form (rejected, not replaced). */
  molangInvalidCalls: string[];
  renderControllersReferenced: string[];
  renderControllersMissing: string[];
  geometriesReferenced: string[];
  geometriesMissing: string[];
  /** Findings that must block a clean compatibility status. */
  blocking: string[];
  notes: string[];
  summary: string;
}

/**
 * Render controllers the vanilla player definition declares. A resource pack that overrides only
 * `entity/player.entity.json` leaves the engine's own render controllers in place, so referencing
 * these is correct, not missing.
 */
const VANILLA_PLAYER_RENDER_CONTROLLERS = new Set([
  'controller.render.player.first_person',
  'controller.render.player.third_person',
  'controller.render.player.cape',
  'controller.render.player.armor',
  'controller.render.player.map',
]);

/** Player geometries the engine already provides; a ported skin rig is allowed to reuse them. */
const VANILLA_PLAYER_GEOMETRY = new Set([
  'geometry.humanoid.custom',
  'geometry.humanoid.customSlim',
  'geometry.cape',
  'geometry.player.armor',
]);

const MOLANG_TEST = /(?:query|variable|temp|context)\./i;
const PLAYER_ENTITY_PATH = 'entity/player.entity.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function lastSegment(identifier: string): string {
  const parts = identifier.split(/[.:/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : identifier;
}

/** Rewrites every Molang string in a document that the player context cannot evaluate. */
function walkMolang(node: unknown, visit: (value: string) => string): unknown {
  if (typeof node === 'string') return MOLANG_TEST.test(node) ? visit(node) : node;
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((entry) => {
      const value = walkMolang(entry, visit);
      if (value !== entry) changed = true;
      return value;
    });
    return changed ? next : node;
  }
  if (isRecord(node)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const next = walkMolang(value, visit);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return changed ? out : node;
  }
  return node;
}

function collectRenderControllerRefs(node: unknown): string[] {
  const out: string[] = [];
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) {
    for (const entry of node) out.push(...collectRenderControllerRefs(entry));
  } else if (isRecord(node)) {
    const controllers = node.controllers ?? node.render_controllers;
    if (controllers !== undefined) {
      out.push(...collectRenderControllerRefs(controllers));
    } else {
      out.push(...Object.keys(node).filter((key) => key.startsWith('controller.')));
    }
  }
  return out;
}

function collectGeometryRefs(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((entry) => collectGeometryRefs(entry));
  if (isRecord(node)) return Object.values(node).flatMap((entry) => collectGeometryRefs(entry));
  return [];
}

export function enforcePlayerWiring(input: {
  modId: string;
  resourcePackFiles: Record<string, string | Uint8Array>;
  onLog?: (line: string) => void;
}): PlayerWiringEnforcementReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;

  // What the pack really ships, read from the documents themselves.
  const shippedClips = new Map<string, string>();
  const shippedControllers = new Map<string, string>();
  const shippedRenderControllers = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !path.endsWith('.json')) continue;
    const lower = path.toLowerCase();
    if (lower.endsWith('.animation_controllers.json')) {
      const doc = parseJson(content);
      const controllers = doc?.animation_controllers;
      if (isRecord(controllers)) {
        for (const id of Object.keys(controllers)) shippedControllers.set(id, path);
      }
    } else if (lower.endsWith('.animation.json')) {
      const doc = parseJson(content);
      const animations = doc?.animations;
      if (isRecord(animations)) {
        for (const id of Object.keys(animations)) shippedClips.set(id, path);
      }
    } else if (lower.endsWith('.render_controllers.json')) {
      const doc = parseJson(content);
      const controllers = doc?.render_controllers;
      if (isRecord(controllers)) {
        for (const id of Object.keys(controllers)) shippedRenderControllers.add(id);
      }
    }
  }

  const report: PlayerWiringEnforcementReport = {
    playerEntityFound: false,
    playerEntityFile: null,
    controllersShipped: shippedControllers.size,
    controllersPlayerScoped: [],
    controllersAlreadyHooked: [],
    controllersInjected: [],
    controllersMissing: [],
    controllerDefects: [],
    clipsShipped: shippedClips.size,
    animationAliasesDeclared: 0,
    clipsRegisteredInjected: [],
    animateEntries: 0,
    molangExpressionsChecked: 0,
    molangRewritten: 0,
    molangUnresolved: [],
    molangInvalidCalls: [],
    renderControllersReferenced: [],
    renderControllersMissing: [],
    geometriesReferenced: [],
    geometriesMissing: [],
    blocking: [],
    notes: [],
    summary: '',
  };

  // Prefer the entity declaring minecraft:player; merged archives may retain nested pack paths.
  const entityPath = findPlayerClientEntityPath(files) ?? Object.keys(files).find((path) => path.toLowerCase() === PLAYER_ENTITY_PATH);
  const rawEntity = entityPath ? files[entityPath] : undefined;
  const doc = parseJson(rawEntity);
  const clientEntity = doc?.['minecraft:client_entity'];
  const description = isRecord(clientEntity) ? clientEntity.description : undefined;
  if (!entityPath || !isRecord(description)) {
    report.summary = shippedClips.size > 0
      ? `No player client entity file ships, so the ${shippedClips.size} animation document(s) in the pack cannot reach the player: nothing re-points the vanilla player definition at them.`
      : 'No player client entity file ships and no animation document requires one.';
    log(`[WIRE:ENFORCE:WARN] ${report.summary}`);
    return report;
  }

  report.playerEntityFound = true;
  report.playerEntityFile = entityPath;
  const animations: Record<string, unknown> = isRecord(description.animations) ? description.animations : {};
  const scripts: Record<string, unknown> = isRecord(description.scripts) ? description.scripts : {};
  const animate: unknown[] = Array.isArray(scripts.animate) ? [...scripts.animate] : [];
  const usedShortNames = new Set(Object.keys(animations));
  const registeredIds = new Set(
    Object.values(animations).filter((value): value is string => typeof value === 'string'),
  );

  /** Registers a document in `animations` and returns the short name the engine resolves. */
  const registerShortName = (identifier: string, preferred: string): { short: string; added: boolean } => {
    for (const [short, value] of Object.entries(animations)) {
      if (value === identifier) return { short, added: false };
    }
    let short = preferred || lastSegment(identifier) || 'entry';
    let index = 2;
    while (usedShortNames.has(short) && animations[short] !== identifier) {
      short = `${preferred}_${index}`;
      index += 1;
    }
    usedShortNames.add(short);
    animations[short] = identifier;
    registeredIds.add(identifier);
    return { short, added: true };
  };

  // 1. Controller ownership comes from the player entity's actual registration map, never from
  // controller or file names. A shipped controller that is not registered is left untouched and
  // will be reported by the dependency audit rather than guessed onto the player.
  const playerControllers = [...new Set(
    Object.values(animations).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('controller.animation.'),
    ),
  )].flatMap((controllerId) => {
    const controllerPath = shippedControllers.get(controllerId);
    return controllerPath ? [[controllerId, controllerPath] as const] : [];
  });
  report.controllersPlayerScoped = playerControllers.map(([id]) => id);
  const animateStrings = new Set(
    animate.filter((entry): entry is string => typeof entry === 'string'),
  );

  for (const [controllerId, controllerPath] of playerControllers) {
    const { short, added } = registerShortName(controllerId, safeFileId(lastSegment(controllerId)) || 'controller');
    if (addShortToAnimate(animate, animateStrings, short)) {
      report.controllersInjected.push({ controller: controllerId, controllerPath });
      log(
        `[WIRE:ENFORCE] Hooked ${controllerId} into scripts.animate as "${short}" (controller_path: ${controllerPath}). Without this entry the generated controller is never evaluated and the player keeps its vanilla pose.`,
      );
    } else {
      report.controllersAlreadyHooked.push(controllerId);
    }
    if (added && animations[short] === controllerId) {
      log(`[WIRE:ENFORCE] Registered ${controllerId} in animations."${short}" so scripts.animate can resolve it.`);
    }
  }

  // 2. A clip is player-owned only when the player's own registration map names its identifier.
  // Unregistered documents are not attached by filename or identifier guess; the final dependency
  // graph keeps those source clips visible as missing registrations instead of misbinding a mob rig.
  // 3. Molang context validation on the player definition itself.
  const rewritten = walkMolang(description, (value) => {
    report.molangExpressionsChecked += 1;
    const translation = translateMolangExpression(value, 'player_entity');
    if (translation.changes.length > 0) report.molangRewritten += 1;
    for (const entry of translation.unresolved) {
      report.molangUnresolved.push(`${entry.query} — ${entry.reason}`);
    }
    for (const entry of translation.rejected) {
      report.molangInvalidCalls.push(`${entry.call} — ${entry.reason}`);
    }
    return translation.expression;
  });
  if (isRecord(rewritten)) {
    for (const key of Object.keys(description)) delete description[key];
    Object.assign(description, rewritten);
  }
  if (report.molangUnresolved.length > 0) {
    report.blocking.push(
      `${report.molangUnresolved.length} Molang reference(s) in the player definition have no equivalent in a player client entity, so the poses that depend on them cannot fire.`,
    );
  }
  if (report.molangInvalidCalls.length > 0) {
    report.blocking.push(
      `${report.molangInvalidCalls.length} equipped-item query call(s) in the player definition use a slot argument the destination rejects; the intended hand cannot be inferred, so they are reported instead of being replaced with a constant.`,
    );
  }

  // 4. Controller definitions: initial state, states and animation ids that really exist.
  for (const [controllerId, controllerPath] of playerControllers) {
    const controllerDoc = parseJson(files[controllerPath]);
    const definition = isRecord(controllerDoc?.animation_controllers)
      ? (controllerDoc?.animation_controllers as Record<string, unknown>)[controllerId]
      : undefined;
    if (!isRecord(definition)) {
      report.controllerDefects.push(`${controllerId} is registered but its definition is not readable in ${controllerPath}.`);
      continue;
    }
    const states = definition.states;
    if (!isRecord(states) || Object.keys(states).length === 0) {
      report.controllerDefects.push(`${controllerId} declares no states, so it can never activate a clip.`);
      continue;
    }
    if (typeof definition.initial_state !== 'string' || !(definition.initial_state in states)) {
      report.controllerDefects.push(`${controllerId} declares no valid initial_state, so the engine has no starting state.`);
    }
    for (const [stateName, state] of Object.entries(states)) {
      const entries = isRecord(state) && Array.isArray(state.animations) ? state.animations : [];
      for (const entry of entries) {
        const names = typeof entry === 'string'
          ? [entry]
          : isRecord(entry) ? Object.keys(entry) : [];
        for (const alias of names) {
          const mappedTarget = animations[alias];
          if (typeof mappedTarget !== 'string') {
            report.controllerDefects.push(`${controllerId} state "${stateName}" selects "${alias}", which is not registered as an animation alias on the player entity.`);
            continue;
          }
          if (!mappedTarget.startsWith('animation.')) {
            report.controllerDefects.push(`${controllerId} state "${stateName}" selects alias "${alias}", which resolves to "${mappedTarget}" instead of an animation definition.`);
            continue;
          }
          if (shippedClips.has(mappedTarget) || isKnownVanillaPlayerAnimationReference(mappedTarget)) continue;
          report.controllerDefects.push(
            `${controllerId} state "${stateName}" selects alias "${alias}" (target ${mappedTarget}), which no animation document or known vanilla player resource defines.`,
          );
        }
      }
    }
  }
  if (report.controllerDefects.length > 0) {
    report.blocking.push(`${report.controllerDefects.length} controller definition defect(s) stop the ported states from activating.`);
  }

  // 5. Geometry and render controllers the definition references.
  report.renderControllersReferenced = [...new Set(collectRenderControllerRefs(description.render_controllers))];
  for (const controller of report.renderControllersReferenced) {
    if (shippedRenderControllers.has(controller) || VANILLA_PLAYER_RENDER_CONTROLLERS.has(controller)) continue;
    report.renderControllersMissing.push(controller);
  }
  report.geometriesReferenced = [...new Set(collectGeometryRefs(description.geometry))];
  for (const geometry of report.geometriesReferenced) {
    if (VANILLA_PLAYER_GEOMETRY.has(geometry)) continue;
    const shipped = Object.entries(files).some(
      ([path, content]) =>
        path.toLowerCase().startsWith('models/') &&
        typeof content === 'string' &&
        content.includes(`"${geometry}"`),
    );
    if (!shipped) report.geometriesMissing.push(geometry);
  }
  if (report.renderControllersMissing.length > 0) {
    report.blocking.push(
      `${report.renderControllersMissing.length} render controller reference(s) resolve to nothing, so the player renders with no controller.`,
    );
  }
  if (report.geometriesMissing.length > 0) {
    report.blocking.push(
      `${report.geometriesMissing.length} geometry reference(s) resolve to no shipped model, so the player rig has no mesh.`,
    );
  }

  report.animationAliasesDeclared = Object.keys(animations).length;
  report.animateEntries = animate.length;

  // 6. Write the enforced definition back only when it actually changed.
  scripts.animate = animate;
  description.scripts = scripts;
  description.animations = animations;
  const nextJson = JSON.stringify(doc, null, 2);
  if (nextJson !== rawEntity) files[entityPath] = nextJson;

  const hooked = report.controllersInjected.length + report.controllersAlreadyHooked.length;
  report.summary =
    `Player wiring enforcement on the exported pack: ${hooked}/${playerControllers.length} player-scoped controller(s) hooked into scripts.animate ` +
    `(${report.controllersInjected.length} injected by this pass), ${report.animationAliasesDeclared} animation-map alias(es) present ` +
    `(${report.clipsRegisteredInjected.length} adopted because the clip shipped unreferenced), ${report.molangExpressionsChecked} Molang string(s) checked in the player context ` +
    `(${report.molangRewritten} rewritten, ${report.molangUnresolved.length} with no supported equivalent), ` +
    `${report.renderControllersMissing.length + report.geometriesMissing.length} unresolved render reference(s). ` +
    (report.blocking.length === 0
      ? 'Every ported player animation now has a live activation path; actual playback still needs a Bedrock client test.'
      : `${report.blocking.length} blocking finding(s) recorded — the port is NOT reported as compatible.`);

  log(`[WIRE:ENFORCE] ${report.summary}`);
  for (const line of report.controllerDefects.slice(0, 6)) log(`[WIRE:ENFORCE:DEFECT] ${line}`);
  for (const line of report.molangUnresolved.slice(0, 6)) log(`[WIRE:ENFORCE:MOLANG] ${line}`);
  for (const line of report.notes.slice(0, 6)) log(`[WIRE:ENFORCE:NOTE] ${line}`);

  return report;
}

/** Adds a short name to `scripts.animate` once; returns true when it was actually appended. */
function addShortToAnimate(
  animate: unknown[],
  animateStrings: Set<string>,
  short: string,
  condition?: string,
): boolean {
  if (animateStrings.has(short)) return false;
  const alreadyConditional = animate.some((entry) => isRecord(entry) && short in entry);
  if (alreadyConditional) return false;
  animate.push(condition ? { [short]: condition } : short);
  animateStrings.add(short);
  return true;
}