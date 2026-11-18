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
  const { buildPlayerAnimationPort } = await server.ssrLoadModule('/src/utils/playerAnimationPipeline.ts');
  const methodRef = (name) => ({
    index: 1, tag: 10, kind: 'Methodref', owner: 'fixture.PlayerActions', name, descriptor: '()V',
  });
  const string = (value) => ({ index: 2, tag: 8, kind: 'String', value });
  const ins = (offset, mnemonic, opcode, constant, branchTargets = []) => ({
    offset, opcode, mnemonic, size: 1, operands: [], ...(constant ? { constant } : {}), branchTargets,
  });
  const block = (start, instructionOffsets, successors = []) => ({
    start, end: start + 10, instructionOffsets, successors, exceptionalSuccessors: [],
  });
  const method = (owner, name) => ({ index: 3, tag: 10, kind: 'Methodref', owner, name, descriptor: '()V' });
  const methodIR = (name, instructions, blocks, calls = []) => ({
    name, descriptor: '()V', access: 0x0001, maxStack: 4, maxLocals: 2,
    instructions, blocks, calls, fieldAccesses: [], localVariables: [],
    exceptionHandlers: [], codeLength: 64, decodeWarnings: [],
  });
  const instructions = [
    { offset: 0, opcode: 0x12, mnemonic: 'ldc', size: 1, operands: [], constant: string('animation.fixture.attack'), branchTargets: [] },
    { offset: 1, opcode: 0xb6, mnemonic: 'invokevirtual', size: 1, operands: [], constant: methodRef('isAttacking'), branchTargets: [] },
    { offset: 2, opcode: 0x10, mnemonic: 'bipush', size: 2, operands: [12], branchTargets: [] },
    { offset: 4, opcode: 0xb6, mnemonic: 'invokevirtual', size: 1, operands: [], constant: methodRef('setPriority'), branchTargets: [] },
    { offset: 5, opcode: 0xb6, mnemonic: 'invokevirtual', size: 1, operands: [], constant: methodRef('triggerAnim'), branchTargets: [] },
  ];
  const methodIR = (name, instructions, blocks, calls = []) => ({
    name, descriptor: '()V', access: 0x0001, maxStack: 4, maxLocals: 2,
    instructions, blocks, calls, fieldAccesses: [], localVariables: [],
    exceptionHandlers: [], codeLength: 64, decodeWarnings: [],
  });

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
  if (!attack || attack.status !== 'script-driven' || !attack.scriptDriven || attack.runtimeEvent !== 'entityHitEntity' || attack.sourcePriority !== 12 || attack.runtimeTrigger !== 'triggerAnim') {
    throw new Error("Player trigger bytecode did not recover the exact clip's attack condition, priority, and runtime trigger: " + JSON.stringify(report));
  }

  const playerPort = buildPlayerAnimationPort({
    modId: 'fixture',
    clips,
    triggers: [attack],
    decisions: [],
    evidence: {
      classesScanned: 0,
      playerModelClasses: [],
      playerApiTokens: [],
      firstPersonEvidence: [],
      offhandEvidence: [],
      dualWieldDetected: false,
      summary: 'fixture',
    },
  });
  if (!playerPort.scriptCode.includes('entityHitEntity') ||
      !playerPort.scriptCode.includes('javabeRuntimeWorld.afterEvents[eventName]') ||
      !playerPort.scriptCode.includes('event.damagingEntity') ||
      !playerPort.scriptCode.includes('player.playAnimation(action.clipId') ||
      playerPort.report.runtimeTriggerActions !== 1) {
    throw new Error('A bytecode-proven attack trigger did not generate a real Bedrock entityHitEntity playback adapter.');
  }

  const hurtClipId = 'animation.fixture.hurt';
  const obfuscatedHurtClass = {
    path: 'fixture/ObfuscatedPlayerHooks.class',
    name: 'fixture.ObfuscatedPlayerHooks',
    superName: 'java.lang.Object',
    interfaces: [],
    access: 0x0001,
    majorVersion: 61,
    minorVersion: 0,
    fields: [],
    methods: [{
      ...methodIR('m_12345_', [
        ins(0, 'ldc', 0x12, string(hurtClipId)),
        ins(1, 'invokevirtual', 0xb6, method('fixture.Player', 'isHurt')),
        ins(2, 'invokestatic', 0xb8, method('fixture.Controller', 'triggerAnim')),
      ], [block(0, [0,1,2])], [
        method('fixture.Player', 'isHurt'),
        method('fixture.Controller', 'triggerAnim'),
      ]),
      descriptor: '(Lnet/minecraftforge/event/entity/living/LivingHurtEvent;)V',
    }],
    references: [],
    bootstrapMethods: [],
    decodeWarnings: [],
  };
  const obfuscatedHurtReport = translatePlayerTriggers({
    clips: { ...clips, [hurtClipId]: clips['animation.fixture.attack'] },
    sourceClipIdsByClipId: { [hurtClipId]: hurtClipId },
    bytecodeClasses: [obfuscatedHurtClass],
    archiveEntries: [],
  });
  const obfuscatedHurt = obfuscatedHurtReport.triggers.find((trigger) => trigger.clipId === hurtClipId);
  if (!obfuscatedHurt || obfuscatedHurt.status !== 'script-driven' || obfuscatedHurt.runtimeEvent !== 'entityHurt') {
    throw new Error('An obfuscated Java event-handler method was not mapped from its LivingHurtEvent descriptor.');
  }
  const hurtPort = buildPlayerAnimationPort({
    modId: 'fixture',
    clips: { ...clips, [hurtClipId]: clips['animation.fixture.attack'] },
    triggers: [obfuscatedHurt],
    decisions: [],
    evidence: {
      classesScanned: 0,
      playerModelClasses: [],
      playerApiTokens: [],
      firstPersonEvidence: [],
      offhandEvidence: [],
      dualWieldDetected: false,
      summary: 'fixture',
    },
  });
  if (!hurtPort.scriptCode.includes('entityHurt') || !hurtPort.scriptCode.includes('event.hurtEntity')) {
    throw new Error('The descriptor-derived hurt event did not produce a Bedrock entityHurt adapter.');
  }

  const ambiguousClipId = 'animation.fixture.attack_alt';
  const ambiguousBytecodeClass = {
    ...bytecodeClass,
    methods: [
      ...bytecodeClass.methods,
      {
        ...bytecodeClass.methods[0],
        name: 'attackAlt',
        instructions: [
          { ...instructions[0], constant: string(ambiguousClipId) },
          ...instructions.slice(1),
        ],
      },
    ],
  };
  const ambiguousReport = translatePlayerTriggers({
    clips: { ...clips, [ambiguousClipId]: clips['animation.fixture.attack'] },
    sourceClipIdsByClipId: {
      'animation.fixture.attack': 'animation.fixture.attack',
      [ambiguousClipId]: ambiguousClipId,
    },
    bytecodeClasses: [ambiguousBytecodeClass],
    archiveEntries: [],
  });
  const ambiguousTriggers = ambiguousReport.triggers.filter((trigger) =>
    trigger.clipId === 'animation.fixture.attack' || trigger.clipId === ambiguousClipId);
  if (ambiguousTriggers.length !== 2 ||
      ambiguousTriggers.some((trigger) => trigger.status !== 'unresolved' || trigger.scriptDriven || trigger.runtimeEvent)) {
    throw new Error('Two clips sharing one inferred runtime event must be withheld rather than both firing and overriding each other.');
  }

  const priorityAttack = {
    ...attack,
    status: 'mapped',
    scriptDriven: false,
    runtimeEvent: undefined,
    runtimeTrigger: undefined,
    condition: 'variable.attack_time > 0.05',
  };

  const controller = synthesizePlayerAnimationController({
    modId: 'fixture',
    clips,
    triggers: [
      priorityAttack,
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
  const orderedClips = Object.values(machine.states).flatMap((state) => Array.isArray(state.animations) ? state.animations : []);
  if (orderedClips[0] !== priorityAttack.clipId) {
    throw new Error('Recovered Java source priority did not outrank the fallback concept priority: ' + orderedClips.join(', '));
  }

  console.log('[PASS] Bytecode-correlated player clips generate Bedrock after-event playback, infer obfuscated event methods from descriptors, withhold ambiguous same-event clips, and preserve explicit source layer priority.');
} finally {
  await server.close();
}
