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
      returnTick: 5,
      endTick: 30,
      stopTick: 30,
      moves: [
        { tick: 0, head: { yaw: 0 } },
        { tick: 10, head: { yaw: 45 } },
        { tick: 30, head: { yaw: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const loopClip = loopIntro.animations[loopIntro.idMap.loop_intro];
  if (loopClip.loop !== true || loopClip.animation_length !== 1.5 ||
      typeof loopClip.anim_time_update !== 'string' ||
      !loopClip.anim_time_update.includes('math.mod') ||
      !loopClip.anim_time_update.includes('query.life_time') ||
      loopClip.anim_time_update.includes('query.anim_time') ||
      !loopClip.anim_time_update.includes('1.5') ||
      !loopClip.anim_time_update.includes('0.25') ||
      !loopClip.anim_time_update.includes('1.25') ||
      loopClip.bones.head.rotation['1.5'][1] !== 90 ||
      loopClip.bones.head.rotation['1.8'] !== undefined) {
    throw new Error('A nonzero Emotecraft returnTick was not compiled into an exact endTick-to-returnTick loop cycle.');
    const loopTimeAt = (elapsed, intro, start, duration, delta = 0.05) =>
      elapsed < intro ? elapsed + delta : start + ((elapsed - intro) % duration);
    if (Math.abs(loopTimeAt(1.5, 1.5, 0.25, 1.25) - 0.25) > 1e-9 ||
        Math.abs(loopTimeAt(1.55, 1.5, 0.25, 1.25) - 0.30) > 1e-9 ||
        Math.abs(loopTimeAt(2.8, 1.5, 0.25, 1.25) - 0.25) > 1e-9) {
      throw new Error('The returnTick clock did not land on the exact loop point and preserve the subsequent cycle.');
    }
  }

  const fadeIn = translateJavaAnimationSet({
    name: 'begin_tick_fade',
    emote: {
      isLoop: false,
      beginTick: 5,
      endTick: 20,
      stopTick: 30,
      degrees: true,
      easeBeforeKeyframe: true,
      moves: [{ tick: 10, easing: 'easeInQuad', head: { pitch: 90 } }],
    },
  }, { fileHint: 'fixture' });
  const fadeInClip = fadeIn.animations[fadeIn.idMap.begin_tick_fade];
  if (Math.abs(fadeInClip.bones.head.rotation['0.25'][0] - 45) > 0.001) {
    throw new Error('Emotecraft beginTick did not use the default ease-in-out-sine fade into the first keyframe.');
  }

  const fadeOut = translateJavaAnimationSet({
    name: 'end_tick_fade',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 30,
      degrees: true,
      easeBeforeKeyframe: true,
      moves: [
        { tick: 0, head: { pitch: 0 } },
        { tick: 10, easing: 'easeInQuad', head: { pitch: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const fadeOutClip = fadeOut.animations[fadeOut.idMap.end_tick_fade];
  if (Math.abs(fadeOutClip.bones.head.rotation['1.25'][0] - 45) > 0.001) {
    throw new Error('Emotecraft endTick reset did not use the source default sine easing when easeBeforeKeyframe is enabled.');
  }

  const fadeInLegacy = translateJavaAnimationSet({
    name: 'begin_tick_fade_legacy_easing',
    emote: {
      isLoop: false,
      beginTick: 5,
      endTick: 20,
      stopTick: 30,
      degrees: true,
      easeBeforeKeyframe: false,
      moves: [{ tick: 10, easing: 'easeInQuad', head: { pitch: 90 } }],
    },
  }, { fileHint: 'fixture' });
  const fadeInLegacyClip = fadeInLegacy.animations[fadeInLegacy.idMap.begin_tick_fade_legacy_easing];
  if (Math.abs(fadeInLegacyClip.bones.head.rotation['0.25'][0] - 22.5) > 0.001) {
    throw new Error('Emotecraft beginTick did not use the last-keyframe easing when easeBeforeKeyframe is disabled.');
  }

  const fadeOutLegacy = translateJavaAnimationSet({
    name: 'end_tick_fade_legacy_easing',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 30,
      degrees: true,
      easeBeforeKeyframe: false,
      moves: [
        { tick: 0, easing: 'linear', head: { pitch: 0 } },
        { tick: 10, easing: 'easeInQuad', head: { pitch: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const fadeOutLegacyClip = fadeOutLegacy.animations[fadeOutLegacy.idMap.end_tick_fade_legacy_easing];
  if (Math.abs(fadeOutLegacyClip.bones.head.rotation['1.25'][0] - 67.5) > 0.001) {
    throw new Error('Emotecraft endTick reset did not use the last-keyframe easing when easeBeforeKeyframe is disabled.');
  }

  const stepClipResult = translateJavaAnimationSet({
    name: 'step_easing',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      easeBeforeKeyframe: true,
      moves: [
        { tick: 0, head: { pitch: 0 } },
        { tick: 10, easing: 'step', head: { pitch: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const stepClip = stepClipResult.animations[stepClipResult.idMap.step_easing];
  const stepKey = stepClip.bones.head.rotation['0.5'];
  if (Math.abs(stepClip.bones.head.rotation['0.25'][0] - 45) > 0.001 ||
      Math.abs(stepKey.pre[0] - 45) > 0.001 ||
      Math.abs(stepKey.post[0] - 90) > 0.001) {
    throw new Error('Emotecraft STEP easing did not preserve its plateau and exact endpoint jump.');
  }

  const zeroReturnLoop = translateJavaAnimationSet({
    name: 'zero_return_loop',
    emote: {
      isLoop: true,
      returnTick: 1,
      endTick: 30,
      moves: [
        { tick: 0, head: { yaw: 0 } },
        { tick: 10, head: { yaw: 45 } },
        { tick: 30, head: { yaw: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const zeroReturnClip = zeroReturnLoop.animations[zeroReturnLoop.idMap.zero_return_loop];
  if (zeroReturnClip.loop !== true || zeroReturnClip.animation_length !== 1.5 ||
      typeof zeroReturnClip.anim_time_update !== 'string' ||
      !zeroReturnClip.anim_time_update.includes('query.life_time') ||
      zeroReturnClip.anim_time_update.includes('query.anim_time') ||
      !zeroReturnClip.anim_time_update.includes('0.05') ||
      !zeroReturnClip.anim_time_update.includes('1.45') ||
      zeroReturnClip.bones.head.rotation['1.5'][1] !== 90 ||
      zeroReturnClip.bones.head.rotation['2'] !== undefined) {
    throw new Error('Emotecraft returnTick=1 was incorrectly shifted to tick zero or extended past endTick.');
    const zeroReturnTimeAt = (elapsed, delta = 0.05) => elapsed < 1.5 ? elapsed + delta : 0.05 + ((elapsed - 1.5) % 1.45);
    if (Math.abs(zeroReturnTimeAt(1.5) - 0.05) > 1e-9 || Math.abs(zeroReturnTimeAt(1.55) - 0.10) > 1e-9) {
      throw new Error('returnTick=1 did not land on exactly 0.05 seconds after the intro.');
    }
  }

  const splitEasing = translateJavaAnimationSet({
    name: 'split_part_easing',
    version: 3,
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      easeBeforeKeyframe: true,
      moves: [
        { tick: 0, head: { pitch: 0, yaw: 0 }, torso: { pitch: 0 } },
        { tick: 10, easing: 'easeInQuad', head: { pitch: 45 } },
        { tick: 10, easing: 'easeOutQuad', head: { yaw: 90 }, torso: { pitch: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const splitClip = splitEasing.animations[splitEasing.idMap.split_part_easing];
  if (Math.abs(splitClip.bones.head.rotation['0.25'][0] - 11.25) > 0.001 ||
      Math.abs(splitClip.bones.head.rotation['0.25'][1] - 67.5) > 0.001 ||
      Math.abs(splitClip.bones.body.rotation['0.25'][0] - 67.5) > 0.001 ||
      splitEasing.issues.some((issue) => issue.detail.includes('conflicting easing values across split part keyframes'))) {
    throw new Error('Split Emotecraft part tracks did not retain their independent easing curves.');
  }

  const playerTransforms = translateJavaAnimationSet({
    version: 3,
    name: 'playeranimator_coordinates',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: false,
      moves: [
        { tick: 0, rightArm: { x: -5, y: 2 }, torso: { x: 0, pitch: 0 }, body: { x: 0, pitch: 0 } },
        { tick: 10, rightArm: { x: -4, y: 4, pitch: 1 }, torso: { x: 2, pitch: 1 }, body: { x: 3, pitch: 2 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const playerClip = playerTransforms.animations[playerTransforms.idMap.playeranimator_coordinates];
  if (playerClip.bones.right_arm.position['0.5'][0] !== 16 ||
      playerClip.bones.right_arm.position['0.5'][1] !== -32 ||
      playerClip.bones.body.position['0.5'][0] !== 32 ||
      playerClip.bones.waist.position['0.5'][0] !== -48 ||
      Math.abs(playerClip.bones.body.rotation['0.5'][0] - 57.2957795) > 0.001 ||
      Math.abs(playerClip.bones.waist.rotation['0.5'][0] + 114.591559) > 0.001 ||
      Math.abs(playerClip.bones.right_arm.rotation['0.5'][0] - 57.2957795) > 0.001) {
    throw new Error('Emotecraft waist/torso hierarchy, limb pivot offsets, Bedrock position units, or rotation signs were not reconstructed.');
  }

  const step = translateJavaAnimationSet({
    version: 3,
    name: 'playeranimator_step_easing',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      easeBeforeKeyframe: true,
      moves: [
        { tick: 0, head: { pitch: 0 } },
        { tick: 20, easing: 'step', head: { pitch: 90 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const fullStepClip = step.animations[step.idMap.playeranimator_step_easing];
  const finalStep = fullStepClip.bones.head.rotation['1'];
  if (fullStepClip.bones.head.rotation['0.25'][0] !== 0 ||
      fullStepClip.bones.head.rotation['0.5'][0] !== 45 ||
      finalStep.pre[0] !== 45 || finalStep.post[0] !== 90) {
    throw new Error('PlayerAnimator STEP easing did not retain its source two-step curve and exact endpoint.');
  }

  const scale = translateJavaAnimationSet({
    name: 'scale_channels',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 30,
      degrees: true,
      easeBeforeKeyframe: false,
      moves: [
        { tick: 0, easing: 'easeInQuad', rightArm: { scaleX: 1, scaleY: 1, scaleZ: 1 } },
        { tick: 10, easing: 'linear', rightArm: { scaleX: 2, scaleY: 0.5, scaleZ: 1.5 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const scaleClip = scale.animations[scale.idMap.scale_channels];
  const scaleAtQuarter = scaleClip.bones.right_arm.scale['0.25'];
  if (Math.abs(scaleAtQuarter[0] - 1.25) > 0.001 ||
      Math.abs(scaleAtQuarter[1] - 0.875) > 0.001 ||
      Math.abs(scaleAtQuarter[2] - 1.125) > 0.001 ||
      scaleClip.bones.right_arm.scale['1.5'].some((value) => value !== 1)) {
    throw new Error('Emotecraft per-axis scale channels or scale reset were not imported.');
  }

  const bend = translateJavaAnimationSet({
    name: 'bend_axis',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 30,
      degrees: false,
      easeBeforeKeyframe: true,
      moves: [
        { tick: 0, rightArm: { bend: 0 } },
        { tick: 10, easing: 'linear', rightArm: { bend: 0.5, axis: [0, 1, 0] } },
      ],
    },
  }, { fileHint: 'fixture' });
  const bendClip = bend.animations[bend.idMap.bend_axis];
  const bendVector = bendClip.bones.right_arm_bend.rotation['0.5'];
  const bendPosition = bendClip.bones.right_arm_bend.position['0.5'];
  const bendRadians = 0.5 * Math.PI / 180;
  if (Math.abs(bendVector[0] - 0.5) > 0.001 ||
      Math.abs(bendVector[1]) > 0.001 || Math.abs(bendVector[2]) > 0.001 ||
      Math.abs(bendPosition[1] - 2 * (1 - Math.cos(bendRadians))) > 0.001 ||
      Math.abs(bendPosition[2] + 2 * Math.sin(bendRadians)) > 0.001 ||
      !bend.issues.some((issue) => issue.detail.includes('rightArm.axis at tick 10'))) {
    throw new Error('Emotecraft scalar bend angle or the generated bend-segment arc was not reconstructed.');
  }

  const bendObject = translateJavaAnimationSet({
    name: 'bend_value_object',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 10,
      stopTick: 10,
      degrees: true,
      moves: [
        { tick: 0, leftLeg: { bend: { value: -30 } } },
        { tick: 10, leftLeg: { bend: { value: 45 } } },
      ],
    },
  }, { fileHint: 'fixture' });
  const objectBend = bendObject.animations[bendObject.idMap.bend_value_object].bones.left_leg_bend.rotation['0.5'];
  if (objectBend[0] !== 45) throw new Error('PAL bend { value } keyframes were not imported.');

  const negativeBend = translateJavaAnimationSet({
    name: 'negative_bend_arc',
    emote: {
      isLoop: false,
      beginTick: 0,
      endTick: 20,
      stopTick: 20,
      degrees: true,
      moves: [
        { tick: 0, rightArm: { bend: 0 } },
        { tick: 20, rightArm: { bend: -45 } },
      ],
    },
  }, { fileHint: 'fixture' });
  const negativeBendTrack = negativeBend.animations[negativeBend.idMap.negative_bend_arc].bones.right_arm_bend;
  if (negativeBendTrack.rotation['1'][0] !== -45 || negativeBendTrack.position['1'][2] <= 0) {
    throw new Error('Negative Emotecraft bend angles must reverse the child segment arc instead of being forced positive.');
  }

  console.log('[PASS] Emotecraft moves, tick timing, per-part easing, radians, turns, player pivots/units, bend axes, stop reset, and exact nonzero returnTick looping are imported.');
} finally {
  await server.close();
}
