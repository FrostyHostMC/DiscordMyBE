/**
 * Synthetic Switcher artifact generator. Pure output only: no archive writes.
 * This prototype is deliberately isolated from the production merge pipeline.
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
  resourceEntityPatch: Record<string, unknown>;
  behaviorEntityPatch: Record<string, unknown>;
  itemDefinition: Record<string, unknown>;
  scriptSource: string;
  stateMap: Record<string, Record<string, string>>;
  validationErrors: string[];
}
const validIdentifier = (value: string) => /^[a-z0-9_.-]+:[a-z0-9_./-]+$/i.test(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function rewriteTransitions(
  transitions: Array<Record<string, string>> | undefined,
  stateMap: Record<string, string>,
): Array<Record<string, string>> {
  return (transitions ?? []).map((transition) => Object.fromEntries(
    Object.entries(transition).map(([condition, target]) => [condition, stateMap[target] ?? target]),
  ));
}

export function buildSwitcherArtifacts(input: SwitcherGeneratorInput): SwitcherArtifacts {
  const errors: string[] = [];
  const controllers = [...input.controllers].sort((a, b) => a.id.localeCompare(b.id));
  if (controllers.length < 2) errors.push('At least two controllers are required.');
  for (const [label, value] of [
    ['Entity', input.entityIdentifier], ['Item', input.itemIdentifier],
    ['Controller', input.controllerIdentifier], ['Property', input.propertyIdentifier],
  ]) if (!validIdentifier(value)) errors.push(`${label} identifier is malformed.`);
  if (new Set(controllers.map((c) => c.id)).size !== controllers.length) errors.push('Controller IDs must be unique.');
  for (const c of controllers) {
    if (c.scope !== 'player') errors.push(`Controller ${c.id} is not explicitly player-scoped.`);
    if (!validIdentifier(c.id)) errors.push(`Controller ID ${c.id} is malformed.`);
    if (!c.states[c.initialState]) errors.push(`Controller ${c.id} has no initial state ${c.initialState}.`);
    for (const [stateId, state] of Object.entries(c.states)) {
      for (const transition of state.transitions ?? []) for (const target of Object.values(transition)) {
        if (!c.states[target]) errors.push(`Controller ${c.id} state ${stateId} targets missing state ${target}.`);
      }
    }
  }

  const stateMap: Record<string, Record<string, string>> = {};
  const gateStates: Record<string, unknown> = {};
  controllers.forEach((c, i) => {
    const prefix = `autobe_${i}_${c.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    stateMap[c.id] = Object.fromEntries(Object.keys(c.states).sort().map((state) =>
      [state, `${prefix}_${state.replace(/[^a-zA-Z0-9_]/g, '_')}`]));
  });

  controllers.forEach((c, i) => {
    for (const [oldStateId, oldState] of Object.entries(c.states)) {
      const switchTransitions = controllers.map((candidate, index) => ({ candidate, index }))
        .filter(({ index }) => index !== i)
        .map(({ candidate, index }) => ({
          [`query.property('${input.propertyIdentifier}') == ${index}`]:
            stateMap[candidate.id][candidate.initialState],
        }));
      const source = clone(oldState);
      gateStates[stateMap[c.id][oldStateId]] = {
        ...source,
        ...(switchTransitions.length
          ? { transitions: [...switchTransitions, ...rewriteTransitions(source.transitions, stateMap[c.id])] }
          : {}),
      };
    }
  });

  const selectorState = 'autobe_selector';
  gateStates[selectorState] = {
    animations: [],
    transitions: controllers.map((c, index) => ({
      [`query.property('${input.propertyIdentifier}') == ${index}`]:
        stateMap[c.id][c.initialState],
    })),
  };

  const gatekeeperController = {
    format_version: '1.10.0',
    animation_controllers: {
      [input.controllerIdentifier]: { initial_state: selectorState, states: gateStates },
    },
  };
  // These are partial additions. Production integration must merge them into the
  // existing player entity definitions rather than replace either entity file.
  const resourceEntityPatch = {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: input.entityIdentifier,
        animations: { autobe_switcher_gatekeeper: input.controllerIdentifier },
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
            type: 'int', range: [0, Math.max(0, controllers.length - 1)], default: 0, client_sync: true,
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
    "import { world } from '@minecraft/server';",
    `const ITEM_ID = ${JSON.stringify(input.itemIdentifier)};`,
    `const PROPERTY_ID = ${JSON.stringify(input.propertyIdentifier)};`,
    `const MODE_COUNT = ${controllers.length};`,
    'world.afterEvents.itemUse.subscribe((event) => {',
    '  if (event.itemStack.typeId !== ITEM_ID) return;',
    '  const player = event.source;',
    "  if (player.typeId !== 'minecraft:player') return;",
    `  const current = Number(player.getProperty(PROPERTY_ID) ?? 0);`,
    '  player.setProperty(PROPERTY_ID, (current + 1) % MODE_COUNT);',
    '});',
    '',
  ].join('\\n');

  return {
    controllerId: input.controllerIdentifier,
    propertyId: input.propertyIdentifier,
    itemId: input.itemIdentifier,
    gatekeeperController,
    resourceEntityPatch,
    behaviorEntityPatch,
    itemDefinition,
    scriptSource,
    stateMap,
    validationErrors: [...new Set(errors)].sort(),
  };
}
