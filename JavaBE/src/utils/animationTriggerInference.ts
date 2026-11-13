import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { identityTokens } from '@/utils/geckolibImporter';

/**
 * Structural trigger recovery.
 *
 * A source clip is a real animation even when the archive never exposes the Java call site
 * that fires it. The clip itself still carries evidence: which bones it moves, whether it
 * loops, how long it lasts, and what the mod named it. That evidence is enough to bind the
 * clip to the engine state it belongs to, so an extracted animation is never left registered
 * but unreachable — the failure mode that produces a pack where "nothing plays and nothing
 * errors".
 *
 * Every result is reported as an approximation, never as a verified source trigger.
 */

export interface InferredAnimationTrigger {
  concept: string;
  /** Bedrock condition valid in the player client-entity context; '' means always active. */
  condition: string;
  evidence: string;
  confidence: 'structural' | 'clip-identity';
}

const UPPER_BODY = /arm|hand|wrist|shoulder|sleeve|head|neck|item|weapon|tool|camera|view/i;
const LOWER_BODY = /leg|foot|thigh|ankle|toe|hip|pelvis|waist|root|torso|body|chest|spine/i;

const IDENTITY_RULES: Array<{ concept: string; tokens: RegExp; condition: string }> = [
  { concept: 'sneaking', tokens: /sneak|crouch/i, condition: 'query.is_sneaking' },
  { concept: 'sprinting', tokens: /sprint/i, condition: 'query.is_sprinting' },
  { concept: 'swimming', tokens: /swim|dive|floating/i, condition: 'query.is_swimming' },
  { concept: 'riding', tokens: /ride|mount|sitting/i, condition: 'query.is_riding' },
  { concept: 'using-item', tokens: /use|cast|drink|eat|charge/i, condition: 'variable.is_using_item' },
  { concept: 'airborne', tokens: /jump|fall|air|leap/i, condition: '!query.is_on_ground' },
  { concept: 'hurt', tokens: /hurt|damage|flinch/i, condition: 'variable.hurt_time > 0 && variable.hurt_time < 0.35' },
  { concept: 'attacking', tokens: /attack|swing|slash|strike|combo|punch|stab|shoot|thrust|kick|claw/i, condition: 'variable.attack_time > 0.05' },
  { concept: 'moving', tokens: /walk|run|move|stride/i, condition: 'query.modified_move_speed > 0.1' },
  { concept: 'idle', tokens: /idle|stand|breath|rest|pose|equip|sheath|draw/i, condition: 'query.modified_move_speed <= 0.1' },
];

/**
 * Derives the engine state a clip belongs to from the clip's own structure and identity.
 * Returns null only when the clip animates nothing at all.
 */
export function inferClipTrigger(
  clipId: string,
  clip: BedrockAnimationClip | undefined,
): InferredAnimationTrigger | null {
  if (!clip) return null;
  const bones = Object.keys(clip.bones ?? {});
  if (bones.length === 0) return null;
  const upper = bones.filter((bone) => UPPER_BODY.test(bone)).length;
  const lower = bones.filter((bone) => LOWER_BODY.test(bone)).length;
  const duration = Number(clip.animation_length) || 0;
  const oneShot = clip.loop === false || clip.loop === 'hold_on_last_frame';
  const tokens = [...identityTokens(clipId), clipId.toLowerCase()];

  const identity = IDENTITY_RULES.find((rule) => tokens.some((token) => rule.tokens.test(token)));
  if (identity) {
    // A one-shot upper-body track is an action, not a locomotion state: the name matched the
    // locomotion concept but the skeleton disagrees, so the structural read wins.
    const contradiction =
      (identity.concept === 'moving' || identity.concept === 'idle') && lower === 0 && upper > 0 && oneShot;
    if (!contradiction) {
      return {
        concept: identity.concept,
        condition: identity.condition,
        evidence: `clip identity names the ${identity.concept} state and its ${bones.length} bone track(s) do not contradict it`,
        confidence: 'clip-identity',
      };
    }
  }

  if (lower > 0 && upper === 0) {
    return {
      concept: 'moving',
      condition: 'query.modified_move_speed > 0.1',
      evidence: `only lower-body bones animate (${bones.slice(0, 3).join(', ')}), which is locomotion`,
      confidence: 'structural',
    };
  }
  if (upper > 0 && lower === 0 && (oneShot || duration <= 1.2)) {
    return {
      concept: 'attacking',
      condition: 'variable.attack_time > 0.05',
      evidence: `upper-body-only track of ${duration}s that does not loop, which is a one-shot action`,
      confidence: 'structural',
    };
  }
  if (lower > 0 && upper > 0 && oneShot) {
    return {
      concept: 'attacking',
      condition: 'variable.attack_time > 0.05',
      evidence: `full-body track of ${duration}s that does not loop, which is a one-shot action`,
      confidence: 'structural',
    };
  }
  if (lower > 0 && upper > 0) {
    return {
      concept: 'moving',
      condition: 'query.modified_move_speed > 0.1',
      evidence: `full-body looping track of ${duration}s, which is a locomotion cycle`,
      confidence: 'structural',
    };
  }
  return {
    concept: 'pose-overlay',
    condition: '',
    evidence: `no engine state could be derived from ${bones.length} bone track(s); the clip is activated continuously so it is never orphaned`,
    confidence: 'structural',
  };
}