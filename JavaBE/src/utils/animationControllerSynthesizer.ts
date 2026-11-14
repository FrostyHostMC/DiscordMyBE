import type { DecompileClassSummary } from '@/types/remaker';

/**
 * Conservative boundary for bytecode-only animation-controller reconstruction.
 *
 * Java class names and opcode-signature hits can identify likely controller-related classes, but
 * they do not recover the state graph, transition order, guards, or clip bindings. This function
 * intentionally preserves its public result shape while emitting no guessed controller. Source
 * controllers discovered in actual resource files are handled by the resource-pack import path.
 * This can be replaced once the decompiler produces structured state-machine evidence.
 */

export interface ControllerSignals {
  controllerClasses?: string[];
  stateMachineClasses?: string[];
  animationIds?: string[];
  entityClasses?: DecompileClassSummary[];
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
}

/**
 * Java class names and opcode-signature hits do not contain a recoverable state graph.
 * The previous implementation guessed idle/move/attack/hurt states, selected clips by
 * substring, and attached periodic Molang conditions. Those are not source semantics.
 *
 * Until the decompiler supplies actual state nodes, transitions, guards and clip bindings,
 * this stage deliberately emits nothing. Existing controllers recovered from resource files
 * are preserved by the normal import/export pipeline.
 */
export function synthesizeAnimationControllersFromBytecode(
  _mobIds: string[],
  _signals: ControllerSignals = {},
): ControllerSynthesis {
  return { controllers: [], files: {}, controllerIdsByOwner: {} };
}
