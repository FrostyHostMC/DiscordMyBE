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
  const { synthesizeAnimationControllersFromBytecode } =
    await server.ssrLoadModule('/src/utils/animationControllerSynthesizer.ts');

  const field = (owner, name) => ({
    index: 1, tag: 9, kind: 'Fieldref', owner, name, descriptor: 'Lfixture/State;',
  });
  const method = (owner, name) => ({
    index: 2, tag: 10, kind: 'Methodref', owner, name, descriptor: '()Z',
  });
  const string = (value) => ({ index: 3, tag: 8, kind: 'String', value });
  const ins = (offset, mnemonic, opcode, constant, branchTargets = []) => ({
    offset, mnemonic, opcode, size: 1, operands: [], constant, branchTargets,
  });
  const block = (start, instructionOffsets, successors = []) => ({
    start, end: start + 10, instructionOffsets, successors, exceptionalSuccessors: [],
  });
  const methodIR = (name, instructions, blocks, calls = []) => ({
    name, descriptor: '()V', access: 0x0001, maxStack: 4, maxLocals: 2,
    instructions, blocks, calls, fieldAccesses: [], localVariables: [],
    exceptionHandlers: [], codeLength: 64, decodeWarnings: [],
  });

  const stateEnum = {
    path: 'fixture/State.class', name: 'fixture.State', superName: 'java.lang.Enum',
    interfaces: [], access: 0x4001, majorVersion: 61, minorVersion: 0,
    fields: [
      { name: 'IDLE', descriptor: 'Lfixture/State;', access: 0x4019 },
      { name: 'RUN', descriptor: 'Lfixture/State;', access: 0x4019 },
    ],
    methods: [], references: [], bootstrapMethods: [], decodeWarnings: [],
  };

  const controller = {
    path: 'fixture/TestController.class', name: 'fixture.TestController',
    superName: 'java.lang.Object', interfaces: [], access: 0x0001,
    majorVersion: 61, minorVersion: 0,
    fields: [{ name: 'state', descriptor: 'Lfixture/State;', access: 0x0002 }],
    methods: [
      methodIR('<init>', [ins(0, 'getstatic', 0xb2, field('fixture.State', 'IDLE'))],
        [block(0, [0])]),
      methodIR('updateIdle', [
        ins(0, 'getstatic', 0xb2, field('fixture.State', 'IDLE')),
        ins(3, 'ldc', 0x12, string('animation.fixture.idle')),
        ins(4, 'invokevirtual', 0xb6, method('fixture.Entity', 'isMoving')),
        ins(7, 'ifne', 0x9a, undefined, [20]),
        ins(10, 'return', 0xb1, undefined),
        ins(20, 'getstatic', 0xb2, field('fixture.State', 'RUN')),
        ins(23, 'ldc', 0x12, string('animation.fixture.run')),
      ], [
        block(0, [0, 3, 4, 7], [20, 10]),
        block(10, [10], []),
        block(20, [20, 23], []),
      ], [method('fixture.Entity', 'isMoving')]),
      methodIR('updateRun', [
        ins(30, 'getstatic', 0xb2, field('fixture.State', 'RUN')),
        ins(33, 'ldc', 0x12, string('animation.fixture.run')),
        ins(34, 'invokevirtual', 0xb6, method('fixture.Entity', 'isMoving')),
        ins(37, 'ifeq', 0x99, undefined, [50]),
        ins(40, 'return', 0xb1, undefined),
        ins(50, 'getstatic', 0xb2, field('fixture.State', 'IDLE')),
        ins(53, 'ldc', 0x12, string('animation.fixture.idle')),
      ], [
        block(30, [30, 33, 34, 37], [50, 40]),
        block(40, [40], []),
        block(50, [50, 53], []),
      ], [method('fixture.Entity', 'isMoving')]),
    ],
    references: [], bootstrapMethods: [], decodeWarnings: [],
  };

  const result = synthesizeAnimationControllersFromBytecode(['fixture:entity'], {
    controllerClasses: ['fixture.TestController'],
    animationIds: ['animation.fixture.idle', 'animation.fixture.run'],
    bytecodeClasses: [controller, stateEnum],
    entityClasses: [{
      className: 'Entity', qualifiedClassName: 'fixture.Entity',
      role: 'entity', methods: [], registryIds: ['fixture:entity'],
    }],
  });

  if (result.controllers.length !== 1) {
    throw new Error('The bytecode reconstructor did not recover the explicit two-state controller graph: ' +
      JSON.stringify(result.analysis));
  }
  const recovered = result.controllers[0];
  const document = JSON.parse(recovered.json);
  const graph = document.animation_controllers[recovered.controllerId];
  if (graph.initial_state !== 'IDLE' ||
      graph.states.IDLE.animations[0] !== 'animation.fixture.idle' ||
      graph.states.RUN.animations[0] !== 'animation.fixture.run') {
    throw new Error('Recovered state bindings or initial state differ from the bytecode fixture.');
  }
  const idleToRun = graph.states.IDLE.transitions.find((entry) => entry.RUN);
  const runToIdle = graph.states.RUN.transitions.find((entry) => entry.IDLE);
  if (idleToRun?.RUN !== 'query.is_moving' || runToIdle?.IDLE !== '!query.is_moving') {
    throw new Error('Branch polarity was not reconstructed into the expected Molang state guards.');
  }
  if (result.controllerIdsByOwner['fixture:entity']?.[0] !== recovered.controllerId) {
    throw new Error('The reconstructed controller was not indexed under its resolved entity owner.');
  }

  const lambdaHandle = {
    index: 6, tag: 15, kind: 'MethodHandle',
    reference: { index: 7, tag: 10, kind: 'Methodref', owner: 'fixture.LambdaController', name: 'lambda$controller$0', descriptor: '(Lfixture/AnimationState;)V' },
  };
  const lambdaRegistration = methodIR('registerControllers', [
    ins(0, 'ldc', 0x12, string('move_controller')),
    ins(1, 'iconst_5', 0x08, undefined),
    ins(2, 'invokedynamic', 0xba, { index: 8, tag: 18, kind: 'InvokeDynamic', bootstrapMethod: { methodReference: undefined, arguments: [lambdaHandle] } }),
    ins(5, 'ldc', 0x12, string('attack_controller')),
    ins(6, 'iconst_3', 0x06, undefined),
    ins(7, 'invokedynamic', 0xba, { index: 9, tag: 18, kind: 'InvokeDynamic', bootstrapMethod: { methodReference: undefined, arguments: [{
      index: 10, tag: 15, kind: 'MethodHandle',
      reference: { index: 11, tag: 10, kind: 'Methodref', owner: 'fixture.LambdaController', name: 'lambda$controller$1', descriptor: '(Lfixture/AnimationState;)V' },
    }] } }),
    ins(10, 'invokespecial', 0xb7, method('software.bernie.geckolib.animation.AnimationController', '<init>')),
  ], [block(0, [0,1,2,5,6,7,10])], [method('software.bernie.geckolib.animation.AnimationController', '<init>')]);
  const lambdaHandler = methodIR('lambda$controller$0', [
    ins(0, 'invokevirtual', 0xb6, method('fixture.AnimationState', 'isMoving')),
    ins(3, 'ifne', 0x9a, undefined, [20]),
    ins(10, 'ldc', 0x12, string('animation.fixture.idle')),
    ins(11, 'return', 0xb1, undefined),
    ins(20, 'ldc', 0x12, string('animation.fixture.run')),
    ins(21, 'return', 0xb1, undefined),
  ], [
    block(0, [0,3], [20,10]),
    block(10, [10,11], []),
    block(20, [20,21], []),
  ], [method('fixture.AnimationState', 'isMoving')]);
  const lambdaController = {
    path: 'fixture/LambdaController.class', name: 'fixture.LambdaController',
    superName: 'java.lang.Object', interfaces: [], access: 0x0001,
    majorVersion: 61, minorVersion: 0, fields: [],
    methods: [lambdaRegistration, lambdaHandler, methodIR('lambda$controller$1', [
      ins(30, 'invokevirtual', 0xb6, method('fixture.AnimationState', 'isMoving')),
      ins(33, 'ifne', 0x9a, undefined, [50]),
      ins(40, 'ldc', 0x12, string('animation.fixture.attack_idle')),
      ins(41, 'return', 0xb1, undefined),
      ins(50, 'ldc', 0x12, string('animation.fixture.attack')),
      ins(51, 'return', 0xb1, undefined),
    ], [
      block(30, [30,33], [50,40]),
      block(40, [40,41], []),
      block(50, [50,51], []),
    ], [method('fixture.AnimationState', 'isMoving')])], references: [], bootstrapMethods: [], decodeWarnings: [],
  };
  const lambdaResult = synthesizeAnimationControllersFromBytecode(['player'], {
    controllerClasses: ['fixture.LambdaController'],
    animationIds: ['animation.fixture.idle', 'animation.fixture.run', 'animation.fixture.attack_idle', 'animation.fixture.attack'],
    bytecodeClasses: [lambdaController],
    playerClassNames: ['fixture.LambdaController'],
    entityClasses: [{
      className: 'LambdaController', qualifiedClassName: 'fixture.LambdaController',
      role: 'entity', methods: [], registryIds: ['fixture:entity'],
    }],
  });
  if (lambdaResult.controllers.length !== 2 || lambdaResult.controllers.some((entry) => entry.ownerId !== 'player')) {
    throw new Error('Multiple lambda-driven GeckoLib controllers were not reconstructed for the player owner: ' + JSON.stringify(lambdaResult.analysis));
  }
  if (new Set(lambdaResult.controllers.map((entry) => entry.controllerId)).size !== 2) {
    throw new Error('Two Java-registered controllers collapsed to the same Bedrock identifier.');
  }
  for (const entry of lambdaResult.controllers) {
    const lambdaDoc = JSON.parse(entry.json);
    const lambdaGraph = lambdaDoc.animation_controllers[entry.controllerId];
    const lambdaTransitions = lambdaGraph.states.default.transitions;
    if (lambdaGraph.initial_state !== 'default' ||
        !lambdaTransitions.some((item) => Object.values(item)[0] === 'query.is_moving') ||
        !lambdaTransitions.some((item) => Object.values(item)[0] === '!query.is_moving')) {
      throw new Error('Lambda branch predicates did not become ordered Bedrock state transitions.');
    }
    const activeStates = Object.values(lambdaGraph.states).filter((state) => Array.isArray(state.animations) && state.animations.length > 0);
    if (activeStates.length !== 2 || !activeStates.every((state) => [0.25, 0.15].includes(state.blend_transition))) {
      throw new Error('GeckoLib constructor transition ticks were not preserved as Bedrock blend_transition seconds.');
    }
  }

  console.log('[PASS] JVM enum states and multiple lambda-driven GeckoLib controllers preserve branch guards, exact clip bindings, unique identity, transition timing, and player ownership.');
} finally {
  await server.close();
}
