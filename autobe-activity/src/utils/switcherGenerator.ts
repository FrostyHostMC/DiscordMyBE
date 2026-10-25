/**
 * Conservative Switcher artifact generator prototype.
 *
 * This module is deliberately pure: it accepts explicit controller/state evidence
 * and returns JSON/source artifacts without opening or modifying user archives.
 * The first supported shape is a selector that chooses one inlined controller
 * branch at a time. It is not connected to the merge pipeline.
 */
export interface SwitcherControllerInput {
  id: string;
  scope: 'player';
  initialState: string;
  states: Record<string, {
    animations?: unknown[];
    transitions?: Array<Record<string, string>>;
    on_entry?: string[];
    on_exit?: string[];
    blend_transition?: number;
    [key: string]: unknown;
  }>;
}

export interface SwitcherGeneratorInput {
  controllers: readonly SwitcherControllerInput[];
  entityIdentifier: string;
  itemIdentifier: string;
  controllerIdentifier: string;
  propertyIdentifier: string;
  scriptEntry: string;
}

export interface SwitcherArtifacts {
  controllerId: string;
  propertyId: string;
  itemId: string;
  gatekeeperController: Record<string, unknown>;
  /** Partial RP player-entity additions; must be structurally merged into the existing entity. */
  resourceEntityPatch: Record<string, unknown>;
  /** Partial BP player-entity additions; the property must be registered server-side. */
  behaviorEntityPatch: Record<string, unknown>;
  itemDefinition: Record<string, unknown>;
  scriptSource: string;
  stateMap: Record<string, Record<string, string>>;
  validationErrors: string[];
}

const validIdentifier = (value: string) => /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rewriteTransitions(
  transitions: Array<Record<string, string>> | undefined,
  stateMap: Record<string, string>,
): Array<Record<string, string>> {
  return (transitions ?? []).map((transition) => Object.fromEntries(
    Object.entries(transition).map(([condition, target]) => [condition, stateMap[target] ?? target]),
  ));
}

/**
 * Builds a synthetic gatekeeper + selector prototype only from explicitly supplied
 * controller graphs. It rejects malformed graphs rather than guessing missing states.
 */
export function buildSwitcherArtifacts(input: SwitcherGeneratorInput): SwitcherArtifacts {
  const validationErrors: string[] = [];
  const controllers = [...input.controllers].sort((a, b) => a.id.localeCompare(b.id));
  if (controllers.length < 2) validationErrors.push('At least two controllers are required to exercise switching.');
  if (!validIdentifier(input.entityIdentifier)) validationErrors.push('Entity identifier is malformed.');
  if (!validIdentifier(input.itemIdentifier)) validationErrors.push('Item identifier is malformed.');
  if (!validIdentifier(input.controllerIdentifier)) validationErrors.push('Generated controller identifier is malformed.');
  if (!validIdentifier(input.propertyIdentifier)) validationErrors.push('Generated property identifier is malformed.');
  if (new Set(controllers.map((controller) => controller.id)).size !== controllers.length) {
    validationErrors.push('Controller IDs must be unique.');
  }
  for (const controller of controllers) {
    if (controller.scope !== 'player') validationErrors.push(`Controller ${controller.id} is not explicitly player-scoped.`);
    if (!controller.states[controller.initialState]) validationErrors.push(`Controller ${controller.id} has no initial state ${controller.initialState}.`);
    for (const [stateId, state] of Object.entries(controller.states)) {
      for (const transition of state.transitions ?? []) {
        for (const target of Object.values(transition)) {
          if (!controller.states[target]) validationErrors.push(`Controller ${controller.id} state ${stateId} targets missing state ${target}.`);
        }
      }
    }
  }

  const stateMap: Record<string, Record<string, string>> = {};
  const gateStates: Record<string, unknown> = {};
  controllers.forEach((controller, controllerIndex) => {
    const prefix = `autobe_${controllerIndex}_${controller.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    stateMap[controller.id] = Object.fromEntries(Object.keys(controller.states).sort().map((stateId) => [stateId, `${prefix}_${stateId.replace(/[^a-zA-Z0-9_]/g, '_')}`]));
  });

  // Each source state is cloned and every graph edge is structurally rewritten.
  // The selector property is checked first so a mode change exits the old branch.
  controllers.forEach((controller, controllerIndex) => {
    const map = stateMap[controller.id];
    const otherBranches = controllers
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ index }) => index !== controllerIndex);
    for (const [oldStateId, oldState] of Object.entries(controller.states)) {
      const stateId = map[oldStateId];
      const source = clone(oldState);
      const switchTransitions = otherBranches.map(({ candidate, index }) => ({
        [`query.property('${input.propertyIdentifier}') == ${index}`]: stateMap[candidate.id][candidate.initialState],
      }));
      gateStates[stateId] = {
        ...source,
        ...(switchTransitions.length ? { transitions: [...switchTransitions, ...rewriteTransitions(source.transitions, map)] } : {}),
      };
    }
  });

  // A neutral state routes into the selected controller's initial state.
  const neutralState = 'autobe_selector';
  gateStates[neutralState] = {
    animations: [],
    transitions: controllers.map((controller, index) => ({
      [`query.property('${input.propertyIdentifier}') == ${index}`]: stateMap[controller.id][controller.initialState],
    })),
  };

  const gatekeeperController = {
    format_version: '1.10.0',
    animation_controllers: {
      [input.controllerIdentifier]: {
        initial_state: neutralState,
        states: gateStates,
      },
    },
  };

  // These are separate partial patches because animation/controller wiring belongs
  // in the RP player entity, while the server-authoritative custom property belongs
  // in the BP player entity. They must be merged into existing definitions, never
  // written as two competing complete minecraft:player definitions.
  const resourceEntityPatch = {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: input.entityIdentifier,
        animation_controllers: {
          autobe_switcher_gatekeeper: input.controllerIdentifier,
        },
        scripts: { animate: ['autobe_switcher_gatekeeper'] },
      },
    },
  };

  const behaviorEntityPatch = {
    format_version: '1.16.0',
    'minecraft:entity': {
      description: {
        identifier: input.entityIdentifier,
        properties: {
          [input.propertyIdentifier]: {
            type: 'int',
            range: [0, controllers.length - 1],
            default: 0,
            client_sync: true,
          },
        },
      },
    },
  };
