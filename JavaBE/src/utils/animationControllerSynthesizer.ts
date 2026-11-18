import type { DecompileClassSummary } from '@/types/remaker';
import type { JvmClassIR, JvmInstruction, JvmMethodIR } from '@/utils/jvmBytecodeIR';

/**
 * Java controller reconstruction is evidence-driven. A class name or an animation-related
 * method call is not enough to invent a Bedrock state graph. We retain bytecode and only emit
 * a controller when state constants, branch guards, target states, and clip bindings can all
 * be tied to concrete instructions.
 */
export interface ControllerSignals {
  controllerClasses?: string[];
  stateMachineClasses?: string[];
  animationIds?: string[];
  entityClasses?: DecompileClassSummary[];
  /** Full bytecode for animation-related classes and their directly referenced enum state types. */
  bytecodeClasses?: JvmClassIR[];
  /** Exact player rig classes recovered from archive evidence. */
  playerClassNames?: string[];
}

export interface SynthesizedController {
  filePath: string;
  controllerId: string;
  ownerId: string;
  sourceClass: string;
  kind: 'animation-controller' | 'state-machine';
  states: string[];
  json: string;
}

export interface ControllerSynthesis {
  controllers: SynthesizedController[];
  files: Record<string, string>;
  controllerIdsByOwner: Record<string, string[]>;
  analysis: {
    bytecodeClassesInspected: number;
    controllerCandidates: number;
    stateEnumsFound: number;
    completeGraphsRecovered: number;
    candidatesWithheld: Array<{ sourceClass: string; reason: string }>;
  };
}

const ACC_ENUM = 0x4000;
const ACC_STATIC = 0x0008;
const CONDITIONAL_BRANCHES = new Set([0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xc6, 0xc7]);
const CONTROLLER_CALL = /(?:animationcontroller|setanimation|triggeranim|stopanimation|startanimation|transitionto|setstate|setcurrentstate|changestate|animationstate|rawanimation|thenplay|thenloop|setandcontinue|playeranimator|emotecraft|geckolib)/i;

function cleanIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '') || 'controller';
}

function isEnumStateClass(item: JvmClassIR): boolean {
  return (item.access & ACC_ENUM) !== 0 ||
    item.fields.some((field) => (field.access & ACC_ENUM) !== 0 && field.descriptor.includes(item.name.replace(/\./g, '/')));
}

function enumStateNames(item: JvmClassIR): string[] {
  return item.fields
    .filter((field) => (field.access & ACC_ENUM) !== 0 || ((field.access & ACC_STATIC) !== 0 && field.descriptor.includes(item.name.replace(/\./g, '/'))))
    .map((field) => field.name)
    .filter((name) => name && !name.startsWith('$'));
}

function lambdaTargets(method: JvmMethodIR): Array<{
  owner: string; name: string; controllerName: string; transitionTicks?: number;
}> {
  const targets = new Map<string, { owner: string; name: string; controllerName: string; transitionTicks?: number }>();
  for (let index = 0; index < method.instructions.length; index++) {
    const instruction = method.instructions[index];
    const bootstrap = instruction.constant?.bootstrapMethod;
    if (!bootstrap) continue;
    for (const argument of bootstrap.arguments ?? []) {
      const reference = argument.reference;
      if (argument.kind !== 'MethodHandle' || !reference?.owner || !reference.name) continue;
      let controllerName = '';
      let transitionTicks: number | undefined;
      for (let previous = index - 1; previous >= 0 && previous >= index - 12; previous--) {
        const candidate = method.instructions[previous];
        const value = candidate.constant?.value;
        if (!controllerName && candidate.mnemonic.startsWith('ldc') && typeof value === 'string') controllerName = value;
        if (transitionTicks === undefined) {
          if (typeof value === 'number' && Number.isFinite(value)) transitionTicks = value;
          else if (candidate.opcode >= 0x02 && candidate.opcode <= 0x08) transitionTicks = candidate.opcode - 0x03;
          else if (candidate.opcode === 0x10 || candidate.opcode === 0x11) transitionTicks = candidate.operands[0];
          else if (candidate.opcode === 0x0b || candidate.opcode === 0x0e) transitionTicks = 0;
          else if (candidate.opcode === 0x0c || candidate.opcode === 0x0f) transitionTicks = 1;
          else if (candidate.opcode === 0x0d) transitionTicks = 2;
        }
        if (controllerName && transitionTicks !== undefined) break;
      }
      const target = { owner: reference.owner, name: reference.name, controllerName: controllerName || reference.name, transitionTicks };
      targets.set(target.owner + '#' + target.name + '#' + target.controllerName, target);
    }
  }
  return [...targets.values()];
}

