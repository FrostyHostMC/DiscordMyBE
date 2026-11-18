import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { buildJavaCustomEasingRegistry } = await server.ssrLoadModule('/src/utils/javaEasingCompiler.ts');
  const { analyzeChannel } = await server.ssrLoadModule('/src/utils/animationChannelMath.ts');
  const methodRef = { index: 2, tag: 10, kind: 'Methodref', owner: 'com.geckolib.util.GeckoLibUtil', name: 'addCustomSimpleEasingType', descriptor: '(Ljava/lang/String;Ljava/util/function/DoubleUnaryOperator;)V' };
  const handle = {
    index: 3, tag: 15, kind: 'MethodHandle',
    reference: { index: 4, tag: 10, kind: 'Methodref', owner: 'fixture.EasingMod', name: 'lambda$register$0', descriptor: '(D)D' },
  };
  const registration = {
    name: 'register', descriptor: '()V', access: 0x0009, maxStack: 3, maxLocals: 0,
    instructions: [
      { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: { index: 1, tag: 8, kind: 'String', value: 'fixture_custom_quad' }, branchTargets: [] },
      { offset: 1, opcode: 0xba, mnemonic: 'invokedynamic', size: 1, operands: [], constant: { index: 5, tag: 18, kind: 'InvokeDynamic', bootstrapMethod: { methodReference: undefined, arguments: [handle] } }, branchTargets: [] },
      { offset: 2, opcode: 0xb8, mnemonic: 'invokestatic', size: 1, operands: [], constant: methodRef, branchTargets: [] },
    ],
    blocks: [{ start: 0, end: 3, instructionOffsets: [0,1,2], successors: [], exceptionalSuccessors: [] }],
    calls: [methodRef], fieldAccesses: [], localVariables: [], exceptionHandlers: [], codeLength: 3, decodeWarnings: [],
  };
  const lambda = {
    name: 'lambda$register$0', descriptor: '(D)D', access: 0x000a, maxStack: 4, maxLocals: 2,
    instructions: [
      { offset: 0, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 1, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 2, opcode: 0x6b, mnemonic: 'dmul', size: 1, operands: [], branchTargets: [] },
      { offset: 3, opcode: 0xaf, mnemonic: 'dreturn', size: 1, operands: [], branchTargets: [] },
    ],
    blocks: [{ start: 0, end: 4, instructionOffsets: [0,1,2,3], successors: [], exceptionalSuccessors: [] }],
    calls: [], fieldAccesses: [], localVariables: [{ name: 'progress', descriptor: 'D', index: 0, start: 0, length: 4 }],
    exceptionHandlers: [], codeLength: 4, decodeWarnings: [],
  };
  const owner = {
    path: 'fixture/EasingMod.class', name: 'fixture.EasingMod', superName: 'java.lang.Object',
    interfaces: [], access: 0x0001, majorVersion: 61, minorVersion: 0, fields: [],
    methods: [registration, lambda], references: [], bootstrapMethods: [], decodeWarnings: [],
  };
  const registry = buildJavaCustomEasingRegistry([owner]);
  const easing = registry.functions.fixture_custom_quad;
  if (!easing || Math.abs(easing(0.5) - 0.25) > 0.000001) {
    throw new Error('A registered Java lambda easing was not compiled from JVM arithmetic bytecode: ' + JSON.stringify(registry));
  }

  const piecewiseHandle = {
    index: 9, tag: 15, kind: 'MethodHandle',
    reference: { index: 10, tag: 10, kind: 'Methodref', owner: 'fixture.EasingMod', name: 'lambda$register$1', descriptor: '(D)D' },
  };
  const piecewiseRegistration = {
    ...registration,
    name: 'registerPiecewise',
    instructions: [
      { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: { index: 11, tag: 8, kind: 'String', value: 'fixture_piecewise' }, branchTargets: [] },
      { offset: 1, opcode: 0xba, mnemonic: 'invokedynamic', size: 1, operands: [], constant: { index: 12, tag: 18, kind: 'InvokeDynamic', bootstrapMethod: { methodReference: undefined, arguments: [piecewiseHandle] } }, branchTargets: [] },
      { offset: 2, opcode: 0xb8, mnemonic: 'invokestatic', size: 1, operands: [], constant: methodRef, branchTargets: [] },
    ],
  };
  const piecewiseLambda = {
    ...lambda,
    name: 'lambda$register$1',
    instructions: [
      { offset: 0, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 1, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { value: 0.5 }, branchTargets: [] },
      { offset: 2, opcode: 0x97, mnemonic: 'dcmpl', size: 1, operands: [], branchTargets: [] },
      { offset: 3, opcode: 0x9c, mnemonic: 'ifge', size: 1, operands: [], branchTargets: [12] },
      { offset: 6, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 7, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { value: 0.5 }, branchTargets: [] },
      { offset: 8, opcode: 0x6b, mnemonic: 'dmul', size: 1, operands: [], branchTargets: [] },
      { offset: 9, opcode: 0xaf, mnemonic: 'dreturn', size: 1, operands: [], branchTargets: [] },
      { offset: 12, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 13, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { value: 0.5 }, branchTargets: [] },
      { offset: 14, opcode: 0x67, mnemonic: 'dsub', size: 1, operands: [], branchTargets: [] },
      { offset: 15, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { value: 1.5 }, branchTargets: [] },
      { offset: 16, opcode: 0x6b, mnemonic: 'dmul', size: 1, operands: [], branchTargets: [] },
      { offset: 17, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { value: 0.25 }, branchTargets: [] },
      { offset: 18, opcode: 0x63, mnemonic: 'dadd', size: 1, operands: [], branchTargets: [] },
      { offset: 19, opcode: 0xaf, mnemonic: 'dreturn', size: 1, operands: [], branchTargets: [] },
    ],
    blocks: [{ start: 0, end: 20, instructionOffsets: [0,1,2,3,6,7,8,9,12,13,14,15,16,17,18,19], successors: [12,6], exceptionalSuccessors: [] }],
  };
  owner.methods.push(piecewiseRegistration, piecewiseLambda);
  const piecewiseRegistry = buildJavaCustomEasingRegistry([owner]);
  const piecewise = piecewiseRegistry.functions.fixture_piecewise;
  if (!piecewise || Math.abs(piecewise(0.25) - 0.125) > 0.000001 ||
      Math.abs(piecewise(0.75) - 0.625) > 0.000001) {
    throw new Error('A branch-based custom Java easing was not interpreted correctly: ' + JSON.stringify(piecewiseRegistry));
  }

  // Captured numeric lambda arguments are part of the easing function, not a reason to reject it.
  const capturedHandle = { index: 30, tag: 15, kind: 'MethodHandle', reference: { index: 31, tag: 10, kind: 'Methodref', owner: 'fixture.EasingMod', name: 'lambda$register$2', descriptor: '(DD)D' } };
  const capturedRegistration = {
    ...registration, name: 'registerCaptured',
    instructions: [
      { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: { index: 32, tag: 8, kind: 'String', value: 'fixture_captured_curve' }, branchTargets: [] },
      { offset: 1, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { index: 33, tag: 6, kind: 'Double', value: 3 }, branchTargets: [] },
      { offset: 2, opcode: 0xba, mnemonic: 'invokedynamic', size: 1, operands: [], constant: { index: 34, tag: 18, kind: 'InvokeDynamic', descriptor: '(D)Ljava/util/function/DoubleUnaryOperator;', bootstrapMethod: { methodReference: undefined, arguments: [capturedHandle] } }, branchTargets: [] },
      { offset: 3, opcode: 0xb8, mnemonic: 'invokestatic', size: 1, operands: [], constant: methodRef, branchTargets: [] },
    ],
  };
  const capturedLambda = {
    ...lambda, name: 'lambda$register$2', descriptor: '(DD)D', maxLocals: 4,
    instructions: [
      { offset: 0, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 1, opcode: 0x28, mnemonic: 'dload_2', size: 1, operands: [], branchTargets: [] },
      { offset: 2, opcode: 0x6b, mnemonic: 'dmul', size: 1, operands: [], branchTargets: [] },
      { offset: 3, opcode: 0xaf, mnemonic: 'dreturn', size: 1, operands: [], branchTargets: [] },
    ],
    blocks: [{ start: 0, end: 4, instructionOffsets: [0,1,2,3], successors: [], exceptionalSuccessors: [] }],
    localVariables: [{ name: 'progress', descriptor: 'D', index: 2, start: 0, length: 4 }],
  };
  const storedRegistration = {
    ...registration, name: 'registerStored',
    instructions: [
      { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: { index: 35, tag: 8, kind: 'String', value: 'fixture_stored_curve' }, branchTargets: [] },
      { offset: 1, opcode: 0xba, mnemonic: 'invokedynamic', size: 1, operands: [], constant: { index: 36, tag: 18, kind: 'InvokeDynamic', descriptor: '()Ljava/util/function/DoubleUnaryOperator;', bootstrapMethod: { methodReference: undefined, arguments: [{ index: 37, tag: 15, kind: 'MethodHandle', reference: { index: 38, tag: 10, kind: 'Methodref', owner: 'fixture.EasingMod', name: 'lambda$register$3', descriptor: '(D)D' } }] } }, branchTargets: [] },
      { offset: 2, opcode: 0xb8, mnemonic: 'invokestatic', size: 1, operands: [], constant: methodRef, branchTargets: [] },
    ],
  };
  const storedLambda = {
    ...lambda, name: 'lambda$register$3',
    instructions: [
      { offset: 0, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 1, opcode: 0x26, mnemonic: 'dload_0', size: 1, operands: [], branchTargets: [] },
      { offset: 2, opcode: 0x6b, mnemonic: 'dmul', size: 1, operands: [], branchTargets: [] },
      { offset: 3, opcode: 0x49, mnemonic: 'dstore_2', size: 1, operands: [], branchTargets: [] },
      { offset: 4, opcode: 0x28, mnemonic: 'dload_2', size: 1, operands: [], branchTargets: [] },
      { offset: 5, opcode: 0xaf, mnemonic: 'dreturn', size: 1, operands: [], branchTargets: [] },
    ],
    blocks: [{ start: 0, end: 6, instructionOffsets: [0,1,2,3,4,5], successors: [], exceptionalSuccessors: [] }],
  };
  owner.methods.push(capturedRegistration, capturedLambda, storedRegistration, storedLambda);
  const advancedRegistry = buildJavaCustomEasingRegistry([owner]);
  if (!advancedRegistry.functions.fixture_captured_curve || Math.abs(advancedRegistry.functions.fixture_captured_curve(0.5) - 1.5) > 0.000001) {
    throw new Error('A captured numeric lambda parameter was not restored from its invokedynamic call site.');
  }
  if (!advancedRegistry.functions.fixture_stored_curve || Math.abs(advancedRegistry.functions.fixture_stored_curve(0.5) - 0.25) > 0.000001) {
    throw new Error('A custom easing that stores intermediate values in JVM locals was not interpreted correctly.');
  }

  const classRegistration = {
    ...registration,
    name: 'registerClassEasing',
    instructions: [
      { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: { index: 20, tag: 8, kind: 'String', value: 'fixture_custom_class' }, branchTargets: [] },
      { offset: 1, opcode: 0xbb, mnemonic: 'new', size: 3, operands: [], constant: { index: 21, tag: 7, kind: 'Class', value: 'fixture.CustomEase' }, branchTargets: [] },
      { offset: 4, opcode: 0x59, mnemonic: 'dup', size: 1, operands: [], branchTargets: [] },
      { offset: 5, opcode: 0xb7, mnemonic: 'invokespecial', size: 1, operands: [], constant: { index: 22, tag: 10, kind: 'Methodref', owner: 'fixture.CustomEase', name: '<init>', descriptor: '()V' }, branchTargets: [] },
      { offset: 8, opcode: 0xb8, mnemonic: 'invokestatic', size: 1, operands: [], constant: { index: 23, tag: 10, kind: 'Methodref', owner: 'com.geckolib.util.GeckoLibUtil', name: 'addCustomEasingType', descriptor: '(Ljava/lang/String;Lcom/geckolib/animation/EasingType;)V' }, branchTargets: [] },
    ],
  };
  owner.methods.push(classRegistration);
  const customEaseClass = {
    path: 'fixture/CustomEase.class', name: 'fixture.CustomEase',
    superName: 'software.bernie.geckolib.animation.EasingType',
    interfaces: [], access: 0x0001, majorVersion: 61, minorVersion: 0,
    fields: [{ name: 'factor', descriptor: 'D', access: 0x0012 }],
    methods: [{
      name: '<init>', descriptor: '()V', access: 0x0001, maxStack: 3, maxLocals: 1,
      instructions: [
        { offset: 0, opcode: 0x2a, mnemonic: 'aload_0', size: 1, operands: [], branchTargets: [] },
        { offset: 1, opcode: 0x14, mnemonic: 'ldc2_w', size: 1, operands: [], constant: { value: 4 }, branchTargets: [] },
        { offset: 2, opcode: 0xb5, mnemonic: 'putfield', size: 1, operands: [], constant: { index: 40, tag: 9, kind: 'Fieldref', owner: 'fixture.CustomEase', name: 'factor', descriptor: 'D' }, branchTargets: [] },
        { offset: 3, opcode: 0xb1, mnemonic: 'return', size: 1, operands: [], branchTargets: [] },
      ],
      blocks: [{ start: 0, end: 4, instructionOffsets: [0,1,2,3], successors: [], exceptionalSuccessors: [] }],
      calls: [], fieldAccesses: [], localVariables: [], exceptionHandlers: [], codeLength: 4, decodeWarnings: [],
    }, {
      name: 'ease', descriptor: '(D)D', access: 0x0001, maxStack: 3, maxLocals: 3,
      instructions: [
        { offset: 0, opcode: 0x2a, mnemonic: 'aload_0', size: 1, operands: [], branchTargets: [] },
        { offset: 1, opcode: 0xb4, mnemonic: 'getfield', size: 1, operands: [], constant: { index: 41, tag: 9, kind: 'Fieldref', owner: 'fixture.CustomEase', name: 'factor', descriptor: 'D' }, branchTargets: [] },
        { offset: 2, opcode: 0x27, mnemonic: 'dload_1', size: 1, operands: [], branchTargets: [] },
        { offset: 3, opcode: 0x6b, mnemonic: 'dmul', size: 1, operands: [], branchTargets: [] },
        { offset: 4, opcode: 0xaf, mnemonic: 'dreturn', size: 1, operands: [], branchTargets: [] },
      ],
      blocks: [{ start: 0, end: 5, instructionOffsets: [0,1,2,3,4], successors: [], exceptionalSuccessors: [] }],
      calls: [], fieldAccesses: [], localVariables: [{ name: 'progress', descriptor: 'D', index: 1, start: 0, length: 5 }],
      exceptionHandlers: [], codeLength: 5, decodeWarnings: [],
    }],
    references: [], bootstrapMethods: [], decodeWarnings: [],
  };
  const classRegistry = buildJavaCustomEasingRegistry([owner, customEaseClass]);
  if (!classRegistry.functions.fixture_custom_class ||
      Math.abs(classRegistry.functions.fixture_custom_class(0.5) - 2) > 0.000001) {
    throw new Error('A registered GeckoLib EasingType subclass with constructor-backed numeric state was not compiled from its instance method.');
  }

  const result = analyzeChannel('rotation', {
    '0': { vector: [0, 0, 0] },
    '1': { vector: [100, 0, 0], easing: 'fixture_custom_quad' },
  }, { customEasings: registry.functions });
  if (Math.abs(result.value['0.5'][0] - 25) > 0.0001 ||
      !result.problems.some((problem) => problem.kind === 'normalised' && problem.detail.includes('fixture_custom_quad'))) {
    throw new Error('The recovered Java easing was not used to bake source keyframes.');
  }

  console.log('[PASS] A registered GeckoLib Java lambda easing is recovered from bytecode and applied to animation keyframes.');
} finally {
  await server.close();
}
