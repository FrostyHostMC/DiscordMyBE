import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { PlayerModEvidence } from '@/utils/playerModEvidence';

/**
 * Evidence-gated off-hand / dual-wield resolver.
 *
 * A left-arm track alone is not proof of dual wielding: it may be an ordinary two-arm pose.
 * Playback is generated only when the archive also proves off-hand handling and a source clip
 * name describes an action. If multiple competing action clips exist, the resolver leaves them
 * for the source-aware animation controller instead of starting every variant at once.
 */
export interface OffhandPlan {
  dualWieldDetected: boolean;
  evidence: string[];
  offhandClips: string[];
  mainhandClips: string[];
  script: string;
  notes: string[];
}

const OFFHAND_BONE = /^left(?:arm|item|sleeve)/i;
const MAINHAND_BONE = /^right(?:arm|item|sleeve)/i;
const HAND_ACTION = /attack|swing|slash|strike|combo|hit|punch|thrust|stab|off.?hand|dual.?wield/i;

function bonesOf(clip: BedrockAnimationClip): string[] {
  return Object.keys((clip as { bones?: Record<string, unknown> }).bones ?? {});
}

export function planOffhandPlayback(options: {
  clips: Record<string, BedrockAnimationClip>;
  evidence: PlayerModEvidence;
}): OffhandPlan {
  const leftActionClips: string[] = [];
  const mainhandClips: string[] = [];
  for (const [clipId, clip] of Object.entries(options.clips)) {
    if (!HAND_ACTION.test(clipId)) continue;
    const bones = bonesOf(clip);
    if (bones.some((bone) => OFFHAND_BONE.test(bone))) leftActionClips.push(clipId);
    if (bones.some((bone) => MAINHAND_BONE.test(bone))) mainhandClips.push(clipId);
  }

  const offhandClips = options.evidence.dualWieldDetected ? leftActionClips : [];
  const notes: string[] = [];
  if (offhandClips.length > 0) {
    notes.push(
      `${offhandClips.length} source action clip(s) animate the left arm / leftItem and the archive proves off-hand handling.`,
    );
  }
  if (mainhandClips.length > 0) {
    notes.push(`${mainhandClips.length} source action clip(s) animate the right arm / rightItem.`);
  }
  if (options.evidence.dualWieldDetected) {
    notes.push(
      `Off-hand handling in the archive: ${options.evidence.offhandEvidence.slice(0, 3).join(', ')}${options.evidence.offhandEvidence.length > 3 ? ' …' : ''}.`,
    );
  }
  if (!options.evidence.dualWieldDetected && leftActionClips.length > 0) {
    notes.push('Left-hand action tracks were found, but no off-hand source evidence was found; no dual-wield script was invented.');
  }
  if (options.evidence.dualWieldDetected && offhandClips.length === 0) {
    notes.push('The mod handles the off hand, but no named source action clip animates a left-hand bone.');
  }

  const ambiguous = offhandClips.length > 1 || mainhandClips.length > 1;
  if (ambiguous) {
    notes.push('Several source action clips compete for one hand event; they remain ungated rather than playing simultaneously.');
  }
  const script = options.evidence.dualWieldDetected && offhandClips.length > 0 && !ambiguous
    ? buildOffhandScript(offhandClips, mainhandClips)
    : '';

  return {
    dualWieldDetected: options.evidence.dualWieldDetected,
    evidence: options.evidence.offhandEvidence,
    offhandClips,
    mainhandClips,
    script,
    notes,
  };
}

/** Behaviour-pack playback reads the player's actual equipment slot and keeps both hands active. */
function buildOffhandScript(offhandClips: string[], mainhandClips: string[]): string {
  return `
// Dual-wield playback is enabled only for clips selected from source evidence.
const PORTED_OFFHAND_CLIPS = ${JSON.stringify(offhandClips)};
const PORTED_MAINHAND_CLIPS = ${JSON.stringify(mainhandClips)};
const PORTED_OFFHAND_SLOT = 'Offhand';

function portedOffhandEquipped(player) {
  try {
    const equipment = player.getComponent('minecraft:equippable');
    return Boolean(equipment && equipment.getEquipment(PORTED_OFFHAND_SLOT));
  } catch (error) {
    // A missing component or slot is a real capability gap, not a silent false.
    console.warn('[AIPPY-ANIM] off-hand slot could not be read (' + (error instanceof Error ? error.message : String(error)) + '); off-hand clips stay inactive for this player.');
    return false;
  }
}

function playPortedHandClip(player, clipId) {
  if (!player || typeof player.playAnimation !== 'function') {
    console.warn('[AIPPY-ANIM] cannot play ' + clipId + ': playAnimation is unavailable on this script API version.');
    return;
  }
  try {
    player.playAnimation(clipId, { blendOutTime: 0.1 });
    console.info('[AIPPY-ANIM] off-hand activation ' + clipId + ' requested on ' + player.typeId);
  } catch (error) {
    console.warn('[AIPPY-ANIM] off-hand activation FAILED for ' + clipId + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

world.afterEvents.entityHitEntity.subscribe((event) => {
  const player = event.damagingEntity;
  if (!player || player.typeId !== 'minecraft:player') return;
  const clips = [...PORTED_MAINHAND_CLIPS];
  if (portedOffhandEquipped(player)) clips.push(...PORTED_OFFHAND_CLIPS);
  for (const clipId of new Set(clips)) playPortedHandClip(player, clipId);
});
`;
}