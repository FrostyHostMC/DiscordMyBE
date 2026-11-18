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
  const { validateAnimationRuntime } = await server.ssrLoadModule('/src/utils/animationRuntimeValidator.ts');
  const report = validateAnimationRuntime({
    resourcePackFiles: {
      'animations/fixture.animation.json': JSON.stringify({
        format_version: '1.8.0',
        animations: {
          'animation.fixture.event_only': {
            animation_length: 1,
            sound_effects: { '0.25': [{ effect: 'fixture:step', locator: 'foot' }] },
            particle_effects: { '0.5': { effect: 'fixture:dust', bind_to_actor: false } },
            timeline: { '0.75': 'variable.phase = 2;' },
          },
        },
      }),
    },
  });
  const definitions = report.checks.find((check) => check.id === 'definitions');
  if (!definitions || definitions.status !== 'pass') {
    throw new Error('The runtime validator incorrectly rejects an event-only animation definition.');
  }
  if (report.counts.definitionsWithMotion !== 0 || report.counts.definitionsWithTimedEvents !== 1) {
    throw new Error('Event-only definition metrics were not separated from bone-motion metrics.');
  }
  if (report.errors.some((error) => error.includes('declares no bone channel or timed effect/timeline event'))) {
    throw new Error('A valid event-only animation was reported as empty.');
  }
  console.log('[PASS] Runtime validation accepts event-only clips while keeping bone-motion and timed-event metrics separate.');
} finally {
  await server.close();
}
