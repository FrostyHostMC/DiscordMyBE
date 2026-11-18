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
  if (loopClip.loop !== true || loopClip.animation_length !== 2.8 ||
      typeof loopClip.anim_time_update !== 'string' ||
      !loopClip.anim_time_update.includes('math.mod') ||
      !loopClip.anim_time_update.includes('1.5') ||
      !loopClip.anim_time_update.includes('1.3') ||
      loopClip.bones.head.rotation['1.5'][1] !== 90 ||
      loopClip.bones.head.rotation['1.8'][1] !== 45) {
    throw new Error('A nonzero Emotecraft returnTick was not compiled into a full first play, loop seam blend, and returnTick-to-end cycle.');
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
  if (zeroReturnClip.loop !== true || zeroReturnClip.animation_length !== 3 ||
      typeof zeroReturnClip.anim_time_update !== 'string' ||
      zeroReturnClip.bones.head.rotation['1.5'][1] !== 90 ||
      zeroReturnClip.bones.head.rotation['2'][1] !== 45) {
    throw new Error('Emotecraft returnTick=1 did not preserve the source loop seam from tick zero.');
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
  const stepClip = step.animations[step.idMap.playeranimator_step_easing];
  if (stepClip.bones.head.rotation['0.25'][0] !== 0 ||
      stepClip.bones.head.rotation['0.5'][0] !== 45 ||
      stepClip.bones.head.rotation['1'][0] !== 90) {
    throw new Error('PlayerAnimator STEP easing did not retain its source two-step curve.');
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
        { tick: 10, easing: 'linear', rightArm: { bend: 0.5 } },
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
      Math.abs(bendPosition[2] + 2 * Math.sin(bendRadians)) > 0.001) {
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

  console.log('[PASS] Emotecraft moves, tick timing, per-part easing, radians, turns, player pivots/units, bend axes, stop reset, and nonzero returnTick looping are imported.');
} finally {
  await server.close();
}
