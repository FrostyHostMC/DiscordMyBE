import type { ExtractedZipEntry } from '@/utils/zip';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import type { JvmClassIR, JvmInstruction } from '@/utils/jvmBytecodeIR';
import { identityTokens } from '@/utils/geckolibImporter';
import { safeFileId } from '@/utils/bedrockIds';

/**
 * Java trigger → Bedrock condition bridge for player animation mods.
 *
 * A Java player-animation mod animates the humanoid rig *and* gates those tracks on Java
 * conditions (`isShiftKeyDown`, `isAttacking`, `isSprinting`, `hurtTime`, …). Copying the
 * keyframes is only half the port: the Bedrock clip does nothing until something evaluates
 * a condition. This module translates each source condition into the Bedrock query that
 * actually exists in the player client-entity context and records the evidence it used.
 *
 * Rules it enforces:
 *  - a condition is emitted only from archive code/data evidence or a versioned built-in
 *    adapter selected by matching mod metadata and Java class evidence; clip names alone are not proof;
 *  - mob-only queries (`query.has_target`, `query.target_distance`, …) are never emitted
 *    for a player, because they do not exist in that context;
 *  - one-shot Java logic (attack / combo / special moves) becomes a script-driven clip,
 *    because Molang cannot express arbitrary Java control flow.
 */

export type PlayerTriggerStatus = 'mapped' | 'approximated' | 'script-driven' | 'unresolved';
export type PlayerRuntimeEvent = 'entityHurt' | 'entityHitEntity' | 'playerSwingStart' | 'itemUse' | 'playerEmote';

export interface PlayerClipTrigger {
  clipId: string;
  /** Exact source-document key before canonical Bedrock identifier normalization. */
  sourceClipId?: string;
  /** Short name registered in the player client entity's `animations` map. */
  shortName: string;
  /** Java-side concept the trigger was recovered from. */
  concept: string;
  /** Molang condition, when the concept is expressible as engine state. */
  condition?: string;
  javaEvidence: string;
  status: PlayerTriggerStatus;
  scriptDriven: boolean;
  perspective: 'first' | 'third';
  /** Overlay clips run in a separate controller so they can blend with locomotion. */
  layer?: 'base' | 'overlay';
  note: string;
  /** Explicit Java animation-layer priority recovered from the same bytecode method as this clip. */
  sourcePriority?: number;
  /** Java runtime API used to fire or stop this clip, when recovered. */
  runtimeTrigger?: string;
  /** Exact Bedrock after-event inferred from the Java call-site method, when unambiguous. */
  runtimeEvent?: PlayerRuntimeEvent;
}

export interface PlayerTriggerReport {
  clipsInspected: number;
  mapped: number;
  approximated: number;
  scriptDriven: number;
  unresolved: number;
  classesScanned: number;
  javaSignals: string[];
  sourceProfile?: string;
  sourceProfileCandidate?: string;
  triggers: PlayerClipTrigger[];
  summary: string;
}

interface ConceptRule {
  concept: string;
  /** Java API / bytecode token that proves the mod evaluates this state. */
  java: RegExp;
  /** Clip-id correlation tokens (never the sole basis of a decision). */
  clip: RegExp;
  /** Bedrock condition valid in the player client-entity / controller context. */
  molang?: string;
  /** True when the state must be fired from the behaviour pack instead of Molang. */
  script?: boolean;
}

