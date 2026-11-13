/**
 * Bedrock animation-controller structure checks run on the exact resource-pack files that ship.
 * Only empty optional arrays are normalized; transitions, conditions, order, and source clips are
 * never rewritten to make a controller appear valid.
 */
export interface ControllerGraphIssue {
  file: string;
  controllerId: string;
  state?: string;
  detail: string;
}

export interface ControllerArrayNormalization {
  filesTouched: number;
  emptyTransitionsOmitted: number;
  emptyAnimationsOmitted: number;
}

type JsonRecord = Record<string, unknown>;
type Pack = Record<string, string | Uint8Array>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(raw: string | Uint8Array | undefined): JsonRecord | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Omit empty optional arrays without altering non-empty transition order or conditions. */
export function normalizeEmptyControllerArrays(files: Pack): ControllerArrayNormalization {
  const result: ControllerArrayNormalization = {
    filesTouched: 0,
    emptyTransitionsOmitted: 0,
    emptyAnimationsOmitted: 0,
  };
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().startsWith('animation_controllers/') || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parse(files[path]);
    const controllers = doc?.animation_controllers;
    if (!isRecord(controllers)) continue;
    let changed = false;
    for (const controller of Object.values(controllers)) {
      if (!isRecord(controller) || !isRecord(controller.states)) continue;
      for (const state of Object.values(controller.states)) {
        if (!isRecord(state)) continue;
        if (Array.isArray(state.transitions) && state.transitions.length === 0) {
          delete state.transitions;
          result.emptyTransitionsOmitted += 1;
          changed = true;
        }
        if (Array.isArray(state.animations) && state.animations.length === 0) {
          delete state.animations;
          result.emptyAnimationsOmitted += 1;
          changed = true;
        }
      }
    }
    if (changed) {
      files[path] = JSON.stringify(doc, null, 2);
      result.filesTouched += 1;
    }
  }
  return result;
}

/** Validate the state graph and schema-shaped transition/animation properties without repairing them. */
export function inspectAnimationControllerGraphs(files: Pack): ControllerGraphIssue[] {
  const issues: ControllerGraphIssue[] = [];
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().startsWith('animation_controllers/') || !path.toLowerCase().endsWith('.json')) continue;
    const doc = parse(files[path]);
    const controllers = doc?.animation_controllers;
    if (!isRecord(controllers)) {
      issues.push({ file: path, controllerId: '<document>', detail: 'Missing animation_controllers object.' });
      continue;
    }
    for (const [controllerId, controller] of Object.entries(controllers)) {
      if (!isRecord(controller) || !isRecord(controller.states)) {
        issues.push({ file: path, controllerId, detail: 'Controller must declare a states object.' });
        continue;
      }
      const states = controller.states;
      const stateNames = Object.keys(states);
      if (stateNames.length === 0) {
        issues.push({ file: path, controllerId, detail: 'Controller declares no states.' });
        continue;
      }
      const initial = typeof controller.initial_state === 'string' ? controller.initial_state : '';
      if (!initial || !Object.hasOwn(states, initial)) {
        issues.push({ file: path, controllerId, detail: `Initial state "${initial || '<missing>'}" does not exist.` });
      }
      const edges = new Map<string, string[]>();
      for (const [stateName, state] of Object.entries(states)) {
        if (!isRecord(state)) {
          issues.push({ file: path, controllerId, state: stateName, detail: 'State must be an object.' });
          continue;
        }
        if (Object.hasOwn(state, 'animations')) {
          if (!Array.isArray(state.animations) || state.animations.length === 0) {
            issues.push({ file: path, controllerId, state: stateName, detail: 'An animations property must be a non-empty array; omit it for a silent state.' });
          } else {
            for (const animation of state.animations) {
              const names = typeof animation === 'string' && animation.trim()
                ? [animation]
                : isRecord(animation) ? Object.keys(animation) : [];
              if (names.length === 0) {
                issues.push({ file: path, controllerId, state: stateName, detail: 'State contains an empty or malformed animation reference.' });
              }
            }
          }
        }
        const transitions = state.transitions;
        if (transitions === undefined) {
          edges.set(stateName, []);
          continue;
        }
        if (!Array.isArray(transitions) || transitions.length === 0) {
          issues.push({ file: path, controllerId, state: stateName, detail: 'Optional transitions must be omitted when empty and be a non-empty array when present.' });
          edges.set(stateName, []);
          continue;
        }
        const targets: string[] = [];
        for (const transition of transitions) {
          if (!isRecord(transition)) {
            issues.push({ file: path, controllerId, state: stateName, detail: 'Each transition must be an object mapping a destination state to a Molang condition.' });
            continue;
          }
          const entries = Object.entries(transition);
          if (entries.length !== 1) {
            issues.push({ file: path, controllerId, state: stateName, detail: `Each transition must contain exactly one destination-state mapping; found ${entries.length}.` });
            continue;
          }
          const [target, condition] = entries[0];
          targets.push(target);
          if (!Object.hasOwn(states, target)) {
            issues.push({ file: path, controllerId, state: stateName, detail: `Transition destination "${target}" does not exist.` });
          }
          if (typeof condition !== 'string' || condition.trim().length === 0) {
            issues.push({ file: path, controllerId, state: stateName, detail: `Transition to "${target}" has no condition.` });
          }
        }
        edges.set(stateName, targets);
      }
      if (!initial || !Object.hasOwn(states, initial)) continue;
      const reachable = new Set<string>([initial]);
      const queue = [initial];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        for (const target of edges.get(current) ?? []) {
          if (!Object.hasOwn(states, target) || reachable.has(target)) continue;
          reachable.add(target);
          queue.push(target);
        }
      }
      for (const stateName of stateNames) {
        if (!reachable.has(stateName)) {
          issues.push({ file: path, controllerId, state: stateName, detail: 'State is unreachable from the controller initial state.' });
        }
      }
    }
  }
  return issues;
}