function isStringConstant(instruction: JvmInstruction): string | null {
  const value = instruction.constant?.value;
  return instruction.mnemonic.startsWith('ldc') && typeof value === 'string' ? value : null;
}

function stateReferences(instructions: JvmInstruction[], enumName: string, names: Set<string>): string[] {
  return [...new Set(instructions
    .filter((instruction) => instruction.constant?.kind === 'Fieldref' &&
      instruction.constant.owner === enumName &&
      typeof instruction.constant.name === 'string' && names.has(instruction.constant.name))
    .map((instruction) => String(instruction.constant?.name)))];
}

function queryForCall(name: string): string | null {
  const key = name.toLowerCase();
  const exact: Record<string, string> = {
    ismoving: 'query.is_moving',
    ismovingfast: 'query.modified_move_speed > 0.01',
    issprinting: 'query.is_sprinting',
    isswimming: 'query.is_swimming',
    isonground: 'query.is_on_ground',
    isfallflying: 'query.is_gliding',
    isgliding: 'query.is_gliding',
    isalive: 'query.is_alive',
    isdead: '!query.is_alive',
    isinwater: 'query.is_in_water',
    isbaby: 'query.is_baby',
    isriding: 'query.is_riding',
    isangry: 'query.is_angry',
    isshiftkeydown: 'query.is_sneaking',
    iscrouching: 'query.is_sneaking',
    issneaking: 'query.is_sneaking',
    isusingitem: 'query.is_using_item',
    isblocking: 'query.is_using_item',
    ishurt: 'query.hurt_time > 0',
    isfalling: '!query.is_on_ground',
    isjumping: '!query.is_on_ground',
    ispassenger: 'query.is_riding',
    isgliding: 'query.is_gliding',
    isfallflying: 'query.is_gliding',
    isdeadordying: '!query.is_alive',
    isbaby: 'query.is_baby',
    iswet: 'query.is_in_water',
    isunderwater: 'query.is_underwater',
    isonfire: 'query.is_on_fire',
    isburning: 'query.is_on_fire',
    isattacking: 'variable.attack_time > 0.05',
  };
  return exact[key] ?? null;
}

function predicateForBlock(method: JvmMethodIR, blockStart: number): string | null {
  const block = method.blocks.find((item) => item.start === blockStart);
  if (!block) return null;
  const offsets = new Set(block.instructionOffsets);
  const calls = method.instructions
    .filter((instruction) => offsets.has(instruction.offset) && instruction.constant?.name)
    .map((instruction) => queryForCall(String(instruction.constant?.name)))
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(calls)];
  return unique.length === 1 ? unique[0] : null;
}

function blockAt(method: JvmMethodIR, offset: number) {
  return method.blocks.find((block) => block.start === offset);
}

function clipIdsInBlock(method: JvmMethodIR, blockStart: number, known: Set<string>): string[] {
  const block = blockAt(method, blockStart);
  if (!block) return [];
  const offsets = new Set(block.instructionOffsets);
  return [...new Set(method.instructions
    .filter((instruction) => offsets.has(instruction.offset))
    .map(isStringConstant)
    .filter((value): value is string => Boolean(value && known.has(value))))];
}