/** Java concept ↔ Bedrock query table. Concepts are engine-level, never mod-specific. */
const CONCEPTS: ConceptRule[] = [
  { concept: 'attacking', java: /isAttacking|attackAnim|swingArm|isDelayedAttacking|playerAttack|AttackStrength/, clip: /attack|swing|slash|strike|combo|hit/i, molang: 'variable.attack_time > 0.05' },
  { concept: 'sneaking', java: /isShiftKeyDown|isCrouching|isSneaking|setShiftKeyDown/, clip: /sneak|crouch/i, molang: 'query.is_sneaking' },
  { concept: 'sprinting', java: /isSprinting|setSprinting/, clip: /sprint|sprint/i, molang: 'query.is_sprinting' },
  { concept: 'swimming', java: /isSwimming|setSwimming|isInWater/, clip: /swim|dive/i, molang: 'query.is_swimming' },
  { concept: 'riding', java: /isPassenger|getVehicle|startRiding/, clip: /ride|mount|sit/i, molang: 'query.is_riding' },
  { concept: 'using-item', java: /isUsingItem|startUsingItem|useItem|getUseItem/, clip: /use|cast|drink|eat/i, molang: 'query.is_using_item' },
  { concept: 'moving', java: /walkAnimation|walkDist|limbSwing|isMoving/, clip: /walk|run|move/i, molang: 'query.modified_move_speed > 0.1' },
  { concept: 'airborne', java: /isOnGround|onGround|isJumping|jumpFromGround/, clip: /jump|fall|air/i, molang: '!query.is_on_ground' },
  { concept: 'hurt', java: /hurtTime|isHurt|hurtDuration|damageEntity/, clip: /hurt|damage|flinch/i, molang: 'query.hurt_time > 0 && query.hurt_time < 0.35' },
  { concept: 'idle', java: /tickCount|getIdle|isIdle/, clip: /idle|stand|breath|rest/i, molang: 'query.modified_move_speed <= 0.1 && !query.is_sneaking' },
];

const MAX_CLASSES_SCANNED = Number.POSITIVE_INFINITY;
const MAX_CLASS_BYTES = Number.POSITIVE_INFINITY;
const decoder = new TextDecoder();

/** Held-item gate. Item ids come from the mod's own registry evidence, never from a guess. */
export function heldItemCondition(itemId: string): string {
  return `query.is_item_name_any('slot.weapon.mainhand', 0, '${itemId}')`;
}

/** Scans compiled classes for the Java APIs a player-animation mod gates its tracks on. */
interface JavaClassSignalEvidence { path: string; text: string; concepts: Set<string>; }

/** Keep API hits scoped to the class that contains them; unrelated class hits are not trigger proof. */
function scanJavaSignals(entries: ExtractedZipEntry[]): { classesScanned: number; hits: Map<string, string>; classEvidence: JavaClassSignalEvidence[] } {
  const hits = new Map<string, string>();
  const classEvidence: JavaClassSignalEvidence[] = [];
  let classesScanned = 0;
  for (const entry of entries) {
    if (classesScanned >= MAX_CLASSES_SCANNED) break;
    const path = entry.path.replace(/\\\\/g, '/');
    if (!path.toLowerCase().endsWith('.class') || entry.data.length > MAX_CLASS_BYTES) continue;
    classesScanned += 1;
    let text = '';
    try { text = decoder.decode(entry.data); } catch { continue; }
    const concepts = new Set<string>();
    for (const rule of CONCEPTS) {
      if (!rule.java.test(text)) continue;
      concepts.add(rule.concept);
      if (!hits.has(rule.concept)) hits.set(rule.concept, path);
    }
    if (concepts.size > 0 || text.length > 0) classEvidence.push({ path, text, concepts });
  }
  return { classesScanned, hits, classEvidence };
}

function classEvidenceForClip(evidence: JavaClassSignalEvidence[], sourceClipId: string, clipId: string): JavaClassSignalEvidence[] {
  const candidates = [...new Set([sourceClipId, clipId])].map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 4);
  if (candidates.length === 0) return [];
  return evidence.filter((entry) => candidates.some((candidate) => entry.text.toLowerCase().includes(candidate)));
}

function bytecodeNumber(instruction: JvmInstruction): number | null {
  const value = instruction.constant?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const op = instruction.opcode;
  if (op >= 0x02 && op <= 0x08) return op - 0x03;
  if (op === 0x10 || op === 0x11) return instruction.operands[0] ?? null;
  return null;
}

