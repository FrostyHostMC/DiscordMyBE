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
  const { translatePlayerTriggers } = await server.ssrLoadModule('/src/utils/playerAnimationTriggers.ts');
  const { synthesizePlayerAnimationController } = await server.ssrLoadModule('/src/utils/playerAnimationController.ts');
  const methodRef = (name) => ({
    index: 1, tag: 10, kind: 'Methodref', owner: 'fixture.PlayerActions', name, descriptor: '()V',
  });
  const string = (value) => ({ index: 2, tag: 8, kind: 'String', value });
  const instructions = [
    { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: string('animation.fixture.attack'), branchTargets: [] },
    { offset: 1, opcode: 0xb6, mnemonic: 'invokevirtual', size: 1, operands: [], constant: methodRef('isAttacking'), branchTargets: [] },
    { offset: 2, opcode: 0x10, mnemonic: 'bipush', size: 2, operands: [12], branchTargets: [] },
    { offset: 4, opcode: 0xb6, mnemonic: 'invokevirtual', size: 1, operands: [], constant: methodRef('setPriority'), branchTargets: [] },
    { offset: 5, opcode: 0xb6, mnemonic: 'invokevirtual', size: 1, operands: [], constant: methodRef('triggerAnim'), branchTargets: [] },
  ];
  const bytecodeClass = {
    path: 'fixture/PlayerActions.class', name: 'fixture.PlayerActions', superName: 'java.lang.Object',
    interfaces: [], access: 0x0001, majorVersion: 61, minorVersion: 0, fields: [],
    methods: [{
      name: 'attack', descriptor: '()V', access: 0x0001, maxStack: 4, maxLocals: 1,
      instructions, blocks: [{ start: 0, end: 6, instructionOffsets: [0,1,2,4,5], successors: [], exceptionalSuccessors: [] }],
      calls: [methodRef('isAttacking'), methodRef('setPriority'), methodRef('triggerAnim')],
      fieldAccesses: [], localVariables: [], exceptionHandlers: [], codeLength: 6, decodeWarnings: [],
    }],
    references: [], bootstrapMethods: [], decodeWarnings: [],
  };
  const clips = {
    'animation.fixture.attack': {
      animation_length: 0.6, loop: false,
      bones: { rightArm: { rotation: { '0': [0,0,0], '0.6': [0,0,90] } } },
    },
    'animation.fixture.hurt': {
      animation_length: 0.4, loop: false,
      bones: { body: { rotation: { '0': [0,0,0], '0.4': [0,0,12] } } },
    },
  };
  const report = translatePlayerTriggers({
    clips,
    sourceClipIdsByClipId: { 'animation.fixture.attack': 'animation.fixture.attack' },
    bytecodeClasses: [bytecodeClass],
    archiveEntries: [],
  });
  const attack = report.triggers.find((trigger) => trigger.clipId === 'animation.fixture.attack');
  if (!attack || attack.status !== 'mapped' || attack.sourcePriority !== 12 || attack.runtimeTrigger !== 'triggerAnim') {
    throw new Error('Player trigger bytecode did not recover the exact clip's attack condition, priority, and runtime trigger: ' + JSON.stringify(report));
  }

  const controller = synthesizePlayerAnimationController({
    modId: 'fixture',
    clips,
    triggers: [
      attack,
      {
        clipId: 'animation.fixture.hurt', shortName: 'ported_hurt', concept: 'hurt',
        condition: 'query.hurt_time > 0', javaEvidence: 'fixture.PlayerActions.hurt',
        status: 'mapped', scriptDriven: false, perspective: 'third', note: 'fixture',
        sourcePriority: 2,
      },
    ],
  });
  const controllerJson = JSON.parse(Object.values(controller.files)[0]);
  const machine = Object.values(controllerJson.animation_controllers)[0];
  const stateNames = Object.keys(machine.states).filter((name) => name !== 'selector');
  if (!stateNames[0]?.includes('attack')) {
    throw new Error('Recovered Java source priority did not outrank the fallback concept priority: ' + stateNames.join(', '));
  }

  console.log('[PASS] Bytecode-correlated player clips recover runtime trigger calls and explicit layer priorities; the controller honors source priority over inferred concept priority.');
} finally {
  await server.close();
}
