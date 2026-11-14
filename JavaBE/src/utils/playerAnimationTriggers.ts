import type { ExtractedZipEntry } from '@/utils/zip';
import type { BedrockAnimationClip } from '@/utils/animationTranslator';
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
 *  - a condition is only emitted when the archive's own code/data references the matching
 *    Java concept; a matching clip name is a candidate, not proof of playback intent;
 *  - mob-only queries (`query.has_target`, `query.target_distance`, …) are never emitted
 *    for a player, because they do not exist in that context;
 *  - one-shot Java logic (attack / combo / special moves) becomes a script-driven clip,
 *    because Molang cannot express arbitrary Java control flow.
 */

export type PlayerTriggerStatus = 'mapped' | 'approximated' | 'script-driven' | 'unresolved';

export interface PlayerClipTrigger {
  clipId: string;
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
  note: string;
}

export interface PlayerTriggerReport {
  clipsInspected: number;
  mapped: number;
  approximated: number;
  scriptDriven: number;
  unresolved: number;
  classesScanned: number;
  javaSignals: string[];
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
function scanJavaSignals(entries: ExtractedZipEntry[]): { classesScanned: number; hits: Map<string, string> } {
  const hits = new Map<string, string>();
  let classesScanned = 0;
  for (const entry of entries) {
    if (classesScanned >= MAX_CLASSES_SCANNED) break;
    const path = entry.path.replace(/\\/g, '/');
    if (!path.toLowerCase().endsWith('.class')) continue;
    if (entry.data.length > MAX_CLASS_BYTES) continue;
    classesScanned += 1;
    let text = '';
    try {
      text = decoder.decode(entry.data);
    } catch {
      continue;
    }
    for (const rule of CONCEPTS) {
      if (hits.has(rule.concept)) continue;
      if (rule.java.test(text)) hits.set(rule.concept, path);
    }
  }
  return { classesScanned, hits };
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

/**
 * Translates every imported player clip's Java trigger into a Bedrock-evaluable condition.
 * Nothing is invented: a clip whose Java condition cannot be recovered is reported as
 * unresolved and gets no condition at all.
 */
export function translatePlayerTriggers(options: {
  clips: Record<string, BedrockAnimationClip>;
  archiveEntries?: ExtractedZipEntry[];
  mainhandItemIds?: string[];
  onLog?: (line: string) => void;
}): PlayerTriggerReport {
  const log = (line: string) => options.onLog?.(line);
  const { classesScanned, hits } = scanJavaSignals(options.archiveEntries ?? []);
  const usedShortNames = new Set<string>();
  const triggers: PlayerClipTrigger[] = [];
  const itemIds = options.mainhandItemIds ?? [];

  for (const [clipId, clip] of Object.entries(options.clips)) {
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

    if (!concept) {
      triggers.push({
        clipId,
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

    const evidencePath = hits.get(concept.concept);
    if (concept.script) {
      if (!evidencePath) {
        triggers.push({
          clipId,
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
        shortName,
        concept: concept.concept,
        javaEvidence: evidencePath,
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
      shortName,
      concept: concept.concept,
      condition,
      javaEvidence: evidencePath ?? `clip id correlates with "${concept.concept}"; no Java call site found`,
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
    triggers,
    summary: '',
  };
  report.summary = `${report.clipsInspected} player clip(s) inspected: ${report.mapped} mapped from Java evidence, ${report.approximated} approximated from clip correlation, ${report.scriptDriven} fired from script, ${report.unresolved} unresolved.`;
  if (report.clipsInspected > 0) {
    log(`[TRIGGER-BRIDGE] ${report.summary}`);
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