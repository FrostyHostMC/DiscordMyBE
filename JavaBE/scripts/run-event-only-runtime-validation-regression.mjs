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
  const viewReport = validateAnimationRuntime({
    resourcePackFiles: {
      'animations/view.animation.json': JSON.stringify({
        format_version: '1.8.0',
        animations: { 'animation.fixture.view': { animation_length: 1, bones: { body: { rotation: { '0.0': [0,0,0], '1.0': [0,10,0] } } } } },
      }),
      'animation_controllers/view.animation_controllers.json': JSON.stringify({
        format_version: '1.10.0',
        animation_controllers: {
          'controller.animation.fixture.third': {
            initial_state: 'base',
            states: {
              base: { transitions: [{ run: '(query.modified_move_speed > 0.1) && (!query.is_first_person)' }] },
              run: { animations: ['animation.fixture.view'], transitions: [{ base: '!((query.modified_move_speed > 0.1) && (!query.is_first_person))' }] },
            },
          },
          'controller.animation.fixture.first': {
            initial_state: 'base',
            states: {
              base: { transitions: [{ first: 'query.is_first_person' }] },
              first: { animations: ['animation.fixture.view'], transitions: [{ base: '!(query.is_first_person)' }] },
            },
          },
        },
      }),
      'entity/player.entity.json': JSON.stringify({
        'minecraft:client_entity': { description: {
          identifier: 'minecraft:player',
          animations: { view: 'animation.fixture.view', third: 'controller.animation.fixture.third', first: 'controller.animation.fixture.first' },
          scripts: { animate: ['third', 'first'] },
          render_controllers: ['controller.render.player.third_person', 'controller.render.player.first_person'],
        } },
      }),
    },
  });
  if (viewReport.counts.thirdPersonStates !== 1 || viewReport.counts.firstPersonStates !== 1 ||
      !viewReport.exportedMetrics.firstPersonClipIds.includes('animation.fixture.view')) {
    throw new Error('Player controller state transitions were not included in first/third-person activation metrics: ' + JSON.stringify(viewReport.counts));
  }
  console.log('[PASS] Runtime validation accepts event-only clips while keeping bone-motion and timed-event metrics separate.');
} finally {
  await server.close();
}
