import type { JvmClassIR, JvmInstruction, JvmMethodIR } from '@/utils/jvmBytecodeIR';

type Expr =
  | { kind: 'constant'; value: number }
  | { kind: 'progress' }
  | { kind: 'unary'; op: string; value: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] };

export type CustomEasingFunction = (progress: number) => number;

export interface JavaEasingRegistry {
  functions: Record<string, CustomEasingFunction>;
  recovered: Array<{ name: string; sourceClass: string; sourceMethod: string }>;
  withheld: Array<{ name: string; sourceClass: string; reason: string }>;
}

function evaluate(expression: Expr, progress: number): number {
  if (expression.kind === 'constant') return expression.value;
  if (expression.kind === 'progress') return progress;
  if (expression.kind === 'unary') {
    const value = evaluate(expression.value, progress);
    if (expression.op === 'neg') return -value;
    if (expression.op === 'abs') return Math.abs(value);
    return Number.NaN;
  }
  if (expression.kind === 'binary') {
    const left = evaluate(expression.left, progress), right = evaluate(expression.right, progress);
    switch (expression.op) {
      case 'add': return left + right;
      case 'sub': return left - right;
      case 'mul': return left * right;
      case 'div': return left / right;
      case 'rem': return left % right;
      default: return Number.NaN;
    }
  }
  const args = expression.args.map((arg) => evaluate(arg, progress));
  switch (expression.name) {
    case 'sin': return Math.sin(args[0]);
    case 'cos': return Math.cos(args[0]);
    case 'tan': return Math.tan(args[0]);
    case 'asin': return Math.asin(args[0]);
    case 'acos': return Math.acos(args[0]);
    case 'atan': return Math.atan(args[0]);
    case 'sqrt': return Math.sqrt(args[0]);
    case 'abs': return Math.abs(args[0]);
    case 'floor': return Math.floor(args[0]);
    case 'ceil': return Math.ceil(args[0]);
    case 'round': return Math.round(args[0]);
    case 'exp': return Math.exp(args[0]);
    case 'log': return Math.log(args[0]);
    case 'log10': return Math.log10(args[0]);
    case 'pow': return Math.pow(args[0], args[1]);
    case 'min': return Math.min(args[0], args[1]);
    case 'max': return Math.max(args[0], args[1]);
    default: return Number.NaN;
  }
}

function descriptorParameters(descriptor: string, isStatic: boolean): Array<{ slot: number; kind: string }> {
  const start = descriptor.indexOf('('), end = descriptor.indexOf(')');
  if (start < 0 || end < 0) return [];
  const output: Array<{ slot: number; kind: string }> = [];
  let slot = isStatic ? 0 : 1;
  for (let i = start + 1; i < end;) {
    let kind = descriptor[i++];
    while (kind === '[') kind = descriptor[i++];
    if (kind === 'L') {
      const semicolon = descriptor.indexOf(';', i);
      if (semicolon < 0) return [];
      i = semicolon + 1;
      kind = 'L';
    }
    output.push({ slot, kind });
    slot += kind === 'D' || kind === 'J' ? 2 : 1;
  }
  return output;
}

function loadIndex(instruction: JvmInstruction): number | null {
  const short = /^[ilfd]load_(\d+)$/.exec(instruction.mnemonic);
  if (short) return Number(short[1]);
  if (/^[ilfd]load$/.test(instruction.mnemonic)) return instruction.operands[0] ?? null;
  return null;
}

function constantNumber(instruction: JvmInstruction): number | null {
  const value = instruction.constant?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const opcode = instruction.opcode;
  if (opcode >= 0x02 && opcode <= 0x08) return opcode - 0x03;
  if (opcode === 0x10 || opcode === 0x11) return instruction.operands[0] ?? null;
  if (opcode === 0x0e) return 0;
  if (opcode === 0x0f) return 1;
  if (opcode === 0x0b) return 0;
  if (opcode === 0x0c) return 1;
  if (opcode === 0x0d) return 2;
  return null;
}