function recoverInitialState(controller: JvmClassIR, enumClass: JvmClassIR, states: Set<string>): string | null {
  const constructor = controller.methods.filter((method) => method.name === '<init>' || method.name === '<clinit>');
  const found = new Set<string>();
  for (const method of constructor) {
    for (const instruction of method.instructions) {
      const ref = instruction.constant;
      if (ref?.kind === 'Fieldref' && ref.owner === enumClass.name && ref.name && states.has(ref.name)) found.add(ref.name);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

function recoverStateBindings(
  controller: JvmClassIR,
  enumClass: JvmClassIR,
  states: Set<string>,
  knownClips: Set<string>,
  allClasses: JvmClassIR[],
): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const method of controller.methods) {
    for (const block of method.blocks) {
      const referencedStates = stateReferences(
        method.instructions.filter((instruction) => block.instructionOffsets.includes(instruction.offset)),
        enumClass.name,
        states,
      );
      const clips = clipIdsInBlock(method, block.start, knownClips);
      if (referencedStates.length === 1 && clips.length === 1) bindings.set(referencedStates[0], clips[0]);
    }
    // javac enum switch bodies often contain clip constants in the case block but no enum
    // Fieldref: the enum was lowered to a synthetic int switch map before the tableswitch.
    for (const entry of switchStateCases(method, enumClass, allClasses)) {
      if (bindings.has(entry.state)) continue;
      const direct = clipIdsInBlock(method, entry.target, knownClips);
      const clips = direct.length === 1 ? direct : reachableClipIds(method, entry.target, knownClips, 2);
      if (clips.length === 1) bindings.set(entry.state, clips[0]);
    }
  }
  return bindings;
}

function recoverTransitions(
  controller: JvmClassIR,
  enumClass: JvmClassIR,
  states: Set<string>,
  allClasses: JvmClassIR[],
): Array<{ from: string; to: string; condition: string }> {
  const edges: Array<{ from: string; to: string; condition: string }> = [];
  const addEdge = (from: string, to: string, condition: string | null) => {
    if (condition && from !== to) edges.push({ from, to, condition });
  };
  for (const method of controller.methods) {
    for (const block of method.blocks) {
      const branch = method.instructions.find((instruction) =>
        block.instructionOffsets.includes(instruction.offset) &&
        CONDITIONAL_BRANCHES.has(instruction.opcode) &&
        instruction.branchTargets.length > 0,
      );
      if (!branch) continue;
      const predicate = predicateForBlock(method, block.start);
      if (!predicate) continue;
      const currentStates = stateReferences(
        method.instructions.filter((instruction) => block.instructionOffsets.includes(instruction.offset)),
        enumClass.name,
        states,
      );
      if (currentStates.length !== 1) continue;
      for (const successor of block.successors) {
        const targetBlock = blockAt(method, successor);
        if (!targetBlock) continue;
        const targets = stateReferences(
          method.instructions.filter((instruction) => targetBlock.instructionOffsets.includes(instruction.offset)),
          enumClass.name,
          states,
        );
        if (targets.length !== 1) continue;
        addEdge(currentStates[0], targets[0], branchCondition(branch, predicate, branch.branchTargets.includes(successor)));
      }
    }

    // Recover state context from tableswitch/lookupswitch case labels. Each branch's source
    // state comes from its case label; the destination remains an explicit enum constant in
    // the branch successor, so no transition is guessed from method or field names.
    for (const entry of switchStateCases(method, enumClass, allClasses)) {
      const queue: Array<{ offset: number; depth: number }> = [{ offset: entry.target, depth: 0 }];
      const visited = new Set<number>();
      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current.offset) || current.depth > 4) continue;
        visited.add(current.offset);
        const block = blockAt(method, current.offset);
        if (!block) continue;
        const branch = method.instructions.find((instruction) =>
          block.instructionOffsets.includes(instruction.offset) &&
          CONDITIONAL_BRANCHES.has(instruction.opcode) && instruction.branchTargets.length > 0,
        );
        if (branch) {
          const predicate = predicateForBlock(method, block.start);
          if (predicate) {
            for (const successor of block.successors) {
              const targetBlock = blockAt(method, successor);
              if (!targetBlock) continue;
              const targets = stateReferences(
                method.instructions.filter((instruction) => targetBlock.instructionOffsets.includes(instruction.offset)),
                enumClass.name,
                states,
              );
              if (targets.length === 1) {
                addEdge(entry.state, targets[0], branchCondition(branch, predicate, branch.branchTargets.includes(successor)));
              }
            }
          }
        }
        for (const successor of block.successors) {
          if (!visited.has(successor)) queue.push({ offset: successor, depth: current.depth + 1 });
        }
      }
    }
  }
  return edges.filter((edge, index, all) =>
    all.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.condition === edge.condition) === index);
}