function runtimeEventForSourceMethod(method: JvmMethodIR): PlayerRuntimeEvent | undefined {
  const signature = [
    method.name,
    method.descriptor,
    ...method.localVariables.map((local) => local.name + ':' + local.descriptor),
    ...method.calls.map((call) => (call.owner ?? '') + '.' + (call.name ?? '')),
  ].join(' ').toLowerCase();
  const typedEvents = new Set<PlayerRuntimeEvent>();
  if (/livinghurtevent|livingdamageevent|livingattackevent|entitydamageevent|entityhurtevent/.test(signature)) typedEvents.add('entityHurt');
  if (/attackentityevent|entityhitresult|entityattackevent|entityhitentityevent/.test(signature)) typedEvents.add('entityHitEntity');
  if (/playerswingstart|playerswingevent|swingevent/.test(signature)) typedEvents.add('playerSwingStart');
  if (/rightclickitem|itemuseevent|useitemcallback|playeritemuse/.test(signature)) typedEvents.add('itemUse');
  if (/playeremote|emoteevent/.test(signature)) typedEvents.add('playerEmote');
  if (typedEvents.size === 1) return [...typedEvents][0];
  if (typedEvents.size > 1) return undefined;
  const name = method.name.toLowerCase();
  if (/hurt|damage|injur/.test(name)) return 'entityHurt';
  if (/swing/.test(name)) return 'playerSwingStart';
  if (/attack|hit|strike/.test(name)) return 'entityHitEntity';
  if (/useitem|itemuse|consume|startusing/.test(name)) return 'itemUse';
  if (/emote/.test(name)) return 'playerEmote';
  return undefined;
}

function bytecodeEvidenceForClip(
  classes: JvmClassIR[],
  sourceClipId: string,
  clipId: string,
): { evidence: string; conceptEvidence: string; sourcePriority?: number; runtimeTrigger?: string; runtimeEvent?: PlayerRuntimeEvent } | null {
  const keys = new Set([sourceClipId, clipId].map((value) => value.trim().toLowerCase()).filter(Boolean));
  const keyTails = new Set([...keys].map((value) => value.split(/[.:/]+/).pop() ?? value).filter((value) => value.length >= 4));
  const runtimeCalls = /^(triggerAnim|triggerAnimation|playAnimation|setAnimation|startAnimation|stopAnimation|stopTriggeredAnim|replaceAnimationWithFade)$/i;
  const priorityCalls = /^(setPriority|setLayerPriority|setAnimationPriority|registerFactory)$/i;
  const matches: Array<{ evidence: string; conceptEvidence: string; sourcePriority?: number; runtimeTrigger?: string; runtimeEvent?: PlayerRuntimeEvent }> = [];
  for (const item of classes) {
    for (const method of item.methods) {
      const stringValues = method.instructions
        .filter((instruction) => instruction.mnemonic.startsWith('ldc') && typeof instruction.constant?.value === 'string')
        .map((instruction) => String(instruction.constant?.value).trim().toLowerCase());
      if (!stringValues.some((value) => keys.has(value) || [...keyTails].some((tail) => value === tail || value.endsWith(':' + tail) || value.endsWith('/' + tail)))) continue;
      const callNames = method.instructions
        .map((instruction) => instruction.constant?.name)
        .filter((name): name is string => typeof name === 'string');
      const conceptEvidence = [item.name, method.name, ...callNames].join(' ');
      let sourcePriority: number | undefined;
      for (let index = 0; index < method.instructions.length; index += 1) {
        const callName = method.instructions[index].constant?.name ?? '';
        if (!priorityCalls.test(callName)) continue;
        for (let previous = index - 1; previous >= 0 && previous >= index - 8; previous--) {
          const numeric = bytecodeNumber(method.instructions[previous]);
          if (numeric !== null) { sourcePriority = numeric; break; }
        }
        if (sourcePriority !== undefined) break;
      }
      const runtimeTrigger = callNames.find((name) => runtimeCalls.test(name));
      const runtimeEvent = runtimeTrigger ? runtimeEventForSourceMethod(method) : undefined;
      matches.push({
        evidence: item.name + '.' + method.name + (runtimeTrigger ? ' -> ' + runtimeTrigger : ''),
        conceptEvidence,
        sourcePriority,
        runtimeTrigger,
        runtimeEvent,
      });
    }
  }
  if (matches.length === 0) return null;
  const priorities = [...new Set(matches.map((match) => match.sourcePriority).filter((value): value is number => value !== undefined))];
  return {
    evidence: matches.map((match) => match.evidence).join('; '),
    conceptEvidence: matches.map((match) => match.conceptEvidence).join(' '),
    sourcePriority: priorities.length === 1 ? priorities[0] : undefined,
    runtimeTrigger: [...new Set(matches.map((match) => match.runtimeTrigger).filter((value): value is string => Boolean(value)))][0],
    runtimeEvent: (() => {
      const runtimeMatches = matches.filter((match) => Boolean(match.runtimeTrigger));
      const events = [...new Set(runtimeMatches.map((match) => match.runtimeEvent).filter((value): value is PlayerRuntimeEvent => Boolean(value)))];
      return runtimeMatches.length > 0 && events.length === 1 && runtimeMatches.every((match) => match.runtimeEvent === events[0]) ? events[0] : undefined;
    })(),
  };
}

