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
  const { extractBbModelAnimations } = await server.ssrLoadModule('/src/utils/bbmodelImporter.ts');
  const source = {
    meta: { format_version: '5.0', model_format: 'free' },
    groups: [{ uuid: 'body-group-uuid', name: 'body' }],
    outliner: [{ uuid: 'body-group-uuid', name: 'body', children: [] }],
    animations: [{
      name: 'complex_motion',
      loop: 'loop',
      length: 1.5,
      snapping: 24,
      start_delay: '0.2',
      loop_delay: '0.3',
      blend_weight: 'query.modified_move_speed',
      anim_time_update: 'query.anim_time + query.delta_time',
      override: true,
      animators: {
        'body-group-uuid': {
          keyframes: [
            { channel: 'rotation', time: 0, interpolation: 'linear', data_points: [{ x: 0, y: 0, z: 0 }] },
            { channel: 'rotation', time: 1, interpolation: 'catmullrom', data_points: [{ x: 10, y: 20, z: 30 }] },
            { channel: 'position', time: 0, interpolation: 'bezier', data_points: [{ x: 0, y: 0, z: 0 }], bezier_right_time: [0.25, 0.25, 0.25], bezier_right_value: [0, 1, 0] },
            { channel: 'position', time: 1, interpolation: 'linear', data_points: [{ x: 4, y: 0, z: 0 }], bezier_left_time: [-0.25, -0.25, -0.25], bezier_left_value: [0, -1, 0] },
          ],
        },
        effects: {
          keyframes: [
            { channel: 'sound', time: 0.25, data_points: [{ effect: 'fixture:step', locator: 'foot_left', volume: 0.7, pitch: 1.1 }] },
            { channel: 'particle', time: 0.5, data_points: [{ effect: 'fixture:dust', locator: 'foot_right', bind_to_actor: false, script: 'variable.hit = 1;' }] },
            { channel: 'timeline', time: 0.75, data_points: [{ script: 'variable.phase = 2;' }, { script: 'variable.combo = 1;' }] },
          ],
        },
      },
    }],
  };
  const result = extractBbModelAnimations(JSON.stringify(source), 'fixture');
  const clip = result.clips['animation.fixture.complex_motion'];
  if (!clip) throw new Error('Blockbench animation was not imported.');
  if (!clip.bones.body) throw new Error('Blockbench 5.0 animator UUID did not resolve to the declared group name.');
  if (clip.bones.body.rotation['1'].lerp_mode !== 'catmullrom') throw new Error('Catmull-Rom interpolation was not preserved.');
  for (const time of ['0.25', '0.5', '0.75']) {
    if (!clip.bones.body.position[time]) throw new Error('Bezier curve sample missing at ' + time + 's.');
  }
  const duplicateSource = JSON.parse(JSON.stringify(source));
  duplicateSource.animations.push({ ...duplicateSource.animations[0], animators: { 'body-group-uuid': { name: 'body', keyframes: [{ channel: 'rotation', time: 0, data_points: [{ x: 0, y: 0, z: 0 }] }] } } });
  const duplicateResult = extractBbModelAnimations(JSON.stringify(duplicateSource), 'fixture');
  if (!duplicateResult.clips['animation.fixture.complex_motion_2']) throw new Error('Duplicate source animation names overwrote an earlier clip.');
  if (clip.start_delay !== '0.2' || clip.loop_delay !== '0.3' || clip.blend_weight !== 'query.modified_move_speed') {
    throw new Error('Blockbench animation timing/blending properties were lost.');
  }
  if (clip.override_previous_animation !== true || clip.anim_time_update !== 'query.anim_time + query.delta_time') {
    throw new Error('Blockbench override/time-update properties were lost.');
  }
  if (clip.sound_effects['0.25'].locator !== 'foot_left') throw new Error('Blockbench sound locator was lost.');
  if (clip.particle_effects['0.5'].bind_to_actor !== false || clip.particle_effects['0.5'].pre_effect_script !== 'variable.hit = 1;') {
    throw new Error('Blockbench particle attachment or initialization script was lost.');
  }
  if (!Array.isArray(clip.timeline['0.75']) || clip.timeline['0.75'].length !== 2) {
    throw new Error('Blockbench timeline instruction keyframes were lost.');
  }
  console.log('[PASS] Blockbench UUID rigs, Bezier baking, Catmull-Rom, duplicate clip names, effects animator, timeline scripts, and timing are imported.');
} finally {
  await server.close();
}
