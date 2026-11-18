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
  const { buildUniversalAnimationIR } = await server.ssrLoadModule('/src/utils/universalAnimationIR.ts');
  const { emitAnimationClip } = await server.ssrLoadModule('/src/utils/animationIREmitter.ts');
  const rawClip = {
    animation_length: 1,
    loop: true,
    bones: {
      root: {
        rotation: {
          '0': { pre: [0, 0, 0], post: [1, 2, 3], lerp_mode: 'catmullrom' },
          '1': { pre: [1, 2, 3], post: [4, 5, 6] },
        },
        position: {
          '0': [0, 0, 0],
          '1': { post: [1, 0, 0], lerp_mode: 'step' },
          '2': [2, 0, 0],
        },
      },
    },
    sound_effects: {
      '0.25': [
        { effect: 'fixture:step', locator: 'foot_left', volume: 0.7, pitch: 1.1 },
        { effect: 'fixture:cloth', locator: 'body' },
      ],
    },
    particle_effects: {
      '0.5': [
        { effect: 'fixture:dust', locator: 'foot_right', bind_to_actor: false, pre_effect_script: 'variable.hit = 1;' },
      ],
    },
    timeline: {
      '0.75': ['variable.phase = 2;', 'variable.combo = 1;'],
    },
  };
  const ir = buildUniversalAnimationIR({
    discoveryReport: {
      skeletons: [],
      clipsByOwner: { fixture: { 'animation.fixture.events': rawClip } },
      animationGraph: {},
      controllersDiscovered: [],
    },
  });
  const clip = ir.clips['animation.fixture.events'];
  if (!clip) throw new Error('The source clip was not interpreted into the universal animation IR.');
  if (clip.audioReferences.length !== 2) throw new Error(`Expected 2 sound cues, got ${clip.audioReferences.length}`);
  if (clip.particleReferences.length !== 1) throw new Error(`Expected 1 particle cue, got ${clip.particleReferences.length}`);
  if (clip.customEvents.length !== 2) throw new Error(`Expected 2 timeline script events, got ${clip.customEvents.length}`);
  const emitted = emitAnimationClip(clip);
  if (!emitted) throw new Error('The universal emitter did not produce the animation.');
  const doc = emitted.document;
  const rotationStart = doc.bones.root.rotation['0'];
  if (rotationStart.pre[0] !== 0 || rotationStart.post[0] !== 1 || rotationStart.lerp_mode !== 'catmullrom') {
    throw new Error('Explicit pre/post values or Catmull-Rom interpolation were lost.');
  }
  const rotationEnd = doc.bones.root.rotation['1'];
  if (rotationEnd.pre[0] !== 1 || rotationEnd.post[0] !== 4) {
    throw new Error('The second pre/post discontinuity was not preserved.');
  }
  const stepJump = doc.bones.root.position['2'];
  if (stepJump.pre[0] !== 1 || stepJump.post[0] !== 2) {
    throw new Error('A source step segment was not represented as a Bedrock pre/post jump.');
  }
  if (!Array.isArray(doc.sound_effects['0.25']) || doc.sound_effects['0.25'].length !== 2) {
    throw new Error('Simultaneous sound cues were not preserved.');
  }
  if (doc.sound_effects['0.25'][0].locator !== 'foot_left') {
    throw new Error('The sound locator was lost.');
  }
  const particle = doc.particle_effects['0.5'];
  if (particle.bind_to_actor !== false || particle.pre_effect_script !== 'variable.hit = 1;') {
    throw new Error('Particle attachment or pre-effect script was lost.');
  }
  if (!Array.isArray(doc.timeline['0.75']) || doc.timeline['0.75'].length !== 2) {
    throw new Error('Multiple timeline scripts at one timestamp were not preserved.');
  }
  console.log('[PASS] Universal animation IR/emitter preserve pre/post transforms, Catmull-Rom, step jumps, simultaneous effects, locators, particle scripts, and timeline events.');
} finally {
  await server.close();
}
