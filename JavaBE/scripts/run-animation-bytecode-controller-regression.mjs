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

  console.log('[PASS] JVM enum states, constructor initial state, branch polarity, Molang guards, exact clip bindings, and entity ownership reconstruct into a Bedrock controller.');
} finally {
  await server.close();
}