/**
 * Perspective must come from explicit source identity, not from the bones a clip moves.
 * Third-person sword swings, punches and emotes commonly animate only arms/hands; gating every
 * upper-body-only clip behind query.is_first_person makes those animations invisible to everyone
 * watching the player in third person, with no content-log error. The view-model mapper already
 * uses these explicit identity tags, so keep trigger activation consistent with that contract.
 */
function perspectiveOf(clipId: string): 'first' | 'third' {
  return /first[_-]?person|firstperson|view[_-]?model|item[_-]?in[_-]?hand|hand[_-]?pose|arm[_-]?pose/i.test(clipId)
    ? 'first'
    : 'third';
}

/** Require the actual Java mod identity and mixin class; an asset-only pack is not proof of its state machine. */
function hasPalPlayerAnimationNamespace(entries: ExtractedZipEntry[]): boolean {
  return entries.some((entry) => {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    return path.includes('/player_animations/') || path.includes('/player_animation_library/');
  });
}

function hasPalPlayerAnimationProfile(entries: ExtractedZipEntry[]): boolean {
  const hasAssets = hasPalPlayerAnimationNamespace(entries);
  if (!hasAssets) return false;
  return entries.some((entry) => {
    if (!entry.path.toLowerCase().endsWith('.class')) return false;
    try {
      const text = decoder.decode(entry.data);
      return /PlayerAnimationController|PlayerAnimationFactory|PlayerRawAnimationBuilder|com\/zigythebird\/playeranim/i.test(text);
    } catch {
      return false;
    }
  });
}

function hasSeriousPlayerAnimationsNamespace(entries: ExtractedZipEntry[]): boolean {
  return entries.some((entry) =>
    entry.path.replace(/\\/g, '/').toLowerCase().includes('assets/seriousplayeranimations/player_animation/'),
  );
}

