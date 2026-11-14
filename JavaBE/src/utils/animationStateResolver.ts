import type { BedrockAnimationClip } from '@/utils/animationTranslator';
import { synthesizeStateController, type StateMachineState } from '@/utils/animationStateControllers';
import { isKnownVanillaPlayerAnimationReference } from '@/utils/clientEntitySchema';

/**
 * Dynamic animation state analysis.
 *
 * A Bedrock client entity plays every `scripts.animate` entry whose condition evaluates true,
 * blending them by weight. Two clips that share a condition and move the same bones therefore
 * fight over the same joints frame by frame — the classic "walking and running play at the same
 * time" defect, which produces a stretched or twitching pose with no error in the log.
 *
 * This stage derives the state model from the shipped pack rather than from a mod list:
 *
 *   • duplicate identifiers (one clip defined twice, or one clip registered under several keys)
 *     are collapsed — they are the same motion played twice, never a second state;
 *   • every activation condition is parsed into engine dimensions (locomotion, sprint, sneak,
 *     swim, ride, airborne, attack, use, hurt, perspective …) so two conditions can be proven
 *     mutually exclusive, or proven to be able to hold at the same time;
 *   • clips are ranked by what they are (one-shot action > sprint/sneak/swim > movement > idle >
 *     pose overlay) and by how much of the skeleton they claim;
 *   • overlapping full-body states are made mutually exclusive by guarding the lower-priority
 *     clip with the higher one's condition, so the pose is deterministic;
 *   • states that cannot be separated (identical conditions, nothing to distinguish them) are
 *     shadowed: the higher-priority clip keeps the activation and the other is reported instead
 *     of both playing at once;
 *   • partially overlapping clips (different limbs) are left to blend, and reported as such.
 */

export interface StateConflict {
  entity: string;
  higher: string;
  lower: string;
  reason: string;
  resolution: 'guarded' | 'blended' | 'controller' | 'shadowed' | 'exclusive';
}

export interface GuardedState {
  entity: string;
  entityPath: string;
  key: string;
  clipId: string;
  condition: string;
}

export interface AnimationStateReport {
  entitiesAnalysed: number;
  animateEntries: number;
  duplicateDefinitions: string[];
  duplicatesRemoved: number;
  duplicateRegistrations: string[];
  conflicts: StateConflict[];
  guarded: GuardedState[];
  shadowed: string[];
  /** Animation controllers synthesised so inseparable states stay selectable. */
  controllersCreated: string[];
  controllerStates: number;
  /** Clips kept reachable only through the documented variant alternation. */
  controllerStaggered: string[];
  controllerUnreachable: string[];
  blendedPairs: number;
  exclusivePairs: number;
  equipmentDriven: string[];
  priorities: Array<{ clip: string; concept: string; priority: number }>;
  notes: string[];
  summary: string;
}

type FileMap = Record<string, string | Uint8Array>;

const ENGINE_CLIP = { test: isKnownVanillaPlayerAnimationReference };

const CONCEPT_PRIORITY: Record<string, number> = {
  attacking: 5,
  hurt: 5,
  'using-item': 5,
  sprinting: 4,
  sneaking: 4,
  swimming: 4,
  riding: 4,
  moving: 3,
  airborne: 3,
  idle: 2,
  'pose-overlay': 1,
};

const ACTION_CONCEPTS = new Set(['attacking', 'hurt', 'using-item']);
const EQUIPMENT_BONE = /item|hand|weapon|tool|hold/i;

interface Atom {
  dimension: string;
  kind: 'bool' | 'num';
  polarity: boolean;
  lo: number;
  hi: number;
}

const DIMENSIONS: Array<[RegExp, string]> = [
  [/modified_move_speed|ground_speed|walk_speed|\bvelocity\b/i, 'locomotion'],
  [/is_sprinting/i, 'sprint'],
  [/is_sneaking|is_crawling/i, 'sneak'],
  [/is_swimming/i, 'swim'],
  [/is_riding/i, 'ride'],
  [/is_on_ground|is_falling/i, 'airborne'],
  [/is_first_person/i, 'perspective'],
  [/attack_time/i, 'attack'],
  [/is_using_item|item_use_time/i, 'use'],
  [/hurt_time/i, 'hurt'],
];

function dimensionOf(name: string): string {
  for (const [pattern, dimension] of DIMENSIONS) if (pattern.test(name)) return dimension;
  return `other:${name.toLowerCase()}`;
}

