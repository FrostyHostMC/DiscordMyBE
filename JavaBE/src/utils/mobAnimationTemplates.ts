import { generateEggColors } from '@/utils/bedrockIds';

/**
 * Automated Bedrock Mob Animation & Controller Templates
 * Rule-based generation of 1:1 mob locomotion cycles, wing flaps, attack lunges, and Molang state controllers.
 */

export type MobRigKind = 'flying' | 'quadruped' | 'amorphous' | 'biped';
export type MobAnimationAliases = Partial<Record<'idle' | 'walk' | 'fly' | 'attack' | 'hurt' | 'death', string>>;

/**
 * Classifies a mob's body plan from its recovered skeleton ONLY. Name keywords are
 * never consulted: they drove ground mobs through aerial flight cycles and gave
 * quadruped skeletons a humanoid walk. When no skeleton was recovered the standard
 * Bedrock rig is used, which is a biped by construction.
 */
export function classifyMobRig(boneNames: string[] = [], isFlightBehavior = false): MobRigKind {
  const bones = boneNames.filter(Boolean).map((name) => name.toLowerCase());
  const wings = bones.filter((bone) => /wing|rotor|blade|prop|fan|feather/.test(bone));
  const legs = bones.filter((bone) => /leg|foot|thigh|knee|shin|hoof|paw|bipedleftleg|bipedrightleg/.test(bone));
  const hasTail = bones.some((bone) => /tail/.test(bone));
  const arms = bones.filter((bone) => /arm|hand|claw|shoulder|forearm|bipedleftarm|bipedrightarm/.test(bone));
  const hasHead = bones.some((bone) => /head|skull|jaw|neck|muzzle/.test(bone));

  if (bones.length > 0) {
    if (legs.length >= 4 || (hasTail && legs.length >= 3)) return 'quadruped';
    // If it has biped limbs (2 legs + arms/head), it is a biped ground mob,
    // even if it has decorative back wings or horns (e.g. demons, gargoyles)
    if (legs.length >= 2 && (arms.length >= 1 || hasHead) && !isFlightBehavior) return 'biped';
    // Flying is classified when flight behavior is detected or wing bones dominate with no walking legs
    if ((wings.length >= 2 || isFlightBehavior) && legs.length <= 2 && arms.length === 0) return 'flying';
    if (bones.length <= 3 && !hasHead && arms.length === 0 && legs.length === 0) {
      return 'amorphous';
    }
  }
  return 'biped';
}