function invertCondition(condition: string): string {
  return condition.startsWith('!') ? condition.slice(1) : '!' + condition;
}

/**
 * GeckoLib-style controllers are often Java lambdas rather than enum state machines.
 * Recover a state graph only when a lambda's branch blocks lead directly to exact
 * animation-id constants and the branch predicate maps to a known Bedrock query.
 */
function recoverLambdaStates(
  controller: JvmClassIR,
  byName: Map<string, JvmClassIR>,
  knownClips: Set<string>,
): Array<{
  initialState: string; states: Record<string, unknown>; stateNames: string[];
  sourceMethod: string; controllerName: string; transitionTicks?: number;
}> {
  const graphs: Array<{
    initialState: string; states: Record<string, unknown>; stateNames: string[];
    sourceMethod: string; controllerName: string; transitionTicks?: number;
  }> = [];
  const seenMethods = new Set<string>();
  for (const registrationMethod of controller.methods) {
    for (const target of lambdaTargets(registrationMethod)) {
      const targetKey = target.owner + '#' + target.name;
      if (seenMethods.has(targetKey)) continue;
      seenMethods.add(targetKey);
      const lambdaClass = byName.get(target.owner);
      const lambdaMethod = lambdaClass?.methods.find((method) => method.name === target.name);
      if (!lambdaMethod) continue;
      const recovered = new Map<string, { clip: string; condition: string; order: number }>();
      let order = 0;
      const clipsByBlock = new Map<number, string[]>();
      for (const block of lambdaMethod.blocks) {
        const clips = clipIdsInBlock(lambdaMethod, block.start, knownClips);
        if (clips.length === 1) clipsByBlock.set(block.start, clips);
      }
      for (const block of lambdaMethod.blocks) {
        const branch = lambdaMethod.instructions.find((instruction) =>
          block.instructionOffsets.includes(instruction.offset) &&
          CONDITIONAL_BRANCHES.has(instruction.opcode) && instruction.branchTargets.length > 0,
        );
        if (!branch) continue;
        const predicate = predicateForBlock(lambdaMethod, block.start);
        if (!predicate) continue;
        for (const successor of block.successors) {
          const targetClips = clipsByBlock.get(successor);
          if (!targetClips || targetClips.length !== 1) continue;
          const taken = branch.branchTargets.includes(successor);
          let condition: string | null = null;
          if (branch.opcode === 0x99 || branch.opcode === 0xc6) condition = taken ? '!' + predicate : predicate;
          else if (branch.opcode === 0x9a || branch.opcode === 0xc7) condition = taken ? predicate : '!' + predicate;
          if (!condition) continue;
          const clip = targetClips[0];
          if (!recovered.has(clip)) recovered.set(clip, { clip, condition, order: order++ });
        }
      }
      if (recovered.size === 0) continue;
      const entries = [...recovered.values()].sort((a, b) => a.order - b.order);
      const states: Record<string, unknown> = { default: { animations: [], transitions: [] } };
      const stateNames = ['default'];
      const used = new Set(['default']);
      const transitions: Array<Record<string, string>> = [];
      for (const entry of entries) {
        const suffix = cleanIdentifier(entry.clip.split('.').pop() ?? entry.clip);
        let state = 'state_' + suffix, index = 2;
        while (used.has(state)) state = 'state_' + suffix + '_' + index++;
        used.add(state);
        stateNames.push(state);
        states[state] = { animations: [entry.clip], transitions: [{ default: invertCondition(entry.condition) }] };
        transitions.push({ [state]: entry.condition });
      }
      (states.default as { transitions: Array<Record<string, string>> }).transitions = transitions;
      graphs.push({
        initialState: 'default', states, stateNames, sourceMethod: target.name,
        controllerName: target.controllerName, transitionTicks: target.transitionTicks,
      });
    }
  }
  return graphs;
}