function negateOp(op: string): string {
  if (op === '>') return '<=';
  if (op === '>=') return '<';
  if (op === '<') return '>=';
  if (op === '<=') return '>';
  if (op === '==') return '!=';
  return '==';
}

function interval(op: string, value: number): { lo: number; hi: number } {
  if (op === '>') return { lo: value, hi: Number.POSITIVE_INFINITY };
  if (op === '>=') return { lo: value, hi: Number.POSITIVE_INFINITY };
  if (op === '<') return { lo: Number.NEGATIVE_INFINITY, hi: value };
  if (op === '<=') return { lo: Number.NEGATIVE_INFINITY, hi: value };
  if (op === '==') return { lo: value, hi: value };
  return { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY };
}

const TERM = /(!)?\s*\(*\s*(query|variable)\.([a-z0-9_]+)\s*(?:(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?))?/gi;

/** Parses one activation condition into engine-state constraints. */
function parseAtoms(condition: string): Atom[] {
  const atoms: Atom[] = [];
  if (!condition) return atoms;
  for (const match of condition.matchAll(TERM)) {
    const negated = Boolean(match[1]);
    const name = String(match[3] ?? '');
    const dimension = dimensionOf(name);
    const op = match[4];
    const value = match[5];
    if (!op || value === undefined) {
      atoms.push({ dimension, kind: 'bool', polarity: !negated, lo: 0, hi: 0 });
      continue;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    const effectiveOp = negated ? negateOp(op) : op;
    const range = interval(effectiveOp, numeric);
    atoms.push({ dimension, kind: 'num', polarity: true, lo: range.lo, hi: range.hi });
  }
  return atoms;
}

function provablyExclusive(a: Atom, b: Atom): boolean {
  if (a.dimension !== b.dimension) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'bool') return a.polarity !== b.polarity;
  return Math.max(a.lo, b.lo) > Math.min(a.hi, b.hi);
}

function canCoexist(a: Atom[], b: Atom[]): boolean {
  for (const left of a) {
    for (const right of b) {
      if (provablyExclusive(left, right)) return false;
    }
  }
  return true;
}

function normalizeCondition(condition: string): string {
  return condition.replace(/\s+/g, '').toLowerCase();
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function channelCount(clip: Record<string, any>): number {
  const bones = clip.bones;
  if (!bones || typeof bones !== 'object') return 0;
  let total = 0;
  for (const track of Object.values(bones as Record<string, any>)) {
    if (!track || typeof track !== 'object') continue;
    for (const channel of ['rotation', 'position', 'scale']) {
      const value = (track as Record<string, any>)[channel];
      if (value === undefined) continue;
      total += value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 1;
    }
  }
  return total;
}

/** One clip defined by several documents ships once; the richest definition wins. */
function mergeDuplicateDefinitions(files: FileMap, log: (line: string) => void): { merged: string[]; removed: number } {
  const owners = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const doc = parseJson(files[path]);
    const animations = doc?.animations;
    if (!animations || typeof animations !== 'object') continue;
    for (const clipId of Object.keys(animations as Record<string, any>)) {
      const list = owners.get(clipId) ?? [];
      list.push(path);
      owners.set(clipId, list);
    }
  }
  const merged: string[] = [];
  let removed = 0;
  const emptied = new Set<string>();
  for (const [clipId, paths] of owners) {
    if (paths.length < 2) continue;
    let keepPath = paths[0];
    let keepChannels = -1;
    for (const path of paths) {
      const doc = parseJson(files[path]);
      const clip = doc?.animations?.[clipId];
      const channels = clip && typeof clip === 'object' ? channelCount(clip as Record<string, any>) : 0;
      if (channels > keepChannels) {
        keepChannels = channels;
        keepPath = path;
      }
    }
    for (const path of paths) {
      if (path === keepPath) continue;
      const doc = parseJson(files[path]);
      if (!doc?.animations?.[clipId]) continue;
      delete doc.animations[clipId];
      removed += 1;
      if (Object.keys(doc.animations).length === 0) {
        emptied.add(path);
        delete files[path];
      } else {
        files[path] = JSON.stringify(doc, null, 2);
      }
    }
    merged.push(clipId);
    log(
      `[ANIM:STATE] Duplicate definition of "${clipId}" collapsed: ${paths.length} documents declared it and the engine keeps only one, so the ${keepChannels}-channel definition in ${keepPath} is the one that plays.`,
    );
  }
  for (const path of emptied) {
    log(`[ANIM:STATE] ${path} declared only duplicate identifiers and was removed instead of shipping an empty animation document.`);
  }
  return { merged, removed };
}

interface AnimateEntry {
  key: string;
  clipId: string;
  condition: string;
}

export function resolveAnimationStateConflicts(input: {
  resourcePackFiles: FileMap;
  modId?: string;
  onLog?: (line: string) => void;
}): AnimationStateReport {
  const log = (line: string) => input.onLog?.(line);
  const files = input.resourcePackFiles;
  const report: AnimationStateReport = {
    entitiesAnalysed: 0,
    animateEntries: 0,
    duplicateDefinitions: [],
    duplicatesRemoved: 0,
    duplicateRegistrations: [],
    conflicts: [],
    guarded: [],
    shadowed: [],
    controllersCreated: [],
    controllerStates: 0,
    controllerStaggered: [],
    controllerUnreachable: [],
    blendedPairs: 0,
    exclusivePairs: 0,
    equipmentDriven: [],
    priorities: [],
    notes: [],
    summary: '',
  };

  const definitionPass = mergeDuplicateDefinitions(files, log);
  report.duplicateDefinitions = definitionPass.merged;
  report.duplicatesRemoved = definitionPass.removed;

  // Clip bodies, read once: bone sets decide whether two states can fight over a joint.
  const clips: Record<string, Record<string, any>> = {};
  for (const path of Object.keys(files)) {
    if (!path.toLowerCase().endsWith('.animation.json')) continue;
    const doc = parseJson(files[path]);
    const animations = doc?.animations;
    if (!animations || typeof animations !== 'object') continue;
    for (const [clipId, body] of Object.entries(animations as Record<string, any>)) {
      if (body && typeof body === 'object' && !clips[clipId]) clips[clipId] = body as Record<string, any>;
    }
  }

  const boneSetOf = (clipId: string): string[] => {
    const bones = clips[clipId]?.bones;
    return bones && typeof bones === 'object' ? Object.keys(bones as Record<string, unknown>) : [];
  };
  const priorityOf = (_clipId: string): { concept: string; priority: number } => {
    // Clip identity and channel shape are not activation evidence. Until a source controller,
    // state transition, or Java call site establishes semantics, keep a neutral priority.
    return { concept: 'unresolved', priority: 1 };
  };

  const equipment = new Set<string>();

  for (const path of Object.keys(files)) {
    if (!/^entity\/[^/]+\.entity\.json$/i.test(path)) continue;
    const doc = parseJson(files[path]);
    const description = doc?.['minecraft:client_entity']?.description;
    if (!doc || !description || typeof description !== 'object') continue;
    const animations = description.animations;
    if (!animations || typeof animations !== 'object') continue;
    const animate: unknown[] = Array.isArray(description.scripts?.animate) ? description.scripts.animate : [];
    if (animate.length === 0) continue;

    report.entitiesAnalysed += 1;
    const identifier = typeof description.identifier === 'string' ? description.identifier : path;
    const entries: AnimateEntry[] = [];
    const passthrough: unknown[] = [];

    for (const entry of animate) {
      if (typeof entry === 'string') {
        const clipId = typeof animations[entry] === 'string' ? (animations[entry] as string) : '';
        if (!clipId) {
          passthrough.push(entry);
          continue;
        }
        entries.push({ key: entry, clipId, condition: '' });
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, condition] of Object.entries(entry as Record<string, unknown>)) {
        const clipId = typeof animations[key] === 'string' ? (animations[key] as string) : '';
        if (!clipId) {
          passthrough.push({ [key]: condition });
          continue;
        }
        entries.push({ key, clipId, condition: typeof condition === 'string' ? condition : '' });
      }
    }

    report.animateEntries += entries.length;

    // 1. One clip, one activation. The same motion listed twice is played twice.
    const seenClips = new Set<string>();
    const dedupedEntries: AnimateEntry[] = [];
    for (const entry of entries) {
      if (seenClips.has(entry.clipId)) {
        report.duplicateRegistrations.push(`${identifier}: ${entry.clipId}`);
        delete animations[entry.key];
        continue;
      }
      seenClips.add(entry.clipId);
      dedupedEntries.push(entry);
    }

    // 2. Rank the states, then separate the ones that can hold at the same time.
    const analysis = dedupedEntries.map((entry) => {
      const bones = boneSetOf(entry.clipId);
      const { concept, priority } = priorityOf(entry.clipId);
      report.priorities.push({ clip: entry.clipId, concept, priority });
      if (ACTION_CONCEPTS.has(concept) || bones.some((bone) => EQUIPMENT_BONE.test(bone))) {
        equipment.add(entry.clipId);
      }
      const atoms = parseAtoms(entry.condition);
      // Specificity = how many engine states the condition actually constrains. A clip that is
      // active in every state (an idle pose, a permanent overlay) must never outrank the state
      // that replaces it, or the guard would disable the specific clip instead of the broad one.
      const specificity = atoms.filter((atom) => atom.dimension !== 'perspective').length;
      // Keep the original activation immutable while pairwise conflict analysis runs. Mutating
      // it inside the nested loop compounds the same guard once for every conflicting pair.
      return { entry, bones, priority, concept, atoms, specificity, sourceCondition: entry.condition };
    });
    analysis.sort((a, b) => (b.specificity - a.specificity) || (b.priority - a.priority));

    const guardsByEntry = new Map<string, Map<string, string>>();

    // Clips whose poses fight and whose conditions cannot separate them are NOT deactivated: they
    // become the states of a synthesised animation controller, which is the destination-native way
    // to express "exactly one of these owns the pose". Every clip stays declared, registered and
    // selectable — deleting the activation only moved the defect into the report.
    const machineMembers = new Set<string>();
    for (let higherIndex = 0; higherIndex < analysis.length; higherIndex += 1) {
      const higher = analysis[higherIndex];
      for (let lowerIndex = higherIndex + 1; lowerIndex < analysis.length; lowerIndex += 1) {
        const lower = analysis[lowerIndex];
        if (!canCoexist(higher.atoms, lower.atoms)) {
          report.exclusivePairs += 1;
          continue;
        }
        const shared = lower.bones.filter((bone) => higher.bones.includes(bone));
        const denominator = Math.min(higher.bones.length, lower.bones.length);
        const overlap = denominator > 0 ? shared.length / denominator : 0;
        if (overlap < 0.35) {
          report.blendedPairs += 1;
          report.conflicts.push({
            entity: identifier,
            higher: higher.entry.clipId,
            lower: lower.entry.clipId,
            reason: `only ${shared.length} of ${denominator} tracked bone(s) overlap, so the two states drive different limbs`,
            resolution: 'blended',
          });
          continue;
        }
        const sameCondition = normalizeCondition(higher.sourceCondition) === normalizeCondition(lower.sourceCondition);

        if (
          !sameCondition &&
          higher.specificity > 0 &&
          higher.sourceCondition &&
          lower.sourceCondition &&
          lower.atoms.length > 0
        ) {
          const guards = guardsByEntry.get(lower.entry.key) ?? new Map<string, string>();
          const guardKey = normalizeCondition(higher.sourceCondition);
          if (guardKey && !guards.has(guardKey)) guards.set(guardKey, higher.sourceCondition);
          guardsByEntry.set(lower.entry.key, guards);
          report.conflicts.push({
            entity: identifier,
            higher: higher.entry.clipId,
            lower: lower.entry.clipId,
            reason: `both states can hold at once and ${shared.length}/${denominator} tracked bone(s) overlap, so the poses would fight`,
            resolution: 'guarded',
          });
          continue;
        }

        machineMembers.add(higher.entry.key);
        machineMembers.add(lower.entry.key);
        report.conflicts.push({
          entity: identifier,
          higher: higher.entry.clipId,
          lower: lower.entry.clipId,
          reason: sameCondition
            ? 'the two clips share an identical activation condition with no distinguishing engine state, so playing both would blend two poses of the same joints'
            : 'neither clip carries a Molang-readable state to separate them',
          resolution: 'controller',
        });
      }
    }

    // Apply the complete, deduplicated guard set once per clip. This prevents a lower state from
    // repeatedly wrapping an already-wrapped expression when it overlaps several variants of the
    // same higher-priority state. The resulting condition remains the original source condition
    // plus one negation for each distinct higher-priority source condition.
    for (const candidate of analysis) {
      const guards = guardsByEntry.get(candidate.entry.key);
      if (!guards || guards.size === 0) continue;
      const original = candidate.sourceCondition.trim();
      const guarded = [
        ...(original ? [`(${original})`] : []),
        ...[...guards.values()].map((condition) => `!(${condition})`),
      ].join(' && ');
      candidate.entry.condition = guarded;
      candidate.atoms = parseAtoms(guarded);
      report.guarded.push({
        entity: identifier,
        entityPath: path,
        key: candidate.entry.key,
        clipId: candidate.entry.clipId,
        condition: guarded,
      });
    }

    const rebuilt: unknown[] = [];
    for (const entry of dedupedEntries) {
      if (machineMembers.has(entry.key)) continue;
      rebuilt.push(entry.condition ? { [entry.key]: entry.condition } : entry.key);
    }
    // Keys the entity declares but no animate entry addresses (e.g. controller hooks) are kept
    // exactly as they were; only state entries are rewritten here.
    description.scripts = { ...(description.scripts ?? {}), animate: [...passthrough, ...rebuilt] };

    // Two or more inseparable states become one controller instead of one winner and N losers.
    if (machineMembers.size >= 2) {
      const machineStates: StateMachineState[] = analysis
        .filter((entry) => machineMembers.has(entry.entry.key))
        .map((entry) => ({
          key: entry.entry.key,
          clipId: entry.entry.clipId,
          condition: entry.entry.condition,
          priority: entry.priority,
          concept: entry.concept,
          length: Number(clips[entry.entry.clipId]?.animation_length) || 0,
        }));
      const outcome = synthesizeStateController({
        resourcePackFiles: files,
        entityDoc: doc,
        description,
        entityIdentifier: identifier,
        modId: input.modId ?? 'aippy',
        states: machineStates,
        clipDocs: clips,
        onLog: log,
      });
      if (outcome) {
        report.controllersCreated.push(outcome.controllerId);
        report.controllerStates += outcome.states.length;
        report.controllerStaggered.push(...outcome.staggered);
        report.controllerUnreachable.push(
          ...outcome.unreachable.map((entry) => `${identifier}: ${entry.clipId} — ${entry.reason}`),
        );
      } else {
        for (const entry of dedupedEntries) {
          if (!machineMembers.has(entry.key)) continue;
          report.shadowed.push(`${identifier}: ${entry.clipId} (no separable state could be built)`);
        }
      }
    }
    files[path] = JSON.stringify(doc, null, 2);
  }

  report.equipmentDriven = [...equipment];
  if (report.guarded.length > 0) {
    report.notes.push(
      `${report.guarded.length} overlapping state(s) were made mutually exclusive with a negation guard, so the engine cannot blend two poses of the same bones.`,
    );
  }
  for (const entry of report.guarded.slice(0, 6)) {
    log(`[ANIM:STATE] ${entry.entity}: "${entry.clipId}" now activates only while the higher-priority state is off — ${entry.condition}`);
  }
  if (report.blendedPairs > 0) {
    report.notes.push(`${report.blendedPairs} state pair(s) drive different limbs and are allowed to blend.`);
  }
  if (report.duplicateRegistrations.length > 0) {
    report.notes.push(`${report.duplicateRegistrations.length} duplicate clip registration(s) collapsed to a single activation.`);
  }
  if (report.controllersCreated.length > 0) {
    report.notes.push(
      `${report.controllersCreated.length} animation controller(s) were synthesised so ${report.controllerStates} clip(s) that could not be separated by a Molang guard stay selectable instead of being deactivated.`,
    );
  }
  if (report.controllerStaggered.length > 0) {
    report.notes.push(
      `${report.controllerStaggered.length} clip(s) share an identical source condition with another clip; they remain reachable by alternating on state-local time, which is reported as an approximation rather than as faithful state logic.`,
    );
  }

  report.summary =
    `Animation states: ${report.entitiesAnalysed} client entit(ies) with ${report.animateEntries} activation entr(ies) analysed; ` +
    `${report.duplicatesRemoved} duplicate definition(s) collapsed (${report.duplicateDefinitions.length} identifier(s)), ` +
    `${report.duplicateRegistrations.length} duplicate registration(s) removed, ${report.conflicts.length} state interaction(s) resolved ` +
    `(${report.guarded.length} guarded, ${report.blendedPairs} blended, ${report.controllersCreated.length} resolved by a synthesised controller over ${report.controllerStates} state(s), ${report.shadowed.length} shadowed), ` +
    `${report.exclusivePairs} pair(s) already mutually exclusive, ${report.equipmentDriven.length} state(s) bound to equipment or player actions.`;;
  log(`[ANIM:STATE] ${report.summary}`);
  return report;
}