function mathCall(instruction: JvmInstruction): { name: string; arity: number } | null {
  const owner = instruction.constant?.owner ?? '';
  const name = instruction.constant?.name ?? '';
  if (!/(?:java\.lang\.(?:Strict)?Math|Mth|MathHelper)$/.test(owner)) return null;
  const unary = new Set(['sin','cos','tan','asin','acos','atan','sqrt','cbrt','abs','floor','ceil','round','exp','log','log10','signum']);
  const binary = new Set(['pow','min','max','atan2','hypot','copySign']);
  if (unary.has(name)) return { name, arity: 1 };
  if (binary.has(name)) return { name, arity: 2 };
  return null;
}

/**
 * Compile a conservative straight-line scalar JVM method into a sampled easing function.
 * Branching, mutable fields, captured object state, and unknown calls are rejected rather than
 * approximated as a different curve. The caller adaptively samples the recovered function.
 */
export function compileJvmScalarEasing(method: JvmMethodIR, isStatic: boolean): CustomEasingFunction | null {
  const params = descriptorParameters(method.descriptor, isStatic);
  const numeric = params.filter((param) => ['D','F','I','J'].includes(param.kind));
  if (numeric.length === 0) return null;
  const namedProgress = method.localVariables.find((local) =>
    /^(t|x|value|progress|partialtick|partial_tick)$/i.test(local.name));
  const progressSlot = namedProgress?.index ?? numeric[numeric.length - 1].slot;
  const offsetToIndex = new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));

  const execute = (progress: number): number => {
    const locals: number[] = [];
    locals[progressSlot] = Math.max(0, Math.min(1, progress));
    const stack: number[] = [];
    let pc = 0;
    let steps = 0;
    const maxSteps = Math.max(128, method.instructions.length * 16);
    const pop = (): number | null => stack.length > 0 ? stack.pop()! : null;
    const jump = (instruction: JvmInstruction): boolean => {
      const target = instruction.branchTargets[0];
      const index = offsetToIndex.get(target);
      if (index === undefined) return false;
      pc = index;
      return true;
    };

    while (pc < method.instructions.length && steps++ < maxSteps) {
      const instruction = method.instructions[pc];
      const op = instruction.opcode;
      const loaded = loadIndex(instruction);
      if (loaded !== null) {
        if (loaded !== progressSlot) return Number.NaN;
        stack.push(locals[loaded]);
        pc += 1;
        continue;
      }
      if (instruction.mnemonic.startsWith('ldc') || (op >= 0x02 && op <= 0x11)) {
        const number = constantNumber(instruction);
        if (number === null) return Number.NaN;
        stack.push(number);
        pc += 1;
        continue;
      }
      if (op === 0xb2) {
        const owner = instruction.constant?.owner ?? '';
        const name = instruction.constant?.name ?? '';
        if (owner === 'java.lang.Math' && name === 'PI') stack.push(Math.PI);
        else if (owner === 'java.lang.Math' && name === 'E') stack.push(Math.E);
        else return Number.NaN;
        pc += 1;
        continue;
      }
      if ([0x60,0x61,0x62,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x6b,0x6c,0x6d,0x6e,0x6f,0x70,0x71,0x72,0x73].includes(op)) {
        const right = pop(), left = pop();
        if (left === null || right === null) return Number.NaN;
        if (op >= 0x70) stack.push(left % right);
        else if (op >= 0x6c) stack.push(left / right);
        else if (op >= 0x68) stack.push(left * right);
        else if (op >= 0x64) stack.push(left - right);
        else stack.push(left + right);
        pc += 1;
        continue;
      }
      if (op >= 0x74 && op <= 0x77) {
        const value = pop();
        if (value === null) return Number.NaN;
        stack.push(-value);
        pc += 1;
        continue;
      }
      if (op >= 0x85 && op <= 0x93) { pc += 1; continue; }
      if (op === 0x59 || op === 0x5c) {
        if (stack.length === 0) return Number.NaN;
        stack.push(stack[stack.length - 1]);
        pc += 1;
        continue;
      }
      if (op === 0x5f) {
        if (stack.length < 2) return Number.NaN;
        const top = stack.pop()!, below = stack.pop()!;
        stack.push(top, below);
        pc += 1;
        continue;
      }
      if (op === 0x57) { if (pop() === null) return Number.NaN; pc += 1; continue; }
      if (op === 0x58) { if (pop() === null || pop() === null) return Number.NaN; pc += 1; continue; }
      if (op === 0x84) {
        const index = instruction.operands[0], amount = instruction.operands[1];
        if (index === undefined || amount === undefined || locals[index] === undefined) return Number.NaN;
        locals[index] += amount;
        pc += 1;
        continue;
      }
      if ([0x95,0x96,0x97,0x98].includes(op)) {
        const right = pop(), left = pop();
        if (left === null || right === null) return Number.NaN;
        stack.push(Number.isNaN(left) || Number.isNaN(right) ? (op === 0x96 || op === 0x98 ? 1 : -1) : left > right ? 1 : left < right ? -1 : 0);
        pc += 1;
        continue;
      }
      if (op === 0xb8) {
        const call = mathCall(instruction);
        if (!call || stack.length < call.arity) return Number.NaN;
        const args = stack.splice(stack.length - call.arity, call.arity);
        const name = call.name;
        let value: number;
        switch (name) {
          case 'sin': value = Math.sin(args[0]); break;
          case 'cos': value = Math.cos(args[0]); break;
          case 'tan': value = Math.tan(args[0]); break;
          case 'asin': value = Math.asin(args[0]); break;
          case 'acos': value = Math.acos(args[0]); break;
          case 'atan': value = Math.atan(args[0]); break;
          case 'atan2': value = Math.atan2(args[0], args[1]); break;
          case 'sqrt': value = Math.sqrt(args[0]); break;
          case 'cbrt': value = Math.cbrt(args[0]); break;
          case 'abs': value = Math.abs(args[0]); break;
          case 'signum': value = Math.sign(args[0]); break;
          case 'floor': value = Math.floor(args[0]); break;
          case 'ceil': value = Math.ceil(args[0]); break;
          case 'round': value = Math.round(args[0]); break;
          case 'exp': value = Math.exp(args[0]); break;
          case 'log': value = Math.log(args[0]); break;
          case 'log10': value = Math.log10(args[0]); break;
          case 'pow': value = Math.pow(args[0], args[1]); break;
          case 'min': value = Math.min(args[0], args[1]); break;
          case 'max': value = Math.max(args[0], args[1]); break;
          case 'hypot': value = Math.hypot(args[0], args[1]); break;
          case 'copySign': value = Math.sign(args[1]) * Math.abs(args[0]); break;
          default: return Number.NaN;
        }
        stack.push(value);
        pc += 1;
        continue;
      }
      if (op === 0xa7 || op === 0xc8) {
        if (!jump(instruction)) return Number.NaN;
        continue;
      }
      if (op >= 0x99 && op <= 0x9e) {
        const value = pop();
        if (value === null) return Number.NaN;
        const take = op === 0x99 ? value === 0 : op === 0x9a ? value !== 0 :
          op === 0x9b ? value < 0 : op === 0x9c ? value >= 0 :
          op === 0x9d ? value > 0 : value <= 0;
        if (take) { if (!jump(instruction)) return Number.NaN; }
        else pc += 1;
        continue;
      }
      if (op >= 0x9f && op <= 0xa4) {
        const right = pop(), left = pop();
        if (left === null || right === null) return Number.NaN;
        const take = op === 0x9f ? left === right : op === 0xa0 ? left !== right :
          op === 0xa1 ? left < right : op === 0xa2 ? left >= right :
          op === 0xa3 ? left > right : left <= right;
        if (take) { if (!jump(instruction)) return Number.NaN; }
        else pc += 1;
        continue;
      }
      if ([0xac,0xad,0xae,0xaf].includes(op)) return pop() ?? Number.NaN;
      if (op === 0x00) { pc += 1; continue; }
      return Number.NaN;
    }
    return Number.NaN;
  };

  const fn = (progress: number) => execute(progress);
  for (const sample of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
    if (!Number.isFinite(fn(sample))) return null;
  }
  return fn;
}

