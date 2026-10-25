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
  entityPatch: Record<string, unknown>;
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

  const entityPatch = {
    format_version: '1.20.0',
    'minecraft:entity': {
      description: {
        identifier: input.entityIdentifier,
        animations: {},
        animation_controllers: {
          autobe_switcher_gatekeeper: input.controllerIdentifier,
        },
        scripts: { animate: ['autobe_switcher_gatekeeper'] },
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

  const itemDefinition = {
    format_version: '1.20.50',
    'minecraft:item': {
      description: { identifier: input.itemIdentifier, menu_category: { category: 'items' } },
      components: {
        'minecraft:icon': { texture: 'apple' },
        'minecraft:display_name': { value: 'Animation Switcher' },
        'minecraft:max_stack_size': 1,
        'minecraft:allow_off_hand': true,
        'minecraft:use_modifiers': { use_duration: 0.1, movement_modifier: 1.0 },
      },
    },
  };

  const scriptSource = [
    `import { world } from '@minecraft/server';`,
    `const ITEM_ID = ${JSON.stringify(input.itemIdentifier)};`,
    `const PROPERTY_ID = ${JSON.stringify(input.propertyIdentifier)};`,
    `const MODE_COUNT = ${controllers.length};`,
    `world.afterEvents.itemUse.subscribe((event) => {`,
    `  if (event.itemStack.typeId !== ITEM_ID) return;`,
    `  const player = event.source;`,
    `  if (player.typeId !== 'minecraft:player') return;`,
    `  const current = Number(player.getProperty(PROPERTY_ID) ?? 0);`,
    `  player.setProperty(PROPERTY_ID, (current + 1) % MODE_COUNT);`,
    `});`,
    '',
  ].join('\\n');

  return {
    controllerId: input.controllerIdentifier,
    propertyId: input.propertyIdentifier,
    itemId: input.itemIdentifier,
    gatekeeperController,
    entityPatch,
    itemDefinition,
    scriptSource,
    stateMap,
    validationErrors: [...new Set(validationErrors)].sort(),
  };
}
