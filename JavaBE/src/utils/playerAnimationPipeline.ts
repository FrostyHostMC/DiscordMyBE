import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { PlayerClipTrigger } from '@/utils/playerAnimationTriggers';
import type { PlayerModEvidence } from '@/utils/playerModEvidence';
import type { PlayerOwnerDecision } from '@/utils/playerRigClassifier';
import { injectPlayerRigBones, type GeometryCandidate } from '@/utils/playerBoneInjector';
import { planOffhandPlayback } from '@/utils/playerOffhandResolver';
import { planViewModels } from '@/utils/playerViewModelMapper';

/**
 * Automated player animation port.
 *
 * Composes the player-specific stages that a Java player animation mod needs and that the
 * generic animation importer cannot know about:
 *
 *  1. rig discrimination is reported per clip owner (class evidence vs rig-shape evidence);
 *  2. every clip's real scope (arms / body / legs) is decided from the bones it animates, so the
 *     first-person hand tracks and the third-person body tracks are known instead of guessed;
 *  3. custom source bones that cannot be matched to the vanilla player skeleton are reported
 *     and withheld; an unverified source model never replaces the player's skin geometry;
 *  4. off-hand / dual-wield clips are wired to a behaviour-pack script only when source evidence
 *     identifies the off-hand slot, which Molang cannot query.
 *
 * Nothing here invents gameplay: every emitted file is derived from the source clips or from a
 * model the archive really ships.
 */

export interface PlayerAnimationPortReport {
  owners: PlayerOwnerDecision[];
  clipsInspected: number;
  armClips: string[];
  bodyClips: string[];
  legOnlyClips: string[];
  firstPersonTaggedClips: string[];
  perspectiveConflicts: string[];
  firstPersonEvidence: string[];
  dualWieldDetected: boolean;
  offhandEvidence: string[];
  offhandClips: string[];
  mainhandClips: string[];
  injectedBones: string[];
  injectedGeometryIdentifier: string | null;
  gatedClips: number;
  scriptActions: number;
  notes: string[];
  summary: string;
}

export interface PlayerAnimationPortResult {
  files: Record<string, string>;
  scriptCode: string;
  geometryIdentifier: string | null;
  report: PlayerAnimationPortReport;
}

function collectBones(clips: Record<string, BedrockAnimationClip>): string[] {
  const names = new Set<string>();
  for (const clip of Object.values(clips)) {
    const bones = (clip as { bones?: Record<string, unknown> }).bones;
    if (!bones) continue;
    for (const bone of Object.keys(bones)) names.add(bone);
  }
  return [...names];
}

export function buildPlayerAnimationPort(options: {
  modId: string;
  clips: Record<string, BedrockAnimationClip>;
  triggers: PlayerClipTrigger[];
  decisions: PlayerOwnerDecision[];
  evidence: PlayerModEvidence;
  geometryCandidates: GeometryCandidate[];
  onLog?: (line: string) => void;
}): PlayerAnimationPortResult {
  const log = (line: string) => options.onLog?.(line);
  const viewModels = planViewModels(options.clips, options.evidence);
  const injection = injectPlayerRigBones({
    candidates: options.geometryCandidates,
    clipBones: collectBones(options.clips),
    modId: options.modId,
  });
  const offhand = planOffhandPlayback({ clips: options.clips, evidence: options.evidence });
  const gatedClips = options.triggers.filter((trigger) => Boolean(trigger.condition) || trigger.scriptDriven).length;

  for (const note of viewModels.notes) log(`[PLAYER-VIEW] ${note}`);
  if (viewModels.perspectiveConflicts.length > 0) {
    log(`[PLAYER-VIEW] Perspective check: ${viewModels.perspectiveConflicts.slice(0, 4).join(' | ')}.`);
  }
  log(`[PLAYER-BONES] ${injection.note}`);
  if (injection.injectedBones.length > 0) {
    log(
      `[PLAYER-BONES] Injected: ${injection.injectedBones.slice(0, 8).join(', ')}${injection.injectedBones.length > 8 ? ' …' : ''}${injection.approximatedBones.length > 0 ? `; ${injection.approximatedBones.length} parent(s) approximated from part tokens` : ''}.`,
    );
  }
  for (const note of offhand.notes) log(`[PLAYER-OFFHAND] ${note}`);

  const scriptActions = offhand.script ? 2 : 0;
  const notes = [...viewModels.notes, injection.note, ...offhand.notes];
  const summary = [
    `${Object.keys(options.clips).length} player clip(s) inspected; ${viewModels.armClips.length} first-person arm track(s), ${viewModels.bodyClips.length} third-person body track(s)`,
    `${gatedClips} clip(s) carry a translated trigger`,
    injection.injectedBones.length > 0
      ? `${injection.injectedBones.length} custom bone node(s) injected into the mod's own player model`
      : injection.unresolvedBones.length > 0
        ? `${injection.unresolvedBones.length} unsupported custom bone track(s) withheld to protect the native player mesh`
        : 'all detected bone tracks use the native player skeleton',
    offhand.offhandClips.length > 0
      ? `${offhand.offhandClips.length} off-hand clip(s) wired to the behaviour pack`
      : 'no off-hand clip found',
  ].join('; ');

  return {
    files: injection.files,
    scriptCode: offhand.script,
    geometryIdentifier: injection.geometryIdentifier,
    report: {
      owners: options.decisions,
      clipsInspected: Object.keys(options.clips).length,
      armClips: viewModels.armClips,
      bodyClips: viewModels.bodyClips,
      legOnlyClips: viewModels.legOnlyClips,
      firstPersonTaggedClips: viewModels.firstPersonTaggedClips,
      perspectiveConflicts: viewModels.perspectiveConflicts,
      firstPersonEvidence: viewModels.firstPersonEvidence,
      dualWieldDetected: offhand.dualWieldDetected,
      offhandEvidence: offhand.evidence,
      offhandClips: offhand.offhandClips,
      mainhandClips: offhand.mainhandClips,
      injectedBones: injection.injectedBones,
      injectedGeometryIdentifier: injection.geometryIdentifier,
      gatedClips,
      scriptActions,
      notes,
      summary,
    },
  };
}