function hasSeriousPlayerAnimationsProfile(entries: ExtractedZipEntry[]): boolean {
  const sourceEntry = entries.find((entry) => {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    return path.endsWith('net/mcvader/seriousplayeranimations/mixin/seriousplayeranimationsmixin.class') ||
      path.endsWith('net/mcvader/seriousplayeranimations/mixin/seriousplayeranimationsmixin.java');
  });
  if (!sourceEntry) return false;

  let classText = '';
  try {
    classText = decoder.decode(sourceEntry.data);
  } catch {
    return false;
  }
  const sourceMarkers = [
    'reloadAnimationVariables',
    'moveSpeed',
    'isMovingBackwards',
    'prevbyaw',
    'walking_sneak',
  ];
  if (!sourceMarkers.every((marker) => classText.includes(marker))) return false;

  let modIdFound = false;
  let versionFound = false;
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    let content = '';
    try {
      content = decoder.decode(entry.data);
    } catch {
      continue;
    }
    if (path.endsWith('fabric.mod.json')) {
      try {
        const metadata = JSON.parse(content) as { id?: string; version?: string };
        if (metadata.id === 'seriousplayeranimations') {
          modIdFound = true;
          versionFound = ['1.1.0', '1.1.1'].includes(metadata.version ?? '');
        }
      } catch {
        // Continue to Forge metadata if this is not a valid Fabric descriptor.
      }
    } else if (path.endsWith('meta-inf/mods.toml')) {
      modIdFound = /modId\s*=\s*["']seriousplayeranimations["']/i.test(content);
      versionFound = versionFound || /version\s*=\s*["']1\.1\.[01]["']/i.test(content);
    } else if (path.endsWith('meta-inf/manifest.mf')) {
      versionFound = versionFound || /^Implementation-Version:\s*1\.1\.[01]\s*$/im.test(content);
    }
  }
  return modIdFound && versionFound;
}

/**
 * Source-backed adapter for Serious Player Animations 1.1.1 (pinned upstream source revision).
 *
 * The upstream mixin selects locomotion clips from per-tick position deltas, body-yaw deltas,
 * sneaking and sprinting state. Shield clips are a second animation layer, not locomotion states.
 * The extra animation.running Blender-rig definition is not loaded by the Java state machine:
 * reloadAnimationVariables() requests the resource key running.
 */
function seriousPlayerAnimationTrigger(
  clipId: string,
  shortName: string,
  sourceClipId: string,
): PlayerClipTrigger | null {
  const sourceLower = sourceClipId.toLowerCase();
  const tail = sourceLower.split(/[.:/]+/).pop() ?? sourceLower;
  const evidence = 'McVader34/Serious-Player-Animations 1.1.1 upstream source (JAR metadata version 1.1.0): SeriousPlayerAnimationsMixin.reloadAnimationVariables() and animate()';
  const move = 'variable.spa_move_speed';
  const backwards = 'variable.spa_moving_backwards';
  const notSneaking = '!query.is_sneaking';
  const shieldHeld = "(query.is_item_name_any('slot.weapon.mainhand', 'minecraft:shield') || query.is_item_name_any('slot.weapon.offhand', 'minecraft:shield'))";
  const base = {
    clipId,
    sourceClipId,
    shortName,
    javaEvidence: evidence,
    scriptDriven: false,
    perspective: 'third' as const,
  };

  if (sourceLower === 'animation.running' || sourceLower.endsWith('.animation.running')) {
    return {
      ...base,
      concept: 'unreferenced-source-definition',
      status: 'unresolved',
      note: 'The upstream Java state machine loads the running resource key; this separate animation.running Blender-rig definition is not referenced by reloadAnimationVariables() and has no runtime start path.',
    };
  }
  switch (tail) {
    case 'idle_standing':
      return {
        ...base,
        concept: 'idle',
        condition: move + ' == 0.0 && ' + notSneaking + ' && variable.spa_turn_delta == 0.0',
        status: 'mapped',
        note: 'Exact source state: zero horizontal movement, not sneaking, and no body-yaw delta.',
      };
    case 'walking':
      return {
        ...base,
        concept: 'moving',
        condition: move + ' > 0.0 && ' + move + ' < 0.23 && !' + backwards + ' && ' + notSneaking,
        status: 'mapped',
        note: 'Exact source state: horizontal speed below 0.23 blocks/tick, moving forward, and not sneaking.',
      };
    case 'walking_backwards':
      return {
        ...base,
        concept: 'moving',
        condition: backwards + ' && ' + notSneaking,
        status: 'mapped',
        note: 'Exact source state: movement-vector dot look-vector is negative and the player is not sneaking.',
      };
    case 'running':
      return {
        ...base,
        concept: 'sprinting',
        condition: move + ' > 0.23 && query.is_sprinting && !' + backwards + ' && ' + notSneaking,
        status: 'mapped',
        note: 'Exact source state: speed above 0.23 blocks/tick, sprinting, moving forward, and not sneaking.',
      };
    case 'idle_sneak':
      return {
        ...base,
        concept: 'sneaking',
        condition: 'query.is_sneaking && ' + move + ' == 0.0 && !' + backwards,
        status: 'mapped',
        note: 'Exact source state: sneaking with no horizontal movement.',
      };
    case 'walking_sneak':
      return {
        ...base,
        concept: 'sneaking',
        condition: 'query.is_sneaking && ' + move + ' > 0.0 && !' + backwards,
        status: 'mapped',
        note: 'Exact source state: sneaking while moving forward.',
      };
    case 'shield':
      return {
        ...base,
        concept: 'using-item',
        condition: 'query.is_using_item && ' + shieldHeld + ' && !query.is_sneaking',
        layer: 'overlay',
        status: 'approximated',
        note: 'Source shield pose is an independent overlay layer. Bedrock preserves that layer; offhand mirroring from the Java MirrorModifier remains approximate.',
      };
    case 'shield_sneak':
      return {
        ...base,
        concept: 'using-item',
        condition: 'query.is_using_item && ' + shieldHeld + ' && query.is_sneaking',
        layer: 'overlay',
        status: 'approximated',
        note: 'Source crouching-shield pose is an independent overlay layer. Bedrock preserves that layer; offhand mirroring from the Java MirrorModifier remains approximate.',
      };
    default:
      return null;
  }
}

/**
 * Translates every imported player clip's Java trigger into a Bedrock-evaluable condition.
 * Nothing is invented: a clip whose Java condition cannot be recovered is reported as
 * unresolved and gets no condition at all.
 */
export function translatePlayerTriggers(options: {
  clips: Record<string, BedrockAnimationClip>;
  archiveEntries?: ExtractedZipEntry[];
  /** Exact imported clip id -> original key in the source animation document. */
  sourceClipIdsByClipId?: Record<string, string>;
  mainhandItemIds?: string[];
  onLog?: (line: string) => void;
  /** Instruction-level evidence retained by the Java decompiler for this archive. */
  bytecodeClasses?: JvmClassIR[];
}): PlayerTriggerReport {
  const log = (line: string) => options.onLog?.(line);
  const archiveEntries = options.archiveEntries ?? [];
  const { classesScanned, hits, classEvidence } = scanJavaSignals(archiveEntries);
  const seriousPlayerProfile = hasSeriousPlayerAnimationsProfile(archiveEntries);
  const seriousPlayerNamespace = hasSeriousPlayerAnimationsNamespace(archiveEntries);
  const palPlayerProfile = hasPalPlayerAnimationProfile(archiveEntries);
  const palPlayerNamespace = hasPalPlayerAnimationNamespace(archiveEntries);
  const usedShortNames = new Set<string>();
  const triggers: PlayerClipTrigger[] = [];
  const itemIds = options.mainhandItemIds ?? [];

  for (const [clipId, clip] of Object.entries(options.clips)) {
    const sourceClipId = options.sourceClipIdsByClipId?.[clipId] ?? clipId;
    const tail = clipId.split(/[.:/]+/).pop() ?? clipId;
    const base = safeFileId(tail) || 'clip';
    let shortName = `ported_${base}`;
    let index = 2;
    while (usedShortNames.has(shortName)) {
      shortName = `ported_${base}_${index}`;
      index += 1;
    }
    usedShortNames.add(shortName);

    const clipTokens = new Set([...identityTokens(tail), ...identityTokens(clipId)]);
    const concept = CONCEPTS.find((rule) => {
      if (!rule.clip.test(tail) && !rule.clip.test(clipId)) return false;
      return [...identityTokens(tail)].some((token) => rule.clip.test(token)) || rule.clip.test(tail);
    });
    const perspective = perspectiveOf(clipId);

    if (seriousPlayerProfile) {
      const sourceTrigger = seriousPlayerAnimationTrigger(clipId, shortName, sourceClipId);
      if (sourceTrigger) {
        triggers.push(sourceTrigger);
        continue;
      }
    }

    if (!concept) {
      triggers.push({
        clipId,
        sourceClipId,
        shortName,
        concept: 'unclassified',
        javaEvidence: 'no Java condition correlated with this clip',
        status: 'unresolved',
        scriptDriven: false,
        perspective,
        note: 'Clip ships registered but unreferenced: no Java trigger could be recovered, so no condition was invented.',
      });
      continue;
    }

    const clipClasses = classEvidenceForClip(classEvidence, sourceClipId, clipId);
    const clipEvidence = clipClasses.find((entry) => entry.concepts.has(concept.concept));
    const bytecodeEvidence = bytecodeEvidenceForClip(options.bytecodeClasses ?? [], sourceClipId, clipId);
    const bytecodeConfirmsConcept = Boolean(bytecodeEvidence && concept.java.test(bytecodeEvidence.conceptEvidence));
    const evidencePath = clipEvidence?.path ?? (bytecodeConfirmsConcept ? bytecodeEvidence?.evidence : undefined);
    if (bytecodeEvidence?.runtimeTrigger && bytecodeEvidence.runtimeEvent && evidencePath) {
      triggers.push({
        clipId, sourceClipId, shortName, concept: concept.concept,
        javaEvidence: evidencePath,
        runtimeTrigger: bytecodeEvidence.runtimeTrigger,
        runtimeEvent: bytecodeEvidence.runtimeEvent,
        sourcePriority: bytecodeEvidence.sourcePriority,
        status: 'script-driven',
        scriptDriven: true,
        perspective,
        note: `Bytecode confirms ${bytecodeEvidence.runtimeTrigger} in a source call path mapped to ${bytecodeEvidence.runtimeEvent}; the behaviour pack replays this clip from the matching Bedrock after-event.`,
      });
      continue;
    }
    if (bytecodeEvidence?.runtimeTrigger && !bytecodeEvidence.runtimeEvent) {
      triggers.push({
        clipId, sourceClipId, shortName, concept: concept.concept,
        javaEvidence: evidencePath ?? bytecodeEvidence.evidence,
        runtimeTrigger: bytecodeEvidence.runtimeTrigger,
        sourcePriority: bytecodeEvidence.sourcePriority,
        status: 'unresolved',
        scriptDriven: false,
        perspective,
        note: 'A Java runtime animation call was found, but its call-site method does not map unambiguously to a Bedrock event; the clip is not auto-played.',
      });
      continue;
    }

    if (concept.script) {
      if (!evidencePath) {
        triggers.push({
          clipId,
          sourceClipId,
          shortName,
          concept: concept.concept,
          javaEvidence: `${concept.java.source} not found in archive bytecode; clip name alone is insufficient`,
          status: 'unresolved',
          scriptDriven: false,
          perspective,
          note: 'The action is left unbound: a clip name alone does not prove when Java fires it.',
        });
        continue;
      }
      triggers.push({
        clipId,
        sourceClipId,
        shortName,
        concept: concept.concept,
        javaEvidence: evidencePath,
        runtimeTrigger: bytecodeEvidence?.runtimeTrigger,
        sourcePriority: bytecodeEvidence?.sourcePriority,
        status: 'script-driven',
        scriptDriven: true,
        perspective,
        note: 'One-shot Java logic is fired from the behaviour-pack script only after matching source evidence is found.',
      });
      continue;
    }

    const held = concept.concept === 'using-item'
      ? itemIds.find((item) => identityTokens(item).some((token) => clipTokens.has(token)))
      : undefined;
    const condition = evidencePath ? (held ? heldItemCondition(held) : concept.molang) : undefined;
    const correlatedOnly = !evidencePath;
    triggers.push({
      clipId,
      sourceClipId,
      shortName,
      concept: concept.concept,
      condition,
      javaEvidence: evidencePath ?? `clip id correlates with "${concept.concept}"; no Java call site found`,
      runtimeTrigger: bytecodeEvidence?.runtimeTrigger,
      sourcePriority: bytecodeEvidence?.sourcePriority,
      status: correlatedOnly ? 'unresolved' : 'mapped',
      scriptDriven: false,
      perspective,
      note: held && evidencePath
        ? `Held-item gate derived from the mod's own item id "${held}" and source evidence.`
        : correlatedOnly
          ? 'Clip-name correlation is reported for review only; no playback condition is attached without Java evidence.'
          : 'Condition translated from the Java API reference found in the archive.',
    });
  }

  const runtimeGroups = new Map<PlayerRuntimeEvent, PlayerClipTrigger[]>();
  for (const trigger of triggers) {
    if (!trigger.scriptDriven || !trigger.runtimeEvent) continue;
    const group = runtimeGroups.get(trigger.runtimeEvent) ?? [];
    group.push(trigger);
    runtimeGroups.set(trigger.runtimeEvent, group);
  }
  for (const [eventName, group] of runtimeGroups) {
    if (group.length <= 1) continue;
    for (const trigger of group) {
      trigger.status = 'unresolved';
      trigger.scriptDriven = false;
      trigger.runtimeEvent = undefined;
      trigger.note = `Multiple source clips resolve to the same ${eventName} event; without a unique bytecode branch-to-clip condition, no one-shot animation is guessed or played.`;
    }
  }

  // No trigger is inferred from a clip name, duration, loop flag, or bone layout.
  // If source code/data does not establish the activation condition, keep it unresolved.

  const report: PlayerTriggerReport = {
    clipsInspected: triggers.length,
    mapped: triggers.filter((t) => t.status === 'mapped').length,
    approximated: triggers.filter((t) => t.status === 'approximated').length,
    scriptDriven: triggers.filter((t) => t.scriptDriven).length,
    unresolved: triggers.filter((t) => t.status === 'unresolved').length,
    classesScanned,
    javaSignals: [...hits.keys()],
    sourceProfile: seriousPlayerProfile ? 'Serious Player Animations 1.1.1' : palPlayerProfile ? 'Player Animation Library (PAL)' : undefined,
    sourceProfileCandidate: !seriousPlayerProfile && !palPlayerProfile
      ? seriousPlayerNamespace
        ? 'Serious Player Animations 1.1.1 (base Java mod JAR required)'
        : palPlayerNamespace
          ? 'Player Animation Library (PAL) (matching Java controller classes not found)'
          : undefined
      : undefined,
    triggers,
    summary: '',
  };
  report.summary = `${report.clipsInspected} player clip(s) inspected: ${report.mapped} mapped from source evidence, ${report.approximated} approximated, ${report.scriptDriven} fired from script, ${report.unresolved} unresolved${report.sourceProfile ? `; source profile ${report.sourceProfile}` : report.sourceProfileCandidate ? `; ${report.sourceProfileCandidate}` : ''}.`;
  if (report.clipsInspected > 0) {
    log(`[TRIGGER-BRIDGE] ${report.summary}`);
    if (report.sourceProfile) {
      log(`[TRIGGER-BRIDGE] Recognized source framework/profile ${report.sourceProfile} from matching Java class and mod metadata.`);
    } else if (report.sourceProfileCandidate) {
      log('[TRIGGER-BRIDGE] Found the Serious Player Animations resource namespace, but the verified base Java mod JAR is missing; no playback conditions were guessed.');
    }
    if (report.javaSignals.length > 0) {
      log(`[TRIGGER-BRIDGE] Java player states found in ${classesScanned} scanned class(es): ${report.javaSignals.join(', ')}.`);
    }
    for (const trigger of triggers.slice(0, 8)) {
      log(
        `[TRIGGER-BRIDGE] ${trigger.clipId} — ${trigger.status}${trigger.condition ? ` (${trigger.condition})` : ''} from ${trigger.javaEvidence}.`,
      );
    }
  }
  return report;
}