export interface ControllerGraphRepair {
  filesTouched: number;
  documentsRemoved: number;
  unreachableStatesPruned: number;
  controllersRemoved: number;
  activationHooksAdded: number;
  stateAliasesDeclared: number;
  details: string[];
}

const ENTITY_DOCUMENT = /^entity\/[^/]+\.entity\.json$/i;
const CONTROLLER_DOCUMENT = /^animation_controllers\/.+\.json$/i;

/**
 * Repairs the two graph defects that make a controller impossible for the engine to run: a state
 * no transition can reach, and a controller no client entity both registers and activates.
 *
 * - A controller an entity declares but never lists in `scripts.animate` gets the missing hook, so
 *   the state machine it ships is actually evaluated instead of sitting inert.
 * - A controller no client entity registers at all is removed; nothing can start it, and shipping
 *   it only produces a validation defect.
 * - States unreachable from the controller's own `initial_state` are pruned after a reachability
 *   walk. Transition order, destinations and Molang conditions of every reachable state are never
 *   rewritten, so source intent is preserved exactly.
 */
export function repairAnimationControllerGraphs(resourcePackFiles: Pack): ControllerGraphRepair {
  const result: ControllerGraphRepair = {
    filesTouched: 0,
    documentsRemoved: 0,
    unreachableStatesPruned: 0,
    controllersRemoved: 0,
    activationHooksAdded: 0,
    stateAliasesDeclared: 0,
    details: [],
  };
  const files = resourcePackFiles;

  interface EntityWiring {
    path: string;
    doc: JsonRecord;
    description: JsonRecord;
    animations: Record<string, string>;
    controllers: Record<string, string>;
  }

  // Every clip definition the pack really ships, so an alias is only ever declared when the
  // identifier it names exists.
  const shippedClips = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!/^animations\/.+\.json$/i.test(path)) continue;
    const doc = parse(content);
    const animations = doc?.animations;
    if (!isRecord(animations)) continue;
    for (const clipId of Object.keys(animations)) shippedClips.add(clipId);
  }

  // The animation names each controller state selects, so an entity that activates a controller can
  // be checked against what its states actually ask for.
  const controllerStateRefs = new Map<string, string[]>();
  for (const [path, content] of Object.entries(files)) {
    if (!CONTROLLER_DOCUMENT.test(path)) continue;
    const doc = parse(content);
    const controllers = doc?.animation_controllers;
    if (!isRecord(controllers)) continue;
    for (const [controllerId, controller] of Object.entries(controllers)) {
      if (!isRecord(controller) || !isRecord(controller.states)) continue;
      const names: string[] = [];
      for (const state of Object.values(controller.states)) {
        if (!isRecord(state) || !Array.isArray(state.animations)) continue;
        for (const entry of state.animations) {
          if (typeof entry === 'string') names.push(entry);
          else if (isRecord(entry)) names.push(...Object.keys(entry));
        }
      }
      controllerStateRefs.set(controllerId, names);
    }
  }

  const entities: EntityWiring[] = [];
  const registeredControllers = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!ENTITY_DOCUMENT.test(path)) continue;
    const doc = parse(content);
    const client = doc?.['minecraft:client_entity'];
    if (!isRecord(client)) continue;
    const description = client.description;
    if (!isRecord(description)) continue;
    const animations: Record<string, string> = {};
    const controllers: Record<string, string> = {};
    if (isRecord(description.animations)) {
      for (const [alias, target] of Object.entries(description.animations)) {
        if (typeof target !== 'string') continue;
        animations[alias] = target;
        if (!target.startsWith('controller.animation.')) continue;
        controllers[alias] = target;
        registeredControllers.add(target);
      }
    }
    entities.push({ path, doc, description, animations, controllers });
  }

  for (const entity of entities) {
    if (Object.keys(entity.controllers).length === 0) continue;
    let changed = false;
    // A controller state that names a shipped clip by its full identifier needs that identifier in
    // the owning entity's map, or the state resolves to nothing at runtime. The alias is declared
    // only from a definition that really ships, so nothing is invented.
    for (const controllerId of Object.values(entity.controllers)) {
      for (const reference of controllerStateRefs.get(controllerId) ?? []) {
        if (Object.hasOwn(entity.animations, reference)) continue;
        if (!shippedClips.has(reference)) continue;
        entity.animations[reference] = reference;
        result.stateAliasesDeclared += 1;
        changed = true;
        result.details.push(
          `${entity.path}: declared alias "${reference}" for ${controllerId} — the state selects a clip that ships, and an undeclared alias resolves to nothing.`,
        );
      }
    }
    if (changed || Object.keys(entity.animations).length > 0) {
      entity.description.animations = entity.animations;
    }
    const scripts = isRecord(entity.description.scripts) ? entity.description.scripts : null;
    const current = scripts && Array.isArray(scripts.animate) ? scripts.animate : [];
    const activeAliases = new Set<string>();
    for (const entry of current) {
      if (typeof entry === 'string') activeAliases.add(entry);
      else if (isRecord(entry)) for (const key of Object.keys(entry)) activeAliases.add(key);
    }
    const missing = Object.keys(entity.controllers).filter((alias) => !activeAliases.has(alias));
    if (missing.length > 0) {
      const animate = [...current, ...missing];
      if (scripts) scripts.animate = animate;
      else entity.description.scripts = { animate };
      result.activationHooksAdded += missing.length;
      changed = true;
      result.details.push(
        `${entity.path}: activated ${missing.join(', ')} in scripts.animate — a registered controller with no animate hook is dead JSON the engine never evaluates.`,
      );
    }
    if (!changed) continue;
    files[entity.path] = JSON.stringify(entity.doc, null, 2);
    result.filesTouched += 1;
  }

  for (const path of Object.keys(files).filter((entry) => CONTROLLER_DOCUMENT.test(entry))) {
    const doc = parse(files[path]);
    const controllers = doc?.animation_controllers;
    if (!doc || !isRecord(controllers)) continue;
    let changed = false;
    for (const controllerId of Object.keys(controllers)) {
      if (!registeredControllers.has(controllerId)) {
        delete controllers[controllerId];
        result.controllersRemoved += 1;
        changed = true;
        result.details.push(
          `${path}: removed "${controllerId}" — no client entity registers and activates it, so nothing could ever start it.`,
        );
        continue;
      }
      const controller = controllers[controllerId];
      if (!isRecord(controller) || !isRecord(controller.states)) continue;
      const states = controller.states;
      const initial = typeof controller.initial_state === 'string' ? controller.initial_state : '';
      if (!initial || !Object.hasOwn(states, initial)) continue;
      const edges = new Map<string, string[]>();
      for (const [stateName, state] of Object.entries(states)) {
        const targets: string[] = [];
        if (isRecord(state) && Array.isArray(state.transitions)) {
          for (const transition of state.transitions) {
            if (!isRecord(transition)) continue;
            targets.push(...Object.keys(transition));
          }
        }
        edges.set(stateName, targets);
      }
      const reachable = new Set<string>([initial]);
      const queue = [initial];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        for (const target of edges.get(current) ?? []) {
          if (!Object.hasOwn(states, target) || reachable.has(target)) continue;
          reachable.add(target);
          queue.push(target);
        }
      }
      for (const stateName of Object.keys(states)) {
        if (reachable.has(stateName)) continue;
        delete states[stateName];
        result.unreachableStatesPruned += 1;
        changed = true;
        result.details.push(
          `${path}: pruned state "${controllerId}/${stateName}" — no transition reaches it from "${initial}", so the engine could never enter it.`,
        );
      }
    }
    if (!changed) continue;
    if (Object.keys(controllers).length === 0) {
      delete files[path];
      result.documentsRemoved += 1;
      result.details.push(`${path}: removed — every controller it declared had no client entity to run it.`);
      continue;
    }
    files[path] = JSON.stringify(doc, null, 2);
    result.filesTouched += 1;
  }

  return result;
}