import type { DecompileClassSummary } from '@/types/remaker';

/**
 * Bytecode-to-JSON animation controller synthesis.
 *
 * The decompiler reports which Java classes carry animation-controller or
 * state-machine opcode signatures. Those detected names are the ONLY input: no
 * controller is invented for a class the archive never contained. Every emitted
 * state has a bounded exit so a looping clip can never latch the machine (RG-17),
 * and every trigger reads an engine-written query (RG-16).
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
