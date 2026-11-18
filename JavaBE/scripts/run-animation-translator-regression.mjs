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
  const { translateJavaAnimationSet } = await server.ssrLoadModule('/src/utils/animationTranslator.ts');
  const { buildUniversalAnimationIR } = await server.ssrLoadModule('/src/utils/universalAnimationIR.ts');
  const { emitAnimationClip } = await server.ssrLoadModule('/src/utils/animationIREmitter.ts');
  const source = {
    animations: {
      event_only: {
        loop: 'once',
        start_delay: '0.1',
        loop_delay: '0.2',
        blend_weight: 'query.modified_move_speed',
        anim_time_update: 'query.anim_time + query.delta_time',
        override_previous_animation: true,
        sound_effects: {
          '0.25': [
            { effect: 'fixture:step', locator: 'foot_left', volume: 0.7, pitch: 1.1 },
            { effect: 'fixture:cloth', locator: 'body', volume: 0.5 },
          ],
        },
        particle_effects: {
          '0.5': [
            { effect: 'fixture:dust', locator: 'foot_right', bind_to_actor: false, pre_effect_script: 'variable.hit = 1;' },
          ],
        },
        timeline: { '0.75': ['variable.phase = 2;', 'variable.combo = 1;'] },
      },
    },
  };
  const translated = translateJavaAnimationSet(source, { fileHint: 'fixture' });
  const clipId = translated.idMap.event_only;
  const clip = translated.animations[clipId];
  if (!clip) throw new Error('An event-only animation clip was skipped.');
  if (translated.stats.clipsSkipped !== 0) throw new Error('The event-only clip was counted as skipped.');
  if (!Array.isArray(clip.sound_effects['0.25']) || clip.sound_effects['0.25'].length !== 2) {
    throw new Error('Simultaneous source sound cues were not translated.');
  }
  if (clip.sound_effects['0.25'][0].volume !== 0.7 || clip.sound_effects['0.25'][0].pitch !== 1.1) {
    throw new Error('Sound volume or pitch was lost.');
  }
  if (clip.animation_length !== 0.75) throw new Error('Event-only duration was not derived from the latest timed event.');
  if (clip.start_delay !== '0.1' || clip.loop_delay !== '0.2' || clip.blend_weight !== 'query.modified_move_speed') {
    throw new Error('Source animation timing or blend weight was lost.');
  }
  if (clip.override_previous_animation !== true || clip.anim_time_update !== 'query.anim_time + query.delta_time') {
    throw new Error('Source animation override/time update was lost.');
  }

  const ir = buildUniversalAnimationIR({
    discoveryReport: {
      skeletons: [],
      clipsByOwner: { fixture: { [clipId]: clip } },
      animationGraph: {},
      controllersDiscovered: [],
    },
  });
  const emitted = emitAnimationClip(ir.clips[clipId]);
  if (!emitted) throw new Error('The event-only clip did not reach the universal Bedrock emitter.');
  if (Object.keys(emitted.document.bones ?? {}).length !== 0) throw new Error('Unexpected bone tracks appeared on an event-only clip.');
  if (!Array.isArray(emitted.document.sound_effects['0.25']) || emitted.document.sound_effects['0.25'].length !== 2) {
    throw new Error('The universal emitter did not retain simultaneous sound cues.');
  }
  if (!Array.isArray(emitted.document.timeline['0.75']) || emitted.document.timeline['0.75'].length !== 2) {
    throw new Error('The universal emitter did not retain timeline script events.');
  }
  const loopTickSource = {
    animations: {
      returning_loop: {
        animation_length: 1,
        loop: false,
        loopTick: 0.4,
        anim_time_update: 'query.anim_time + query.delta_time',
        bones: { body: { rotation: { '0': [0, 0, 0], '1': [0, 90, 0] } } },
      },
    },
  };
  const loopTickResult = translateJavaAnimationSet(loopTickSource, { fileHint: 'loop-tick-fixture' });
  const loopTickClip = loopTickResult.animations[loopTickResult.idMap.returning_loop];
  if (!loopTickClip || loopTickClip.loop !== true ||
      !String(loopTickClip.anim_time_update ?? '').includes('0.4') ||
      !String(loopTickClip.anim_time_update ?? '').includes('1') ||
      !String(loopTickClip.anim_time_update ?? '').includes('query.anim_time + query.delta_time') ||
      !String(loopTickClip.anim_time_update ?? '').includes('temp.javae_loop_source_time')) {
    throw new Error('A nonzero PAL/Emotecraft loopTick was not converted into a Bedrock return-time expression.');
  }
  const loopIr = buildUniversalAnimationIR({
    discoveryReport: {
      skeletons: [],
      clipsByOwner: { fixture: { [loopTickResult.idMap.returning_loop]: loopTickClip } },
      animationGraph: {},
      controllersDiscovered: [],
    },
  });
  if (loopIr.clips[loopTickResult.idMap.returning_loop]?.timeline.loopStartSeconds !== 0.4) {
    throw new Error('Universal Animation IR did not preserve the source loopTick in seconds.');
  }

  console.log('[PASS] Generic translator and universal IR/emitter preserve event-only clips, timing, and nonzero PAL/Emotecraft loopTick return points.');
} finally {
  await server.close();
}