function ownerForController(controller: JvmClassIR, mobIds: string[], summaries: DecompileClassSummary[], playerClassNames: string[] = []): string | null {
  const playerClasses = new Set(playerClassNames.map((value) => value.split(' (')[0]));
  if (mobIds.includes('player') && playerClasses.has(controller.name)) return 'player';
  const ownRegistryIds = summaries
    .filter((summary) => summary.qualifiedClassName === controller.name)
    .flatMap((summary) => summary.registryIds ?? []);
  const ownMatches = [...new Set(ownRegistryIds)].filter((id) => mobIds.includes(id));
  if (ownMatches.length === 1) return ownMatches[0];
  const referencedOwners = new Set<string>();
  for (const method of controller.methods) {
    for (const reference of [...method.calls, ...method.fieldAccesses]) {
      if (reference.owner) referencedOwners.add(reference.owner);
    }
  }
  const matched = summaries
    .filter((summary) => summary.qualifiedClassName && referencedOwners.has(summary.qualifiedClassName))
    .flatMap((summary) => summary.registryIds ?? []);
  if (mobIds.includes('player') && [...referencedOwners].some((owner) => playerClasses.has(owner))) return 'player';
  const exact = [...new Set(matched)].filter((id) => mobIds.includes(id));
  if (exact.length === 1) return exact[0];
  return mobIds.length === 1 ? mobIds[0] : null;
}

/**
 * Reconstruct only graphs supported by explicit enum state references, a recovered constructor
 * initial state, branch guards mapped to Bedrock queries, and exact animation string bindings.
 * Unknown Java predicates or dynamic state dispatch are retained as withheld diagnostics rather
 * than replaced with periodic or guessed Molang conditions.
 */
