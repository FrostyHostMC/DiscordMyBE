import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { PlayerClipTrigger } from '@/utils/playerAnimationTriggers';
import { safeFileId } from '@/utils/bedrockIds';
import { translateMolangExpression } from '@/utils/molangCompatibility';

/**
 * Player animation controller synthesis.
 *
 * Registering a ported clip in `scripts.animate` is not the same as activating it. Two separate
 * things go wrong with the plain `scripts.animate` route on the player:
 *
 *  1. The vanilla `controller.animation.player.root` is preserved in the same list, and every clip
 *     whose condition happens to hold is evaluated *at the same time* as the vanilla locomotion.
 *     Several ported clips sharing a bone (`left_arm` idle + `left_arm` sneak + `left_arm`
 *     walk-transition) average into one pose, which reads in game exactly like "the mod is
 *     installed but the player still animates like vanilla".
 *  2. Order matters and is invisible. A clip listed before the vanilla controller can be answered
 *     over by it, so a correctly generated clip produces no visible motion and no error.
 *
 * This stage converts the ported clips that have a translated trigger into ONE generated animation
 * controller with mutually exclusive states. The controller is declared after the vanilla root
 * controller in `scripts.animate`, so while a ported state is active the ported clip answers last
 * and wins, and when no ported state is true the controller plays nothing and vanilla keeps
 * driving. One state is active at a time, so two ported clips can never fight over the same bone.
 *
 * Everything here is derived from the ported clips and their translated triggers: no state, no
 * condition and no bone name is invented, and a clip whose condition is not expressible in the
 * player client-entity context is reported instead of being placed in a state that would never
 * become true.
 */

export interface PlayerControllerReport {
  controllerId: string | null;
  filePath: string | null;
  states: string[];
  /** Clips activated by a controller state, in evaluation order. */
  controllerDrivenClips: string[];
  /** Clips that stay on the plain `scripts.animate` path (no expressible trigger). */
  clipsLeftInAnimate: string[];
  /** Queries the player context cannot evaluate, with the supported replacement used. */
  conditionRepairs: string[];
  /** Triggers that could not be expressed at all; those clips are left out of the controller. */
  unresolved: string[];
  /** Clips that share one activation condition with another clip, which a state machine cannot split. */
  sharedConditions: string[];
  note: string;
}

export interface PlayerControllerSynthesis {
  files: Record<string, string>;
  controllerIds: string[];
  controllerDrivenClips: string[];
  report: PlayerControllerReport;
}


/**
 * State priority, derived from the concept the trigger was recovered from. A hurt pose must not be
 * shadowed by a walk cycle that also evaluates true, so the more specific source concept wins.
 */
const CONCEPT_PRIORITY: Record<string, number> = {
  hurt: 0,
  attacking: 1,
  'using-item': 2,
  sneaking: 3,
  swimming: 4,
  riding: 5,
  sprinting: 6,
  moving: 7,
  airborne: 8,
  idle: 9,
};

interface PlannedState {
  key: string;
  clipId: string;
  condition: string;
  duration: number | null;
  /** True when the source clip declares itself as a one-shot pose. */
  loopOnce: boolean;
}

