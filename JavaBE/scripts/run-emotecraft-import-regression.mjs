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
  const source = {
    name: 'legacy_dance',
    author: 'fixture',
    emote: {
      isLoop: 'false',
      beginTick: 0,
      endTick: 40,
      stopTick: 50,
      degrees: false,
      easeBeforeKeyframe: false,
      moves: [
        { tick: 0, easing: 'EaseInQuad', head: { pitch: 0, x: 0 } },
        { tick: 20, easing: 'linear', turn: 0, head: { pitch: Math.PI / 2, x: 2 } },
        { tick: 40, easing: 'linear', head: { pitch: Math.PI / 2, x: 2 } },
      ],
    },
  };
  const translated = translateJavaAnimationSet(source, { fileHint: 'fixture' });
  const id = translated.idMap.legacy_dance;
  const clip = translated.animations[id];
  if (!clip) throw new Error('Legacy Emotecraft moves[] animation was not imported.');
  if (clip.animation_length !== 2.5 || clip.loop !== false) throw new Error('Emotecraft begin/end/stop timing was not translated.');
  if (Math.abs(clip.bones.head.rotation['0.5'][0] - 22.5) > 0.0001) {
    throw new Error('Emotecraft easing-after-frame or radians-to-degrees conversion was not applied.');
  }
  if (clip.bones.head.rotation['2.5'][0] !== 0) {
    throw new Error('Emotecraft stopTick pose reset keyframe was not emitted.');
  }

  const constant = translateJavaAnimationSet({
    name: 'constant_emote',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      moves: [
        { tick: 0, easing: 'constant', head: { yaw: 0 } },
        { tick: 20, easing: 'linear', head: { yaw: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const constantClip = constant.animations[constant.idMap.constant_emote];
  const jump = constantClip.bones.head.rotation['1'];
  if (jump.pre[1] !== 0 || jump.post[1] !== 90) {
    throw new Error('Emotecraft constant easing was not represented as a pre/post jump.');
  }

  const turn = translateJavaAnimationSet({
    name: 'turn_emote',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      moves: [
        { tick: 0, head: { yaw: 0 } },
        { tick: 20, turn: 1, head: { yaw: 0 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const turnClip = turn.animations[turn.idMap.turn_emote];
  if (turnClip.bones.head.rotation['1'][1] !== 360) {
    throw new Error('Emotecraft full-turn values were not preserved.');
  }

  const loopIntro = translateJavaAnimationSet({
    name: 'loop_intro',
    emote: {
      isLoop: true,
      beginTick: 0,
      returnTick: 10,
      endTick: 30,
      stopTick: 30,
      moves: [{ tick: 0, head: { yaw: 0 } }, { tick: 30, head: { yaw: 90 } }],
    },
  }, { fileHint: 'fixture' });
  const loopClip = loopIntro.animations[loopIntro.idMap.loop_intro];
  if (loopClip.loop !== true || typeof loopClip.anim_time_update !== 'string' ||
      !loopClip.anim_time_update.includes('math.mod') || !loopClip.anim_time_update.includes('0.5')) {
    throw new Error('A nonzero Emotecraft returnTick was not compiled into an intro-once / returnTick-to-end loop timeline.');
  }

  const splitEasing = translateJavaAnimationSet({
    name: 'split_part_easing',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      easeBeforeKeyframe: true,
      moves: [
        { tick: 0, head: { pitch: 0 }, torso: { pitch: 0 } },
        { tick: 10, easing: 'easeInQuad', head: { pitch: 45 } },
        { tick: 10, easing: 'easeOutQuad', torso: { pitch: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const splitClip = splitEasing.animations[splitEasing.idMap.split_part_easing];
  if (splitClip.bones.head.rotation['0.5'].easing !== 'easeInQuad' ||
      splitClip.bones.body.rotation['0.5'].easing !== 'easeOutQuad' ||
      splitEasing.issues.some((issue) => issue.detail.includes('conflicting easing values across split part keyframes'))) {
    throw new Error('Split Emotecraft part tracks did not retain their independent easing declarations.');
  }

  console.log('[PASS] Emotecraft moves, tick timing, per-part easing, radians, turns, stop reset, and nonzero returnTick looping are imported.');
} finally {
  await server.close();
}