function lambdaTarget(method: JvmMethodIR): { owner: string; name: string } | null {
  const targets = new Map<string, { owner: string; name: string }>();
  for (const instruction of method.instructions) {
    const bootstrap = instruction.constant?.bootstrapMethod;
    for (const argument of bootstrap?.arguments ?? []) {
      const reference = argument.reference;
      if (argument.kind === 'MethodHandle' && reference?.owner && reference.name) {
        const target = { owner: reference.owner, name: reference.name };
        targets.set(target.owner + '#' + target.name, target);
      }
    }
  }
  return targets.size === 1 ? [...targets.values()][0] : null;
}

function registrationName(method: JvmMethodIR, callIndex: number): string | null {
  for (let index = callIndex - 1; index >= 0 && index >= callIndex - 12; index--) {
    const instruction = method.instructions[index];
    if (instruction.mnemonic.startsWith('ldc') && typeof instruction.constant?.value === 'string') {
      return String(instruction.constant.value);
    }
  }
  return null;
}

export function buildJavaCustomEasingRegistry(classes: JvmClassIR[]): JavaEasingRegistry {
  const byName = new Map(classes.map((item) => [item.name, item]));
  const functions: Record<string, CustomEasingFunction> = {};
  const recovered: JavaEasingRegistry['recovered'] = [];
  const withheld: JavaEasingRegistry['withheld'] = [];
  const register = (name: string, sourceClass: string, sourceMethod: string, fn: CustomEasingFunction | null) => {
    if (!fn) {
      withheld.push({ name, sourceClass, reason: 'The easing method uses control flow, mutable/captured state, or bytecode operations outside the safe scalar subset.' });
      return;
    }
    const normalized = name.trim().toLowerCase().replace(/[-_\s]/g, '');
    if (!normalized) return;
    functions[name] = fn;
    functions[normalized] = fn;
    recovered.push({ name, sourceClass, sourceMethod });
  };

  for (const item of classes) {
    for (const method of item.methods) {
      for (let callIndex = 0; callIndex < method.instructions.length; callIndex++) {
        const call = method.instructions[callIndex].constant;
        if (!call?.name || !/addCustomSimpleEasingType|registerSimple|addCustomEasingType/i.test(call.name)) continue;
        const name = registrationName(method, callIndex);
        if (!name) continue;
        if (/addCustomEasingType/i.test(call.name)) {
          let className: string | null = null;
          for (let index = callIndex - 1; index >= 0 && index >= callIndex - 16; index--) {
            const instruction = method.instructions[index];
            if (instruction.opcode === 0xbb && typeof instruction.constant?.value === 'string') {
              className = String(instruction.constant.value);
              break;
            }
          }
          const easingClass = className ? byName.get(className) : undefined;
          const candidates = easingClass?.methods.filter((candidate) =>
            /^\(D\)D$|^\(F\)F$/.test(candidate.descriptor) &&
            !['<init>', '<clinit>'].includes(candidate.name));
          const targetMethod = candidates?.find((candidate) => /ease|apply|value/i.test(candidate.name)) ??
            (candidates?.length === 1 ? candidates[0] : undefined);
          register(name, className ?? item.name, targetMethod?.name ?? '<unresolved>',
            targetMethod ? compileJvmScalarEasing(targetMethod, (targetMethod.access & 0x0008) !== 0) : null);
          continue;
        }
        const target = lambdaTarget(method);
        if (!target) {
          withheld.push({ name, sourceClass: item.name, reason: 'The registration call did not have one unambiguous invokedynamic method target.' });
          continue;
        }
        const targetClass = byName.get(target.owner);
        const targetMethod = targetClass?.methods.find((candidate) => candidate.name === target.name);
        register(name, target.owner, target.name, targetMethod ? compileJvmScalarEasing(targetMethod, (targetMethod.access & 0x0008) !== 0) : null);
      }
    }
  }
  return { functions, recovered, withheld };
}