export function generateMobAnimations(
  mobId: string,
  isFlying: boolean,
  isSlime: boolean,
  rig?: MobRigKind,
): string {
  // Common multi-bone animation suite: guarantees EVERY animation referenced by client_entity or controllers exists
  // Includes idle, walk, fly, attack, hurt, and death for 100% engine parity.
  if (isSlime) {
    return JSON.stringify(
      {
        format_version: '1.8.0',
        animations: {
          [`animation.${mobId}.idle`]: {
            loop: true,
            animation_length: 1.2,
            bones: {
              body: {
                scale: {
                  '0.0': [1.0, 1.0, 1.0],
                  '0.6': [1.08, 0.92, 1.08],
                  '1.2': [1.0, 1.0, 1.0],
                },
              },
            },
          },
          [`animation.${mobId}.walk`]: {
            loop: true,
            animation_length: 0.8,
            bones: {
              body: {
                scale: {
                  '0.0': [1.25, 0.75, 1.25],
                  '0.2': [0.85, 1.35, 0.85],
                  '0.5': [1.1, 0.9, 1.1],
                  '0.8': [1.25, 0.75, 1.25],
                },
                position: {
                  '0.0': [0, 0, 0],
                  '0.2': [0, 1.8, 0],
                  '0.5': [0, 0.4, 0],
                  '0.8': [0, 0, 0],
                },
              },
            },
          },
          ...(isFlying
            ? {
                [`animation.${mobId}.fly`]: {
                  loop: true,
                  animation_length: 0.8,
                  bones: {
                    body: {
                      scale: {
                        '0.0': [1.1, 0.9, 1.1],
                        '0.4': [0.95, 1.05, 0.95],
                        '0.8': [1.1, 0.9, 1.1],
                      },
                      position: {
                        '0.0': [0, 0.5, 0],
                        '0.4': [0, 1.5, 0],
                        '0.8': [0, 0.5, 0],
                      },
                    },
                  },
                },
              }
            : {}),
          [`animation.${mobId}.attack`]: {
            loop: false,
            animation_length: 0.4,
            bones: {
              body: {
                scale: {
                  '0.0': [1.0, 1.0, 1.0],
                  '0.15': [1.4, 0.6, 1.4],
                  '0.3': [0.8, 1.3, 0.8],
                  '0.4': [1.0, 1.0, 1.0],
                },
              },
            },
          },
          [`animation.${mobId}.hurt`]: {
            loop: false,
            animation_length: 0.25,
            bones: {
              body: {
                scale: {
                  '0.0': [1.0, 1.0, 1.0],
                  '0.1': [1.2, 0.8, 1.2],
                  '0.25': [1.0, 1.0, 1.0],
                },
              },
            },
          },
          [`animation.${mobId}.death`]: {
            loop: false,
            animation_length: 0.5,
            bones: {
              body: {
                scale: {
                  '0.0': [1.0, 1.0, 1.0],
                  '0.2': [1.6, 0.3, 1.6],
                  '0.5': [0.0, 0.0, 0.0],
                },
              },
            },
          },
        },
      },
      null,
      2,
    );
  }

  if (isFlying) {
    return JSON.stringify(
      {
        format_version: '1.8.0',
        animations: {
          [`animation.${mobId}.fly`]: {
            loop: true,
            animation_length: 0.24,
            bones: {
              left_wing: {
                rotation: {
                  '0.0': [0, 0, -42],
                  '0.12': [0, 0, 45],
                  '0.24': [0, 0, -42],
                },
              },
              right_wing: {
                rotation: {
                  '0.0': [0, 0, 42],
                  '0.12': [0, 0, -45],
                  '0.24': [0, 0, 42],
                },
              },
              body: {
                position: {
                  '0.0': [0, 0, 0],
                  '0.12': [0, 0.6, 0],
                  '0.24': [0, 0, 0],
                },
                rotation: {
                  '0.0': [5, 0, 0],
                  '0.12': [12, 0, 0],
                  '0.24': [5, 0, 0],
                },
              },
            },
          },
          [`animation.${mobId}.walk`]: {
            loop: true,
            animation_length: 0.4,
            bones: {
              left_wing: {
                rotation: {
                  '0.0': [0, 0, -20],
                  '0.2': [0, 0, 20],
                  '0.4': [0, 0, -20],
                },
              },
              right_wing: {
                rotation: {
                  '0.0': [0, 0, 20],
                  '0.2': [0, 0, -20],
                  '0.4': [0, 0, 20],
                },
              },
              body: {
                position: {
                  '0.0': [0, 0, 0],
                  '0.2': [0, 0.3, 0],
                  '0.4': [0, 0, 0],
                },
              },
            },
          },
          [`animation.${mobId}.idle`]: {
            loop: true,
            animation_length: 1.4,
            bones: {
              body: {
                position: {
                  '0.0': [0, 0, 0],
                  '0.7': [0, 0.8, 0],
                  '1.4': [0, 0, 0],
                },
              },
              left_wing: {
                rotation: {
                  '0.0': [0, 0, -15],
                  '0.7': [0, 0, 20],
                  '1.4': [0, 0, -15],
                },
              },
              right_wing: {
                rotation: {
                  '0.0': [0, 0, 15],
                  '0.7': [0, 0, -20],
                  '1.4': [0, 0, 15],
                },
              },
            },
          },
          [`animation.${mobId}.attack`]: {
            loop: false,
            animation_length: 0.45,
            bones: {
              body: {
                rotation: {
                  '0.0': [0, 0, 0],
                  '0.15': [-20, 0, 0],
                  '0.3': [35, 0, 0],
                  '0.45': [0, 0, 0],
                },
                position: {
                  '0.0': [0, 0, 0],
                  '0.3': [0, 0, 2.5],
                  '0.45': [0, 0, 0],
                },
              },
            },
          },
          [`animation.${mobId}.hurt`]: {
            loop: false,
            animation_length: 0.25,
            bones: {
              body: {
                rotation: {
                  '0.0': [0, 0, 0],
                  '0.1': [-25, 0, -10],
                  '0.25': [0, 0, 0],
                },
              },
            },
          },
          [`animation.${mobId}.death`]: {
            loop: false,
            animation_length: 0.75,
            bones: {
              body: {
                rotation: {
                  '0.0': [0, 0, 0],
                  '0.3': [45, 0, 90],
                  '0.75': [0, 0, 180],
                },
                position: {
                  '0.0': [0, 0, 0],
                  '0.75': [0, -1.2, 0],
                },
              },
            },
          },
        },
      },
      null,
      2,
    );
  }

  // The gait suite is chosen from the classified skeleton only — no name keyword
  // lists, so a limb layout that is really a quadruped can never get a biped cycle.
  const isQuadruped = rig === 'quadruped';

  if (isQuadruped) {
    return JSON.stringify(
      {
        format_version: '1.8.0',
        animations: {
          [`animation.${mobId}.walk`]: {
            loop: true,
            animation_length: 0.8,
            bones: {
              leg0: {
                rotation: { '0.0': [30, 0, 0], '0.4': [-30, 0, 0], '0.8': [30, 0, 0] },
              },
              leg1: {
                rotation: { '0.0': [-30, 0, 0], '0.4': [30, 0, 0], '0.8': [-30, 0, 0] },
              },
              leg2: {
                rotation: { '0.0': [-30, 0, 0], '0.4': [30, 0, 0], '0.8': [-30, 0, 0] },
              },
              leg3: {
                rotation: { '0.0': [30, 0, 0], '0.4': [-30, 0, 0], '0.8': [30, 0, 0] },
              },
              tail: {
                rotation: { '0.0': [0, 15, 0], '0.4': [0, -15, 0], '0.8': [0, 15, 0] },
              },
            },
          },
          [`animation.${mobId}.idle`]: {
            loop: true,
            animation_length: 2.0,
            bones: {
              head: {
                rotation: { '0.0': [0, -5, 0], '1.0': [0, 5, 0], '2.0': [0, -5, 0] },
              },
              tail: {
                rotation: { '0.0': [0, 10, 0], '1.0': [0, -10, 0], '2.0': [0, 10, 0] },
              },
            },
          },
          ...(isFlying
            ? {
                [`animation.${mobId}.fly`]: {
                  loop: true,
                  animation_length: 0.8,
                  bones: {
                    body: { position: { '0.0': [0, 0, 0], '0.4': [0, 0.6, 0], '0.8': [0, 0, 0] } },
                  },
                },
              }
            : {}),
          [`animation.${mobId}.attack`]: {
            loop: false,
            animation_length: 0.45,
            bones: {
              head: {
                rotation: { '0.0': [0, 0, 0], '0.2': [-25, 0, 0], '0.45': [0, 0, 0] },
              },
              body: {
                position: { '0.0': [0, 0, 0], '0.2': [0, 0.4, 1.2], '0.45': [0, 0, 0] },
              },
            },
          },
          [`animation.${mobId}.hurt`]: {
            loop: false,
            animation_length: 0.25,
            bones: {
              body: { rotation: { '0.0': [0, 0, 0], '0.1': [-15, 0, -8], '0.25': [0, 0, 0] } },
            },
          },
          [`animation.${mobId}.death`]: {
            loop: false,
            animation_length: 0.75,
            bones: {
              root: {
                rotation: { '0.0': [0, 0, 0], '0.75': [0, 0, -90] },
                position: { '0.0': [0, 0, 0], '0.75': [0, -0.8, 0] },
              },
            },
          },
        },
      },
      null,
      2,
    );
  }

  // Biped / Generic mob
  return JSON.stringify(
    {
      format_version: '1.8.0',
      animations: {
        [`animation.${mobId}.walk`]: {
          loop: true,
          animation_length: 1.0,
          bones: {
            left_leg: {
              rotation: {
                '0.0': [35, 0, 0],
                '0.5': [-35, 0, 0],
                '1.0': [35, 0, 0],
              },
            },
            right_leg: {
              rotation: {
                '0.0': [-35, 0, 0],
                '0.5': [35, 0, 0],
                '1.0': [-35, 0, 0],
              },
            },
            left_arm: {
              rotation: {
                '0.0': [-30, 0, 0],
                '0.5': [30, 0, 0],
                '1.0': [-30, 0, 0],
              },
            },
            right_arm: {
              rotation: {
                '0.0': [30, 0, 0],
                '0.5': [-30, 0, 0],
                '1.0': [30, 0, 0],
              },
            },
            body: {
              rotation: {
                '0.0': [0, 3, 0],
                '0.5': [0, -3, 0],
                '1.0': [0, 3, 0],
              },
            },
          },
        },
        ...(isFlying
          ? {
              [`animation.${mobId}.fly`]: {
                loop: true,
                animation_length: 0.8,
                bones: {
                  body: {
                    position: {
                      '0.0': [0, 0, 0],
                      '0.4': [0, 0.8, 0],
                      '0.8': [0, 0, 0],
                    },
                  },
                },
              },
            }
          : {}),
        [`animation.${mobId}.idle`]: {
          loop: true,
          animation_length: 2.0,
          bones: {
            head: {
              rotation: {
                '0.0': [0, -5, 0],
                '1.0': [0, 5, 0],
                '2.0': [0, -5, 0],
              },
            },
            body: {
              position: {
                '0.0': [0, 0, 0],
                '1.0': [0, 0.35, 0],
                '2.0': [0, 0, 0],
              },
              rotation: {
                '0.0': [0, 2, 0],
                '1.0': [0, -2, 0],
                '2.0': [0, 2, 0],
              },
            },
            left_arm: {
              rotation: {
                '0.0': [0, 0, -6],
                '1.0': [0, 0, -9],
                '2.0': [0, 0, -6],
              },
            },
            right_arm: {
              rotation: {
                '0.0': [0, 0, 6],
                '1.0': [0, 0, 9],
                '2.0': [0, 0, 6],
              },
            },
          },
        },
        [`animation.${mobId}.attack`]: {
          loop: false,
          animation_length: 0.5,
          bones: {
            right_arm: {
              rotation: {
                '0.0': [0, 0, 0],
                '0.2': [-75, 25, 0],
                '0.35': [35, -20, 0],
                '0.5': [0, 0, 0],
              },
            },
            head: {
              rotation: {
                '0.0': [0, 0, 0],
                '0.2': [-15, 0, 0],
                '0.35': [20, 0, 0],
                '0.5': [0, 0, 0],
              },
            },
          },
        },
        [`animation.${mobId}.hurt`]: {
          loop: false,
          animation_length: 0.3,
          bones: {
            body: {
              rotation: {
                '0.0': [0, 0, 0],
                '0.1': [-18, 0, -6],
                '0.3': [0, 0, 0],
              },
            },
          },
        },
        [`animation.${mobId}.death`]: {
          loop: false,
          animation_length: 0.8,
          bones: {
            root: {
              rotation: {
                '0.0': [0, 0, 0],
                '0.4': [0, 0, -50],
                '0.8': [0, 0, -90],
              },
              position: {
                '0.0': [0, 0, 0],
                '0.8': [0, -0.6, 0],
              },
            },
          },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Transition-State Blend Helper
 * Automatically generates intermediate 'blend' states between idle, walk and attack
 * so locomotion changes never pop. Each blend state plays both adjoining animations
 * (Bedrock overlays them) for a fixed short window before handing off.
 */
export function generateBlendStates(
  moveAnim: string,
  idleAnim: string,
  attackAnim: string,
): {
  states: Record<string, unknown>;
  // Rewritten transition tables for the core states, now routed through blend states
  coreTransitions: {
    default: Array<Record<string, string>>;
    move: Array<Record<string, string>>;
    attack: Array<Record<string, string>>;
    hurt: Array<Record<string, string>>;
  };
} {
  // Bedrock's engine drives melee wind-up through this query, fed by
  // minecraft:behavior.delayed_attack, or target proximity with melee attack.
  const attacking = 'query.is_delayed_attacking || (query.has_target && query.target_distance < 2.5 && !query.is_moving)';
  // query.hurt_time counts UP from the last hit and never falls back to zero, so a
  // bare "> 0" test latched every mob inside its hurt state after the first hit and
  // the mob stopped attacking or moving. A bounded window reproduces the Java flinch
  // once per hit, then hands control back to the locomotion state.
  const hurtTrigger = 'query.hurt_time > 0 && query.hurt_time < 0.35';
  // query.anim_time is the Bedrock query for time spent in the current controller
  // state. The old query.all_animations_finished test could never fire because the
  // blended clips are loop:true, which froze the mob mid-cross-fade. The hurt exit is
  // deliberately longer than the trigger window so the state cannot re-enter itself
  // and flicker the flinch pose before the clip has settled.
  const hurtExit = 'query.anim_time > 0.45';

  // Blend states overlay two clips for a FIXED timed window. They must never wait
  // on query.all_animations_finished: idle/walk are loop:true and never finish, so
  // the machine latched inside the blend state and the mob froze mid-pose.
  const states: Record<string, unknown> = {
    // idle -> move blend: cross-fade the walk cycle in over a fixed ~0.15s window
    blend_idle_move: {
      animations: [idleAnim, moveAnim],
      transitions: [
        { move: 'query.anim_time > 0.15 && (query.modified_move_speed > 0.1 || query.is_moving)' },
        { default: 'query.anim_time > 0.15 && query.modified_move_speed <= 0.1 && !query.is_moving' },
        { attack: attacking },
        { hurt: hurtTrigger },
      ],
    },
    // move -> idle blend: cross-fade the idle cycle in over a fixed ~0.15s window
    blend_move_idle: {
      animations: [moveAnim, idleAnim],
      transitions: [
        { move: 'query.anim_time > 0.15 && (query.modified_move_speed > 0.1 || query.is_moving)' },
        { default: 'query.anim_time > 0.15 && query.modified_move_speed <= 0.1 && !query.is_moving' },
        { attack: attacking },
        { hurt: hurtTrigger },
      ],
    },
    // attack -> locomotion blend: ease the return pose back over a fixed ~0.2s window
    blend_attack_out: {
      animations: [attackAnim, idleAnim],
      transitions: [
        { move: 'query.anim_time > 0.2 && (query.modified_move_speed > 0.1 || query.is_moving)' },
        { default: 'query.anim_time > 0.2' },
        { attack: attacking },
      ],
    },
  };

  const coreTransitions = {
    default: [
      { blend_idle_move: 'query.modified_move_speed > 0.1 || query.is_moving' },
      { attack: attacking },
      { hurt: hurtTrigger },
    ],
    move: [
      { blend_move_idle: 'query.modified_move_speed <= 0.1 && !query.is_moving' },
      { attack: attacking },
      { hurt: hurtTrigger },
    ],
    attack: [{ blend_attack_out: 'query.anim_time > 0.5' }],
    hurt: [
      { move: `${hurtExit} && (query.modified_move_speed > 0.1 || query.is_moving)` },
      { default: hurtExit },
    ],
  };

  return { states, coreTransitions };
}

export function generateMobAnimationControllers(
  mobId: string,
  isFlying: boolean,
  sourceAliases: MobAnimationAliases = {},
  shippedClipIds?: string[],
): string {
  const has = (id: string | undefined): boolean =>
    Boolean(id) && (!shippedClipIds || shippedClipIds.includes(id as string));
  const moveKind = isFlying ? 'fly' : 'walk';
  const clips = {
    idle: sourceAliases.idle ?? `animation.${mobId}.idle`,
    move: sourceAliases[moveKind] ?? `animation.${mobId}.${moveKind}`,
    attack: sourceAliases.attack ?? `animation.${mobId}.attack`,
    hurt: sourceAliases.hurt ?? `animation.${mobId}.hurt`,
    death: sourceAliases.death ?? `animation.${mobId}.death`,
  };
  const available = {
    idle: has(clips.idle),
    move: has(clips.move),
    attack: has(clips.attack),
    hurt: has(clips.hurt),
    death: has(clips.death),
  };
  // Withheld INVENTED clips leave nothing to drive: the caller skips the file entirely.
  if (!available.idle && !available.move) return '';

  const deathTransition = available.death ? [{ death: 'query.health <= 0' }] : [];
  const states: Record<string, { animations: string[]; transitions?: Array<Record<string, string>> }> = {
    default: {
      animations: [available.idle ? clips.idle : clips.move],
      transitions: [
        ...deathTransition,
        ...(available.move ? [{ move: 'query.modified_move_speed > 0.1 || query.is_moving' }] : []),
        ...(available.attack
          ? [{ attack: 'query.is_delayed_attacking || (query.has_target && query.target_distance < 2.5 && !query.is_moving)' }]
          : []),
        ...(available.hurt ? [{ hurt: 'query.hurt_time > 0 && query.hurt_time < 0.35' }] : []),
      ],
    },
  };
  if (available.move) {
    states.move = {
      animations: [clips.move],
      transitions: [
        ...deathTransition,
        { default: 'query.modified_move_speed <= 0.1 && !query.is_moving' },
        ...(available.attack
          ? [{ attack: 'query.is_delayed_attacking || (query.has_target && query.target_distance < 2.5 && !query.is_moving)' }]
          : []),
        ...(available.hurt ? [{ hurt: 'query.hurt_time > 0 && query.hurt_time < 0.35' }] : []),
      ],
    };
  }
  if (available.attack) {
    states.attack = {
      animations: [clips.attack],
      transitions: [...deathTransition, { default: 'query.anim_time > 0.5' }],
    };
  }
  if (available.hurt) {
    states.hurt = {
      animations: [clips.hurt],
      transitions: [
        ...deathTransition,
        { default: 'query.anim_time > 0.45' },
      ],
    };
  }
  if (available.death) states.death = { animations: [clips.death] };

  // Cross-fade windows only exist when all three adjoining clips really ship. A blend state that
  // no other state transitions INTO is dead content: the engine can never enter it, the schema
  // gate reports it as unreachable and the whole archive is held back. The core locomotion states
  // are therefore re-routed through the blend states in the same step that creates them.
  if (available.idle && available.move && available.attack) {
    const { states: blendStates, coreTransitions } = generateBlendStates(clips.move, clips.idle, clips.attack);
    for (const [key, definition] of Object.entries(blendStates)) {
      const state = definition as { animations?: string[]; transitions?: Array<Record<string, string>> };
      states[key] = {
        animations: [...(state.animations ?? [])],
        transitions: [...deathTransition, ...(state.transitions ?? [])],
      };
    }
    // Death keeps priority over every blend hand-off, so a lethal hit is never queued behind a
    // cross-fade window.
    const routeThroughBlend = (key: 'default' | 'move' | 'attack') => {
      const core = states[key];
      if (!core) return;
      core.transitions = [
        ...deathTransition,
        ...coreTransitions[key].map((transition) => ({ ...transition })),
      ];
    };
    routeThroughBlend('default');
    routeThroughBlend('move');
    routeThroughBlend('attack');
  }

  // Any transition pointing at a state that was not created is removed, and clips that
  // did not ship are stripped, so a controller can never reference missing keyframes.
  const stateKeys = new Set(Object.keys(states));
  for (const [key, state] of Object.entries(states)) {
    state.animations = state.animations.filter((id) => has(id));
    if (state.animations.length === 0) {
      delete states[key];
      continue;
    }
    if (state.transitions) {
      state.transitions = state.transitions.filter((transition) =>
        Object.keys(transition).every((target) => stateKeys.has(target) && states[target]),
      );
    }
  }
  if (!states.default) return '';

  const controllers = {
    format_version: '1.10.0',
    animation_controllers: {
      [`controller.animation.${mobId}.general`]: {
        initial_state: 'default',
        states,
      },
    },
  };

  return JSON.stringify(controllers, null, 2);
}

export function generateMobClientEntity(
  modId: string,
  mobId: string,
  isFlying: boolean,
  _hasLighting = false,
  customGeoId?: string,
  synthesizedControllerIds: string[] = [],
  importedAnimationIds: string[] = [],
  shippedClipIds?: string[],
  includeGeneralController = true,
): string {
  const animMap: Record<string, string> = {
    idle: `animation.${mobId}.idle`,
    walk: `animation.${mobId}.walk`,
    attack: `animation.${mobId}.attack`,
    hurt: `animation.${mobId}.hurt`,
    death: `animation.${mobId}.death`,
    ctrl: `controller.animation.${mobId}.general`,
    [`animation.${mobId}.idle`]: `animation.${mobId}.idle`,
    [`animation.${mobId}.walk`]: `animation.${mobId}.walk`,
    [`animation.${mobId}.attack`]: `animation.${mobId}.attack`,
    [`animation.${mobId}.hurt`]: `animation.${mobId}.hurt`,
    [`animation.${mobId}.death`]: `animation.${mobId}.death`,
    [`controller.animation.${mobId}.general`]: `controller.animation.${mobId}.general`,
  };
  if (isFlying) {
    animMap.fly = `animation.${mobId}.fly`;
    animMap[`animation.${mobId}.fly`] = `animation.${mobId}.fly`;
  }

  for (const animationId of importedAnimationIds) {
    if (animationId) animMap[animationId] = animationId;
  }

  // Controllers synthesized from detected bytecode state machines are bound to this
  // entity so the generated JSON is actually driven, not just shipped in the pack.
  const boundControllers = synthesizedControllerIds.filter(Boolean);
  for (const controllerId of boundControllers) {
    animMap[controllerId] = controllerId;
  }

  // Clips that were withheld (INVENTED content with playable mode off) are removed from
  // the map so the entity never references keyframes that are not in the pack.
  if (shippedClipIds) {
    const allowed = new Set(shippedClipIds);
    for (const key of Object.keys(animMap)) {
      const value = animMap[key];
      if (value.startsWith('controller.')) continue;
      if (!allowed.has(value)) delete animMap[key];
    }
  }
  if (!includeGeneralController) {
    delete animMap.ctrl;
    delete animMap[`controller.animation.${mobId}.general`];
  }

  // Singular state machine controller script to prevent conflicting controllers
  // fighting for identical limb transforms and freezing into corrupted T-poses:
  const animScripts: unknown[] = boundControllers.length > 0
    ? boundControllers
    : includeGeneralController ? ['ctrl'] : [];

  const clientEntity = {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: `${modId}:${mobId}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: `textures/entity/${mobId}` },
        geometry: {
          default: customGeoId || `geometry.${mobId}`,
        },
        animations: animMap,
        scripts: {
          animate: animScripts,
        },
        sound_effects: {
          ambient: `${modId}.mob_ambient`,
          hurt: `${modId}.mob_hurt`,
          death: `${modId}.mob_death`,
          attack: `${modId}.weapon_swing`,
        },
        render_controllers: ['controller.render.default'],
      },
    },
  };

  return JSON.stringify(clientEntity, null, 2);
}

/**
 * Generates Molang animations keyed to the ACTUAL bone names of a recovered
 * GeckoLib / Java entity model. Authentic models keep their own skeleton
 * (`Body`, `Head01`, `LeftArm` ...) so the biped template names never match.
 * Roles are classified by bone name and each role gets its own track.
 */
export function generateMobAnimationsFromBones(
  mobId: string,
  boneNames: string[],
  isFlying: boolean,
  isSlime: boolean,
  rig: MobRigKind = isFlying ? 'flying' : isSlime ? 'amorphous' : 'biped',
): string {
  const usable = boneNames.filter((name) => Boolean(name) && !/armor|held|item|slot|hitbox/i.test(name));
  const pick = (re: RegExp, max: number) => usable.filter((name) => re.test(name.toLowerCase())).slice(0, max);

  const heads = pick(/head|skull|jaw|neck|muzzle|bipedhead|face/, 2);
  const bodies = pick(/body|torso|chest|spine|waist|hip|abdom|pelvis|bipedbody/, 2);
  const arms = pick(/arm|hand|claw|shoulder|forearm|bipedleftarm|bipedrightarm/, 6);
  const legs = pick(/leg|foot|thigh|knee|shin|hoof|bipedleftleg|bipedrightleg/, 8);
  const wings = pick(/wing|rotor|blade|prop|fan/, 4);
  const tails = pick(/tail|stinger|spike/, 3);
  const roots = pick(/^(root|all|bone|main|armature)$/, 1);

  if (usable.length === 0 || heads.length + bodies.length + arms.length + legs.length + wings.length === 0) {
    return generateMobAnimations(mobId, isFlying, isSlime, rig);
  }

  const generic = heads[0] ?? bodies[0] ?? roots[0] ?? usable[0];
  const track = (bone: string, channel: string, value: unknown, target: Record<string, unknown>) => {
    const boneEntry = (target[bone] ?? {}) as Record<string, unknown>;
    boneEntry[channel] = value;
    target[bone] = boneEntry;
  };

  const idle: Record<string, unknown> = {};
  const walk: Record<string, unknown> = {};
  const fly: Record<string, unknown> = {};
  const attack: Record<string, unknown> = {};
  const hurt: Record<string, unknown> = {};
  const death: Record<string, unknown> = {};

  heads.forEach((bone) => {
    track(bone, 'rotation', { '0.0': [0, -6, 0], '1.0': [0, 6, 0], '2.0': [0, -6, 0] }, idle);
    track(bone, 'rotation', { '0.0': [0, 0, 0], '0.2': [-24, 0, 0], '0.45': [0, 0, 0] }, attack);
  });
  bodies.forEach((bone) => {
    track(bone, 'position', { '0.0': [0, 0, 0], '1.0': [0, 0.35, 0], '2.0': [0, 0, 0] }, idle);
    track(bone, 'rotation', { '0.0': [0, 2, 0], '1.0': [0, -2, 0], '2.0': [0, 2, 0] }, idle);
  });
  tails.forEach((bone) => track(bone, 'rotation', { '0.0': [0, 14, 0], '1.0': [0, -14, 0], '2.0': [0, 14, 0] }, idle));

  legs.forEach((bone, index) => {
    const swing = index % 2 === 0 ? 1 : -1;
    track(bone, 'rotation', { '0.0': [32 * swing, 0, 0], '0.5': [-32 * swing, 0, 0], '1.0': [32 * swing, 0, 0] }, walk);
    track(bone, 'rotation', { '0.0': [0, 0, 0], '1.0': [0, 0, 0], '2.0': [0, 0, 0] }, idle);
  });
  arms.forEach((bone, index) => {
    // Quadrupeds have no swinging arms: driving front-leg bones through an arm cycle
    // folded the chest into the body and the mob looked broken while walking.
    if (rig === 'quadruped') return;
    const isLeft = /left|l_|larm|arm_l/i.test(bone) || index % 2 === 0;
    // De-T-pose: Natural limb rest posture (never force 68 degree T-pose rotation!)
    // Subtle natural outward offset to clear the torso and natural forward/backward locomotion swing
    const restZ = isLeft ? -4 : 4;
    track(bone, 'rotation', {
      '0.0': [0, 0, restZ],
      '1.0': [2, 0, restZ + (isLeft ? -2 : 2)],
      '2.0': [0, 0, restZ],
    }, idle);

    const swing = isLeft ? 1 : -1;
    track(bone, 'rotation', {
      '0.0': [-26 * swing, 0, restZ],
      '0.5': [26 * swing, 0, restZ],
      '1.0': [-26 * swing, 0, restZ],
    }, walk);
  });
  if (arms.length > 0) {
    track(arms[0], 'rotation', { '0.0': [0, 0, 0], '0.2': [-80, 15, 0], '0.35': [35, -10, 0], '0.5': [0, 0, 0] }, attack);
  }
  tails.forEach((bone) =>
    track(bone, 'rotation', { '0.0': [0, 14, 0], '0.5': [0, -14, 0], '1.0': [0, 14, 0] }, walk),
  );

  wings.forEach((bone, index) => {
    const flap = index % 2 === 0 ? -1 : 1;
    track(bone, 'rotation', { '0.0': [0, 0, 42 * flap], '0.12': [0, 0, -45 * flap], '0.24': [0, 0, 42 * flap] }, fly);
    track(bone, 'rotation', { '0.0': [0, 0, 18 * flap], '0.2': [0, 0, -18 * flap], '0.4': [0, 0, 18 * flap] }, walk);
  });
  if (wings.length > 0) {
    wings.forEach((bone) => track(bone, 'rotation', { '0.0': [0, 0, 0], '0.4': [0, 0, 0] }, idle));
  }

  (bodies.length > 0 ? bodies : [generic]).forEach((bone) => {
    track(bone, 'rotation', { '0.0': [0, 0, 0], '0.1': [-16, 0, -6], '0.3': [0, 0, 0] }, hurt);
  });
  (roots.length > 0 ? roots : [generic]).forEach((bone) => {
    track(bone, 'rotation', { '0.0': [0, 0, 0], '0.4': [0, 0, -45], '0.8': [0, 0, -90] }, death);
    track(bone, 'position', { '0.0': [0, 0, 0], '0.8': [0, -0.6, 0] }, death);
  });

  // Animate all secondary/accessory bones (masks, lanterns, cloth, horns, weapons) so nothing freezes
  const assignedBones = new Set([...heads, ...bodies, ...arms, ...legs, ...wings, ...tails, ...roots]);
  usable.forEach((bone) => {
    if (!assignedBones.has(bone)) {
      track(bone, 'rotation', { '0.0': [0, 0, 0], '1.0': [2, 0, 1.5], '2.0': [0, 0, 0] }, idle);
      track(bone, 'rotation', { '0.0': [0, 0, 0], '0.5': [-3, 0, 2], '1.0': [0, 0, 0] }, walk);
    }
  });

  const ensure = (tracks: Record<string, unknown>, channel: string, value: unknown) => {
    if (Object.keys(tracks).length > 0) return tracks;
    const filled: Record<string, unknown> = {};
    track(generic, channel, value, filled);
    return filled;
  };

  const animations: Record<string, unknown> = {
    [`animation.${mobId}.idle`]: { loop: true, animation_length: 2.0, bones: ensure(idle, 'rotation', { '0.0': [0, 0, 0], '1.0': [0, 3, 0], '2.0': [0, 0, 0] }) },
    [`animation.${mobId}.walk`]: { loop: true, animation_length: 1.0, bones: ensure(walk, 'position', { '0.0': [0, 0, 0], '0.5': [0, 0.4, 0], '1.0': [0, 0, 0] }) },
    ...(isFlying
      ? { [`animation.${mobId}.fly`]: { loop: true, animation_length: 0.8, bones: ensure(fly, 'position', { '0.0': [0, 0, 0], '0.4': [0, 0.7, 0], '0.8': [0, 0, 0] }) } }
      : {}),
    [`animation.${mobId}.attack`]: { loop: false, animation_length: 0.5, bones: ensure(attack, 'rotation', { '0.0': [0, 0, 0], '0.25': [26, 0, 0], '0.5': [0, 0, 0] }) },
    [`animation.${mobId}.hurt`]: { loop: false, animation_length: 0.3, bones: ensure(hurt, 'rotation', { '0.0': [0, 0, 0], '0.15': [-14, 0, 0], '0.3': [0, 0, 0] }) },
    [`animation.${mobId}.death`]: { loop: false, animation_length: 0.8, bones: ensure(death, 'position', { '0.0': [0, 0, 0], '0.8': [0, -0.6, 0] }) },
  };

  return JSON.stringify({ format_version: '1.8.0', animations }, null, 2);
}
