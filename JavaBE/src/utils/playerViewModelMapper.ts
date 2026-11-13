import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { PlayerModEvidence } from '@/utils/playerModEvidence';

/**
 * First-person / third-person clip scope mapper.
 *
 * Bedrock renders the player's arms in the first-person view through the vanilla
 * `controller.render.player.first_person`, so a clip that only animates arm / head / held-item
 * bones is visible in first person, while a clip that animates legs or the torso is a body
 * track. Java first-person mods tag their clips (`first_person_punch`, `view_model_swing`) and
 * often keep body bones in them for camera bob; those tracks distort the third-person body.
 *
 * This module decides each clip's real scope from the bones it animates — never from the file
 * or mod name — and reports the clips whose id claims first person while their tracks move the
 * lower body.
 */

export type ClipScope = 'arms' | 'legs' | 'body' | 'none';

export interface ClipPerspective {
  clipId: string;
  scope: ClipScope;
  firstPersonTagged: boolean;
  bones: string[];
}

export interface ViewModelPlan {
  clipPerspectives: ClipPerspective[];
  armClips: string[];
  bodyClips: string[];
  legOnlyClips: string[];
  firstPersonTaggedClips: string[];
  perspectiveConflicts: string[];
  firstPersonEvidence: string[];
  notes: string[];
}

const ARM_BONE = /arm|hand|sleeve|item|head|hat/i;
const LEG_BONE = /leg|pants|boot|foot|shin|thigh/i;
const FIRST_PERSON_ID = /first[_-]?person|firstperson|\bfp\b|view[_-]?model|item[_-]?in[_-]?hand|hand[_-]?pose|arm[_-]?pose/i;

function scopeOf(bones: string[]): ClipScope {
  if (bones.length === 0) return 'none';
  if (bones.every((bone) => ARM_BONE.test(bone))) return 'arms';
  if (bones.every((bone) => LEG_BONE.test(bone))) return 'legs';
  return 'body';
}

export function planViewModels(
  clips: Record<string, BedrockAnimationClip>,
  evidence: PlayerModEvidence,
): ViewModelPlan {
  const clipPerspectives: ClipPerspective[] = [];
  const armClips: string[] = [];
  const bodyClips: string[] = [];
  const legOnlyClips: string[] = [];
  const firstPersonTaggedClips: string[] = [];
  const perspectiveConflicts: string[] = [];

  for (const [clipId, clip] of Object.entries(clips)) {
    const bones = Object.keys((clip as { bones?: Record<string, unknown> }).bones ?? {});
    const scope = scopeOf(bones);
    const firstPersonTagged = FIRST_PERSON_ID.test(clipId);
    if (firstPersonTagged) firstPersonTaggedClips.push(clipId);
    if (scope === 'arms') armClips.push(clipId);
    else if (scope === 'legs') legOnlyClips.push(clipId);
    else bodyClips.push(clipId);
    if (firstPersonTagged && (scope === 'legs' || scope === 'body')) {
      perspectiveConflicts.push(`${clipId} (${scope} tracks: ${bones.slice(0, 4).join(', ')})`);
    }
    clipPerspectives.push({ clipId, scope, firstPersonTagged, bones });
  }

  const notes: string[] = [];
  if (armClips.length > 0) {
    notes.push(
      `${armClips.length} clip(s) animate arm/head/held-item bones only — Bedrock renders those bones in the first-person hand, so they are the view-model tracks.`,
    );
  }
  if (bodyClips.length > 0) {
    notes.push(`${bodyClips.length} clip(s) move the torso or the full body and are third-person tracks.`);
  }
  if (legOnlyClips.length > 0) {
    notes.push(`${legOnlyClips.length} clip(s) animate leg bones only and can never be seen in first person.`);
  }
  if (perspectiveConflicts.length > 0) {
    notes.push(
      `${perspectiveConflicts.length} clip(s) are named as first-person but move the legs or torso; they are kept as third-person tracks so the first-person hand is not stretched by body motion.`,
    );
  }
  if (evidence.firstPersonEvidence.length > 0) {
    notes.push(
      `First-person evidence in the archive: ${evidence.firstPersonEvidence.slice(0, 3).join(', ')}${evidence.firstPersonEvidence.length > 3 ? ' …' : ''}.`,
    );
  }

  return {
    clipPerspectives,
    armClips,
    bodyClips,
    legOnlyClips,
    firstPersonTaggedClips,
    perspectiveConflicts,
    firstPersonEvidence: evidence.firstPersonEvidence,
    notes,
  };
}