export function synthesizeAnimationControllersFromBytecode(
  mobIds: string[],
  signals: ControllerSignals = {},
): ControllerSynthesis {
  const classes = signals.bytecodeClasses ?? [];
  const byName = new Map(classes.map((item) => [item.name, item]));
  const knownClips = new Set(signals.animationIds ?? []);
  const explicitNames = new Set([...(signals.controllerClasses ?? []), ...(signals.stateMachineClasses ?? [])]);
  const candidates = classes.filter((item) =>
    explicitNames.has(item.name) ||
    item.methods.some((method) => method.calls.some((call) => CONTROLLER_CALL.test([call.owner, call.name].filter(Boolean).join('.')))),
  );
  const enums = classes.filter(isEnumStateClass).map((item) => ({ item, names: enumStateNames(item) })).filter((entry) => entry.names.length > 1);
  const controllers: SynthesizedController[] = [];
  const files: Record<string, string> = {};
  const controllerIdsByOwner: Record<string, string[]> = {};
  const candidatesWithheld: Array<{ sourceClass: string; reason: string }> = [];
  let completeGraphsRecovered = 0;

  for (const candidate of candidates) {
    const enumCandidates = enums.filter(({ item }) =>
      candidate.fields.some((field) => field.descriptor.includes(item.name.replace(/\./g, '/'))) ||
      candidate.methods.some((method) => [...method.calls, ...method.fieldAccesses].some((reference) => reference.owner === item.name)),
    );
    if (enumCandidates.length === 0) {
      const lambdaGraphs = recoverLambdaStates(candidate, byName, knownClips);
      const ownerId = ownerForController(candidate, mobIds, signals.entityClasses ?? [], signals.playerClassNames ?? []);
      if (lambdaGraphs.length > 0 && ownerId) {
        const modId = ownerId.split(':')[0] || 'java_mod';
        const className = candidate.name.split('.').pop() ?? 'controller';
        const usedNames = new Set<string>();
        for (const lambdaGraph of lambdaGraphs) {
          let token = cleanIdentifier(lambdaGraph.controllerName || lambdaGraph.sourceMethod);
          if (usedNames.has(token)) token += '_' + cleanIdentifier(lambdaGraph.sourceMethod);
          usedNames.add(token);
          const controllerId = 'controller.animation.' + cleanIdentifier(modId + '.' + className + '.' + token);
          const filePath = 'animation_controllers/' + cleanIdentifier(className + '_' + token) + '.controller.json';
          const states = JSON.parse(JSON.stringify(lambdaGraph.states)) as Record<string, Record<string, unknown>>;
          if (lambdaGraph.transitionTicks !== undefined && Number.isFinite(lambdaGraph.transitionTicks) && lambdaGraph.transitionTicks >= 0) {
            const blendSeconds = Math.round((lambdaGraph.transitionTicks / 20) * 1000) / 1000;
            for (const stateName of lambdaGraph.stateNames) {
              if (stateName !== 'default') states[stateName].blend_transition = blendSeconds;
            }
          }
          const json = JSON.stringify({ format_version: '1.10.0', animation_controllers: {
            [controllerId]: { initial_state: lambdaGraph.initialState, states },
          } }, null, 2);
          files[filePath] = json;
          controllers.push({
            filePath, controllerId, ownerId, sourceClass: candidate.name,
            kind: 'animation-controller', states: lambdaGraph.stateNames, json,
          });
          controllerIdsByOwner[ownerId] = [...(controllerIdsByOwner[ownerId] ?? []), controllerId];
          completeGraphsRecovered += 1;
        }
      } else {
        candidatesWithheld.push({ sourceClass: candidate.name, reason: lambdaGraphs.length > 0
          ? 'The lambda graph was recovered but its owning entity could not be resolved uniquely.'
          : 'No enum graph or branch-to-clip lambda graph with recognized query guards was recovered.' });
      }
      continue;
    }
    if (enumCandidates.length !== 1) {
      candidatesWithheld.push({ sourceClass: candidate.name, reason: 'More than one enum state type is referenced; ownership of transitions is ambiguous.' });
      continue;
    }
    const enumClass = enumCandidates[0].item;
    const stateNames = enumCandidates[0].names;
    const states = new Set(stateNames);
    const initialState = recoverInitialState(candidate, enumClass, states);
    const bindings = recoverStateBindings(candidate, enumClass, states, knownClips, classes);
    const transitions = recoverTransitions(candidate, enumClass, states, classes);
    const ownerId = ownerForController(candidate, mobIds, signals.entityClasses ?? []);
    if (!initialState || bindings.size !== stateNames.length || transitions.length === 0 || !ownerId) {
      const missing = [
        !initialState ? 'initial state is not unambiguous in constructor bytecode' : '',
        bindings.size !== stateNames.length ? 'not every enum state has an exact animation-id string binding in its state block' : '',
        transitions.length === 0 ? 'no branch-to-state transition with a recognized Bedrock query guard was recovered' : '',
        !ownerId ? 'controller owner could not be resolved to exactly one discovered entity' : '',
      ].filter(Boolean);
      candidatesWithheld.push({ sourceClass: candidate.name, reason: missing.join('; ') });
      continue;
    }
    const statesJson: Record<string, unknown> = {};
    for (const state of stateNames) {
      const outgoing = transitions.filter((edge) => edge.from === state);
      statesJson[state] = {
        animations: [bindings.get(state)],
        transitions: outgoing.map((edge) => ({ [edge.to]: edge.condition })),
      };
    }
    const modId = ownerId.split(':')[0] || 'java_mod';
    const controllerId = 'controller.animation.' + cleanIdentifier(modId + '.' + candidate.name.split('.').pop());
    const filePath = 'animation_controllers/' + cleanIdentifier(candidate.name.split('.').pop()) + '.controller.json';
    const json = JSON.stringify({ format_version: '1.10.0', animation_controllers: {
      [controllerId]: { initial_state: initialState, states: statesJson },
    } }, null, 2);
    files[filePath] = json;
    controllers.push({
      filePath, controllerId, ownerId, sourceClass: candidate.name,
      kind: signals.stateMachineClasses?.includes(candidate.name) ? 'state-machine' : 'animation-controller',
      states: stateNames, json,
    });
    controllerIdsByOwner[ownerId] = [...(controllerIdsByOwner[ownerId] ?? []), controllerId];
    completeGraphsRecovered += 1;
  }

  return {
    controllers, files, controllerIdsByOwner,
    analysis: {
      bytecodeClassesInspected: classes.length,
      controllerCandidates: candidates.length,
      stateEnumsFound: enums.length,
      completeGraphsRecovered,
      candidatesWithheld,
    },
  };
}