export function synthesizePlayerAnimationController(options: {
  modId: string;
  clips: Record<string, BedrockAnimationClip>;
  triggers: PlayerClipTrigger[];
  onLog?: (line: string) => void;
}): PlayerControllerSynthesis {
  const log = (line: string) => options.onLog?.(line);
  // Clips without a recovered condition remain registered on the entity but are not started
  // continuously. There is no plain-animate fallback: that would make unrelated poses overlap.
  const clipsLeftInAnimate: string[] = [];
  const empty = (note: string): PlayerControllerSynthesis => ({
    files: {},
    controllerIds: [],
    controllerDrivenClips: [],
    report: {
      controllerId: null,
      filePath: null,
      states: [],
      controllerDrivenClips: [],
      clipsLeftInAnimate,
      conditionRepairs: [],
      unresolved: [],
      sharedConditions: [],
      note,
    },
  });

  const candidates = options.triggers.filter(
    (trigger) => !trigger.scriptDriven && Boolean(trigger.condition) && Boolean(options.clips[trigger.clipId]),
  );
  if (candidates.length === 0) {
    log(
      '[ANIM:CONTROLLER] No ported player clip carries a safe translated trigger; clips remain registered but inactive until a source state can be reconstructed. No continuous-playback fallback is emitted.',
    );
    return empty(
      'No ported player clip carries a translatable trigger, so no controller was synthesized; clips remain registered but are not auto-played with guessed conditions.',
    );
  }

  // Priority order is deterministic: source concept first, archive order second.
  const ordered = candidates
    .map((trigger, index) => ({ trigger, index }))
    .sort(
      (left, right) =>
        (CONCEPT_PRIORITY[left.trigger.concept] ?? 10) - (CONCEPT_PRIORITY[right.trigger.concept] ?? 10) ||
        left.index - right.index,
    )
    .map((entry) => entry.trigger);

  const conditionRepairs: string[] = [];
  const unresolved: string[] = [];
  const sharedConditions: string[] = [];
  const conditionGroups = new Map<string, PlannedState[]>();
  const planned: PlannedState[] = [];

  for (const trigger of ordered) {
    const gate = trigger.perspective === 'first' ? 'query.is_first_person' : '!query.is_first_person';
    // The state condition runs inside the player client entity, so it is validated in that exact
    // context before it is written: an expression the context cannot evaluate would make the whole
    // controller inert in game with no error line.
    const translation = translateMolangExpression(trigger.condition as string, 'player_entity');
    for (const change of translation.changes) {
      conditionRepairs.push(
        `${trigger.clipId}: ${change.from} → ${change.to} (${change.fidelity}) — ${change.reason}`,
      );
    }
    if (translation.unresolved.length > 0) {
      for (const entry of translation.unresolved) {
        unresolved.push(`${trigger.clipId}: ${entry.query} — ${entry.reason}`);
      }
      continue;
    }
    const condition = `(${translation.expression}) && (${gate})`;
    const clip = options.clips[trigger.clipId];
    const declared = Number(clip?.animation_length ?? 0);
    const state: PlannedState = {
      key: `ported_${planned.length + 1}`,
      clipId: trigger.clipId,
      condition,
      duration: Number.isFinite(declared) && declared > 0 ? declared : null,
      loopOnce: options.clips[trigger.clipId]?.loop === false || options.clips[trigger.clipId]?.loop === 'hold_on_last_frame',
    };
    planned.push(state);
    const group = conditionGroups.get(condition) ?? [];
    if (group.length > 0) {
      sharedConditions.push(`${trigger.clipId} shares a source activation condition with ${group[0].clipId}; the controller retains both clips and rotates through the group instead of dropping either.`);
    }
    group.push(state);
    conditionGroups.set(condition, group);
  }

  if (planned.length === 0) {
    log(
      '[ANIM:CONTROLLER] Every ported trigger uses a query the player client entity cannot evaluate, so no controller state was written. The unresolvable expressions are listed for review instead of shipping a controller that never fires.',
    );
    const result = empty(
      'No ported trigger could be expressed in the player client-entity context, so no controller state was generated; clips remain registered without a fabricated activation condition.',
    );
    result.report.conditionRepairs = conditionRepairs;
    result.report.unresolved = unresolved;
    result.report.sharedConditions = sharedConditions;
    return result;
  }

  const states: Record<string, unknown> = {};
  // The base state plays nothing, which is what keeps vanilla locomotion alive: whenever no ported
  // condition is true the ported controller is silent and the vanilla root controller drives the rig.
  const orderedGroups = [...conditionGroups.values()].sort((left, right) => {
    const leftIndex = planned.indexOf(left[0]);
    const rightIndex = planned.indexOf(right[0]);
    return leftIndex - rightIndex;
  });
  // A base-state transition enters the first clip in each condition group. Groups are ordered
  // by semantic priority, so a hurt/attack state wins over locomotion when both conditions hold.
  states.base = {
    transitions: orderedGroups.map((group) => ({ [group[0].key]: group[0].condition })),
  };
  for (const group of orderedGroups) {
    group.forEach((state, index) => {
      // A higher-priority action must be able to interrupt a lower-priority locomotion state.
      // Bedrock evaluates transition entries in order, so higher-priority conditions come first.
      const transitions: Array<Record<string, string>> = [];
      for (let higherIndex = 0; higherIndex < orderedGroups.indexOf(group); higherIndex += 1) {
        const higher = orderedGroups[higherIndex][0];
        transitions.push({ [higher.key]: higher.condition });
      }
      transitions.push({ base: `!(${state.condition})` });
      const next = group[(index + 1) % group.length];
      if (group.length > 1) {
        // Multiple source clips can legitimately share a coarse Bedrock query (e.g. several
        // attack variants). Keep every clip in the controller and cycle only after the current
        // clip has completed; no clip is silently discarded at an arbitrary state-count limit.
        const completion = state.loopOnce
          ? 'query.any_animation_finished'
          : state.duration !== null
            ? `query.anim_time >= ${state.duration.toFixed(3)}`
            : 'query.any_animation_finished';
        transitions.push({ [next.key]: completion });
      } else if (state.loopOnce && state.duration !== null) {
        transitions.push({ base: 'query.any_animation_finished' });
      }
      states[state.key] = {
        animations: [state.clipId],
        blend_transition: 0.2,
        transitions,
      };
    });
  }

  const namespace = safeFileId(options.modId) || 'aippy';
  const controllerId = `controller.animation.${namespace}.player_ported`;
  const filePath = `animation_controllers/${namespace}.player.animation_controllers.json`;
  const json = JSON.stringify(
    {
      format_version: '1.10.0',
      animation_controllers: {
        [controllerId]: {
          initial_state: 'base',
          states,
        },
      },
    },
    null,
    2,
  );

  const drivenClips = planned.map((state) => state.clipId);
  const note =
    `${controllerId} generated with ${planned.length} state(s) across ${orderedGroups.length} activation group(s), retaining every translated clip and rotating through same-condition variants, ` +
    `declared after the vanilla root controller so an active ported state answers last and wins while vanilla keeps driving otherwise. ` +
    `${drivenClips.length} clip(s) are activated through the controller, ${clipsLeftInAnimate.length} stay on the plain animate path, ` +
    `${conditionRepairs.length} condition(s) were translated for the player context, ${unresolved.length} could not be expressed, ` +
    `${sharedConditions.length} share a condition with another clip. Live playback still requires a Bedrock client test.`;

  log(`[ANIM:CONTROLLER] ${note}`);
  for (const state of planned.slice(0, 8)) {
    log(`[ANIM:CONTROLLER] state "${state.key}" → ${state.clipId} when ${state.condition}.`);
  }
  if (planned.length > 8) {
    log(`[ANIM:CONTROLLER] ${planned.length - 8} further state(s) written the same way.`);
  }
  for (const line of unresolved.slice(0, 4)) log(`[ANIM:CONTROLLER:UNRESOLVED] ${line}.`);

  return {
    files: { [filePath]: json },
    controllerIds: [controllerId],
    controllerDrivenClips: drivenClips,
    report: {
      controllerId,
      filePath,
      states: planned.map((state) => state.key),
      controllerDrivenClips: drivenClips,
      clipsLeftInAnimate,
      conditionRepairs,
      unresolved,
      sharedConditions,
      note,
    },
  };
}