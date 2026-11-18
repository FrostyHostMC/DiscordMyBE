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
  const { exportUniversalAnimationIR } = await server.ssrLoadModule('/src/utils/universalAnimationExporter.ts');
  const clipCount = 512;
  const clips = {};
  const channel = {
    channel: 'rotation',
    keyframes: [{
      time: 0,
      originalTime: 0,
      value: [0, 0, 0],
      interpolation: 'linear',
      isMolang: false,
      rawExtras: {},
    }],
    staticValue: [0, 0, 0],
    isStatic: true,
    minTime: 0,
    maxTime: 0,
    valueBounds: { min: [0, 0, 0], max: [0, 0, 0] },
    proceduralExpressions: [],
    unfamiliarProperties: {},
  };

  for (let index = 0; index < clipCount; index += 1) {
    const id = `animation.scale_fixture.clip_${String(index).padStart(4, '0')}`;
    clips[id] = {
      id,
      originalId: id,
      owner: 'scale_fixture',
      sourceFormat: 'synthetic-regression',
      sourcePath: 'fixture/animations.json',
      perspective: 'unspecified',
      targetClassification: 'entity',
      timeline: {
        durationSeconds: 1,
        timeUnit: 'seconds',
        fps: 20,
        startDelay: 0,
        isLooping: true,
        loopMode: 'loop',
        frameCount: 20,
      },
      bones: {
        root: {
          boneName: 'root',
          canonicalBoneName: 'root',
          childBones: [],
          hierarchyDepth: 0,
          rotation: channel,
          hasMotion: false,
          motionIntensity: 1,
          unfamiliarProperties: {},
        },
      },
      rootBones: ['root'],
      hierarchicalRelationships: [],
      proceduralBehaviors: [],
      audioReferences: [],
      particleReferences: [],
      customEvents: [],
      dependencies: [],
      unfamiliarProperties: {},
    };
  }

  const resourcePackFiles = {
    'entity/scale_fixture.entity.json': JSON.stringify({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'fixture:scale_fixture',
          materials: { default: 'entity_alphatest' },
          textures: { default: 'textures/entity/scale_fixture' },
          geometry: { default: 'geometry.scale_fixture' },
          animations: {},
          scripts: { animate: [] },
          render_controllers: ['controller.render.default'],
        },
      },
    }),
  };

  const report = exportUniversalAnimationIR({
    ir: { clips, clipCount, controllerCount: 0 },
    modId: 'scale_fixture',
    resourcePackFiles,
  });

  const animationFile = resourcePackFiles['animations/scale_fixture.ir_ported.animation.json'];
  if (report.emittedClips.length !== clipCount) {
    throw new Error(`Expected ${clipCount} emitted clips, got ${report.emittedClips.length}`);
  }
  if (report.registeredClips.length !== clipCount) {
    throw new Error(`Expected ${clipCount} registered clips, got ${report.registeredClips.length}`);
  }
  if (report.budgetExhausted) {
    throw new Error('The animation exporter reported an obsolete per-clip budget exhaustion.');
  }
  if (typeof animationFile !== 'string') {
    throw new Error('The animation output document was not written.');
  }
  const parsed = JSON.parse(animationFile);
  const writtenCount = Object.keys(parsed.animations ?? {}).length;
  if (writtenCount !== clipCount) {
    throw new Error(`Expected ${clipCount} definitions in the output document, got ${writtenCount}`);
  }

  console.log(`[PASS] Universal animation exporter emitted and registered all ${clipCount} clips without a per-clip ceiling.`);
} finally {
  await server.close();
}
