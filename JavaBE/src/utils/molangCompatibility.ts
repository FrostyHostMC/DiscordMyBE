/**
 * Universal Molang compatibility analyzer.
 *
 * A Molang expression is only valid inside the execution context it runs in. `query.attack_time`
 * exists on an animated mob, so a mob clip that uses it plays; the same string inside
 * `entity/player.entity.json` is an unresolved query in a client entity that has no attack timer,
 * and Bedrock drops the expression. The def shipping the pack never notices — the pose is simply
 * `0` forever.
 *
 * Removing the query, or replacing it with a constant, "fixes" validation and destroys the
 * animation. This module instead answers, for every query in every shipped document:
 *
 *   1. what the expression means in the source;
 *   2. which destination context it will run in (player client entity, mob client entity, clip,
 *      or animation controller);
 *   3. whether that context supports it;
 *   4. an equivalent expression built only from queries the context DOES support, when one exists;
 *   5. a variable declaration plus an explicit UNSUPPORTED report when no equivalent exists.
 *
 * The result is a pack whose Molang is valid, whose activation semantics are preserved as far as
 * the destination allows, and whose remaining gaps are named instead of silently dropped.
 */

import { repairItemNameQueryArity, slotOccupancyExpression } from '@/utils/molangSlotQueries';

export type MolangContext = 'player_entity' | 'mob_entity' | 'animation' | 'controller';

export type MolangFidelity = 'exact' | 'approximate' | 'unsupported';

export interface MolangChange {
  file: string;
  from: string;
  to: string;
  fidelity: MolangFidelity;
  reason: string;
  /** Set when the change came from argument normalisation rather than query translation. */
  kind?: 'hand-slot';
}

export interface MolangCompatibilityReport {
  filesScanned: number;
  expressionsScanned: number;
  queriesScanned: number;
  rewritten: number;
  /** Queries that were rewritten in a way that preserves their meaning. */
  exact: MolangChange[];
  /** Queries replaced by a supported proxy the destination can actually evaluate. */
  approximations: MolangChange[];
  /** Queries that survived only as a variable a script must drive; reported, never hidden. */
  unsupported: MolangChange[];
  /** Queries with no destination equivalent at all: these block a clean compatibility status. */
  unresolved: Array<{ file: string; query: string; reason: string }>;
  /** Slot arguments normalised to a value the destination really accepts. */
  handSlotRepairs: MolangChange[];
  /** Equipped-item calls whose slot argument could not be expressed at all. */
  invalidHandSlots: Array<{ file: string; call: string; reason: string }>;
  summary: string;
}

/** Queries available in animation documents, animation controllers and client entities. */
export const ENTITY_QUERIES = new Set([
  'anim_time', 'life_time', 'modified_move_speed', 'modified_distance_moved', 'position_delta', 'is_moving', 'is_sneaking', 'is_sprinting',
  'is_swimming', 'is_on_ground', 'is_riding', 'is_using_item', 'is_delayed_attacking', 'is_alive',
  'is_first_person', 'is_in_water', 'is_jumping', 'hurt_time', 'health', 'is_item_name_any', 'equipped_item_any_tag', 'equipped_item_all_tags',
  'item_is_charged', 'item_in_use_duration', 'item_remaining_use_duration', 'ground_speed',
  'vertical_speed', 'position', 'rotation', 'time_of_day', 'cardinal_facing_2d',
  'body_y_rotation', 'body_x_rotation', 'head_x_rotation', 'head_y_rotation', 'variant',
  'mark_variant', 'is_baby', 'is_adult', 'is_sleeping', 'is_gliding', 'is_on_fire', 'is_tamed',
  'is_sitting', 'is_powered', 'is_charged', 'is_crawling', 'is_eating', 'is_chested',
  'armor_slot_count', 'knockback_resistance', 'scale', 'get_equipped_item_name',
  'get_equipped_item_slot', 'delta_time', 'frame_alpha', 'all_animations_finished',
  'any_animation_finished', 'is_delayed_attacking_bool', 'has_head_gear',
]);

/**
 * Queries that exist on a mob but not on the player. They are valid in mob documents and invalid
 * in the player client entity, which is exactly the reported "cannot resolve query" class.
 */
export const MOB_ONLY_QUERIES = new Set([
  'has_target', 'target_distance', 'is_angry', 'anger_level', 'target_x_rotation', 'target_y_rotation',
]);

/** Mob-entity-only additions that still resolve on a mob client entity. */
const MOB_CONTEXT_ONLY = new Set<string>();

/**
 * Queries a player client entity cannot evaluate. Everything here either has a supported proxy or
 * is reported as unsupported; nothing is deleted.
 */
const PLAYER_UNSUPPORTED = new Set<string>([
  'attack_time',
  // A player client entity declares no block state: `is_blocking` is evaluated on the entity that
  // owns the behaviour tree, so the query resolves to 0 forever inside the player definition.
  'is_blocking',
  ...MOB_ONLY_QUERIES,
]);

interface Substitution {
  expression: string;
  fidelity: MolangFidelity;
  reason: string;
}

/**
 * Supported rewrite for a query the destination context cannot evaluate. The proxy uses only
 * queries the player client entity really supports, so the activation condition keeps firing.
 */
const SUBSTITUTIONS: Record<string, Substitution> = {
  attack_time: {
    expression: '(query.is_delayed_attacking ? math.mod(query.life_time, 0.35) / 0.35 : 0.0)',
    fidelity: 'approximate',
    reason:
      'a player client entity exposes no attack timer; the swing progress is rebuilt from query.is_delayed_attacking (supported) and query.life_time so attack-gated poses still fire',
  },
  is_blocking: {
    expression: "(query.is_using_item && (query.get_equipped_item_name == 'shield'))",
    fidelity: 'approximate',
    reason:
      'a player client entity exposes no block query; shield usage is rebuilt from query.is_using_item and query.get_equipped_item_name, both supported in this context, so the shield pose still fires instead of evaluating to 0',
  },
  has_target: {
    expression: 'variable.has_target',
    fidelity: 'unsupported',
    reason:
      'the player has no target query; the value is declared as a variable so the expression evaluates instead of failing, and only a behaviour script can drive it',
  },
  target_distance: {
    expression: 'variable.target_distance',
    fidelity: 'unsupported',
    reason: 'the player has no target query; the value is declared as a variable driven by script',
  },
  target_x_rotation: {
    expression: 'variable.target_x_rotation',
    fidelity: 'unsupported',
    reason: 'the player has no target query; the value is declared as a variable driven by script',
  },
  target_y_rotation: {
    expression: 'variable.target_y_rotation',
    fidelity: 'unsupported',
    reason: 'the player has no target query; the value is declared as a variable driven by script',
  },
  anger_level: {
    expression: 'variable.anger_level',
    fidelity: 'unsupported',
    reason: 'the player has no anger query; the value is declared as a variable driven by script',
  },
  is_angry: {
    expression: '(variable.anger_level > 0)',
    fidelity: 'unsupported',
    reason: 'the player has no anger query; the condition is expressed against a scripted variable',
  },
};

/** Queries that a context can evaluate, with no translation at all. */
export function isQuerySupported(query: string, context: MolangContext): boolean {
  const name = query.toLowerCase();
  if (context === 'player_entity') {
    if (PLAYER_UNSUPPORTED.has(name)) return false;
    return ENTITY_QUERIES.has(name) || MOB_CONTEXT_ONLY.has(name);
  }
  return ENTITY_QUERIES.has(name) || MOB_ONLY_QUERIES.has(name) || name === 'attack_time';
}

/** True when the analyzer knows what to do with a query the context rejects. */
export function substitutionFor(query: string, context: MolangContext): Substitution | null {
  if (isQuerySupported(query, context)) return null;
  return SUBSTITUTIONS[query.toLowerCase()] ?? null;
}

export interface ExpressionTranslation {
  expression: string;
  changes: Array<{ from: string; to: string; fidelity: MolangFidelity; reason: string; kind?: 'hand-slot' }>;
  unresolved: Array<{ query: string; reason: string }>;
  /** Equipped-item calls whose slot argument has no valid destination form. */
  rejected: Array<{ call: string; reason: string }>;
}

/** Hand slots the destination accepts for `query.get_equipped_item_name`. */
export const SUPPORTED_HAND_SLOTS: readonly string[] = ['main_hand', 'off_hand'];

/**
 * Every spelling a source archive uses for a hand slot. Java-side equipment checks write
 * `mainHand`, `OFF_HAND`, `1`, `slot.weapon.offhand`; the destination accepts exactly two values, so
 * each alias has to be resolved instead of being emitted verbatim.
 */
const HAND_SLOT_ALIASES: Record<string, string> = {
  '0': 'main_hand',
  main_hand: 'main_hand',
  mainhand: 'main_hand',
  main: 'main_hand',
  hand: 'main_hand',
  right: 'main_hand',
  right_hand: 'main_hand',
  righthand: 'main_hand',
  'slot.weapon.mainhand': 'main_hand',
  'weapon.mainhand': 'main_hand',
  'slot.weapon.main_hand': 'main_hand',
  '1': 'off_hand',
  off_hand: 'off_hand',
  offhand: 'off_hand',
  off: 'off_hand',
  left: 'off_hand',
  left_hand: 'off_hand',
  lefthand: 'off_hand',
  'slot.weapon.offhand': 'off_hand',
  'weapon.offhand': 'off_hand',
  'slot.weapon.off_hand': 'off_hand',
};

/** Slot ids the destination documents outside the hand slots. */
const DOCUMENTED_SLOT_IDS = new Set([
  'slot.weapon.mainhand',
  'slot.weapon.offhand',
  'slot.armor.head',
  'slot.armor.chest',
  'slot.armor.legs',
  'slot.armor.feet',
]);

/** Bare armour words map onto the documented armour slot ids. */
const ARMOR_WORD_SLOTS: Record<string, string> = {
  head: 'slot.armor.head',
  helmet: 'slot.armor.head',
  hat: 'slot.armor.head',
  chest: 'slot.armor.chest',
  chestplate: 'slot.armor.chest',
  body: 'slot.armor.chest',
  torso: 'slot.armor.chest',
  legs: 'slot.armor.legs',
  leg: 'slot.armor.legs',
  leggings: 'slot.armor.legs',
  pants: 'slot.armor.legs',
  feet: 'slot.armor.feet',
  foot: 'slot.armor.feet',
  boots: 'slot.armor.feet',
};

function cleanSlotArgument(raw: string): string {
  return raw.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim().toLowerCase().replace(/\s+/g, '_');
}

function canonicalSlotId(raw: string): string | null {
  const key = cleanSlotArgument(raw);
  // is_item_name_any uses inventory slot identifiers, including mainhand/offhand. The separate
  // get_equipped_item_name normaliser uses canonicalHandSlot() and must not reject these here.
  if (DOCUMENTED_SLOT_IDS.has(key)) return key;
  if (key in HAND_SLOT_ALIASES) return null;
  if (key in ARMOR_WORD_SLOTS) return ARMOR_WORD_SLOTS[key];
  if (/^slot\.[a-z0-9_.]+$/.test(key)) return key;
  return null;
}

/** Canonical hand slot for any spelling, or null when the argument is not a hand at all. */
export function canonicalHandSlot(raw: string): string | null {
  const key = cleanSlotArgument(raw);
  return key in HAND_SLOT_ALIASES ? HAND_SLOT_ALIASES[key] : null;
}

const QUERY_TEST = /query\.[a-z0-9_]+/i;
const QUERY_TOKEN = /query\.([a-z0-9_]+)/gi;

/**
 * Rewrites every query the context cannot evaluate, and reports every query it could not rewrite.
 * Identical input produces identical output; the function never mutates its argument.
 */
/**
 * Slot-argument normalisation for equipped-item queries.
 *
 * `query.get_equipped_item_name` accepts `0`/`main_hand` and `1`/`off_hand`. A converted expression
 * that passes a Java slot name, a digit outside that range, a non-literal argument or an armour
 * slot is rejected by the engine at evaluation time, so the animation it gates simply stops. Each
 * case is handled here:
 *
 *  - hand aliases are rewritten to the documented value, which preserves main-hand vs off-hand;
 *  - an omitted argument stays the main hand, which is what the destination defines it as;
 *  - an armour/other slot inside a presence or name comparison becomes `query.is_item_name_any`,
 *    the same slot contract with the same boolean meaning;
 *  - anything that cannot be expressed is reported, never replaced with a constant.
 */
export function normalizeEquippedItemQueries(expression: string): {
  expression: string;
  changes: ExpressionTranslation['changes'];
  rejected: ExpressionTranslation['rejected'];
} {
  const changes: ExpressionTranslation['changes'] = [];
  const rejected: ExpressionTranslation['rejected'] = [];
  if (!expression || typeof expression !== 'string') return { expression, changes, rejected };
  let out = expression;

  // 0. Argument-count contract. `query.is_item_name_any` needs the slot AND at least one item
  // name, so a converted "is this slot occupied" test is rewritten into a signature the engine
  // accepts instead of shipping a call that throws on every evaluation.
  const arity = repairItemNameQueryArity(out);
  out = arity.expression;
  for (const repair of arity.repairs) {
    changes.push({
      from: repair.from,
      to: repair.to,
      fidelity: 'approximate',
      reason: repair.reason,
      kind: 'hand-slot',
    });
  }
  rejected.push(...arity.rejected);

  // 1. An omitted argument is the main hand, so it is written explicitly.
  out = out.replace(/query\.get_equipped_item_name\b(?!\s*\()/gi, () => {
    changes.push({
      from: 'query.get_equipped_item_name',
      to: "query.get_equipped_item_name('main_hand')",
      fidelity: 'exact',
      reason: 'the optional slot parameter was omitted, which the destination defines as the main hand',
      kind: 'hand-slot',
    });
    return "query.get_equipped_item_name('main_hand')";
  });

  // 2. Non-hand slots stay meaningful when the call is used as a presence or name test.
  out = out.replace(
    /query\.get_equipped_item_name\s*\(\s*([^()]*?)\s*\)\s*(!=|==)\s*('[^']*'|"[^"]*")/gi,
    (match, rawArgument: string, operator: string, literal: string) => {
      if (canonicalHandSlot(rawArgument)) return match;
      const slot = canonicalSlotId(rawArgument);
      if (!slot) return match;
      const name = cleanSlotArgument(literal);
      // An empty name is a PRESENCE test: it is expressed with the slot-occupancy form, because
      // `query.is_item_name_any` without an item name is rejected by the engine outright.
      const occupancy = name === '' ? slotOccupancyExpression(slot) : null;
      if (name === '' && !occupancy) {
        rejected.push({
          call: match,
          reason: `slot “${slot}” has no supported generic occupancy query; the source expression is preserved rather than emitting an invalid hand-only query`,
        });
        return match;
      }
      const call = name === ''
        ? (occupancy as { expression: string }).expression
        : `query.is_item_name_any('${slot}', 0, '${name}')`;
      // The comparison itself decides the polarity: `name != ''` means the slot is OCCUPIED, while
      // `name == ''` means it is empty. With a concrete item name the mapping is the other way round.
      // Getting this backwards inverted every converted armour-visibility flag.
      const negate = (operator === '==') === (name === '');
      const replacement = negate ? `!${call}` : call;
      changes.push({
        from: match,
        to: replacement,
        fidelity: 'exact',
        reason:
          `this query only accepts the hand slots; the same ${name === '' ? 'presence' : 'item-name'} test is expressed with ` +
          `query.is_item_name_any and the documented slot id \u201c${slot}\u201d, which preserves the boolean meaning`,
        kind: 'hand-slot',
      });
      return replacement;
    },
  );

  // 3. Hand slots are normalised to the two documented values.
  out = out.replace(/query\.get_equipped_item_name\s*\(\s*([^()]*?)\s*\)/gi, (match, rawArgument: string) => {
    const hand = canonicalHandSlot(rawArgument);
    if (!hand) return match;
    const replacement = `query.get_equipped_item_name('${hand}')`;
    if (replacement !== match) {
      changes.push({
        from: match,
        to: replacement,
        fidelity: 'exact',
        reason: `hand slot argument \u201c${rawArgument.trim()}\u201d normalised to the documented value \u201c${hand}\u201d`,
        kind: 'hand-slot',
      });
    }
    return replacement;
  });

  // 4. Slot ids used by item-name queries are validated the same way.
  for (const match of out.matchAll(/query\.is_item_name_any\s*\(\s*([^,)]*)/gi)) {
    const rawArgument = String(match[1]).trim();
    if (!rawArgument) continue;
    if (canonicalSlotId(rawArgument)) continue;
    rejected.push({
      call: match[0],
      reason: `\u201c${rawArgument}\u201d is not a documented slot id for query.is_item_name_any, so the item test cannot be validated`,
    });
  }

  // 5. Whatever is left cannot be expressed in this context. The slot-occupancy form this module
  // emits itself — `get_equipped_item_name('<documented slot>', 0)` — is accepted here, so a repaired
  // expression is never rejected again by the next pass that scans it.
  for (const match of out.matchAll(/query\.get_equipped_item_name\s*\(([^)]*)\)?/gi)) {
    const parts = String(match[1]).split(',');
    const rawArgument = String(parts[0] ?? '');
    if (canonicalHandSlot(rawArgument)) continue;
    const slot = canonicalSlotId(rawArgument);
    if (slot && parts.slice(1).every((entry) => /^\s*\d+\s*$/.test(entry))) continue;
    rejected.push({
      call: match[0].trim(),
      reason: slot
        ? `slot \u201c${slot}\u201d cannot be read by this query, which only accepts main_hand and off_hand, and the expression around it is not a presence or name comparison that could be translated`
        : `\u201c${rawArgument.trim() || '(empty)'}\u201d is not a valid destination slot argument and the intended hand cannot be inferred`,
    });
  }

  return { expression: out, changes, rejected };
}

/**
 * Rewrites every query the context cannot evaluate, and reports every query it could not rewrite.
 * Identical input produces identical output; the function never mutates its argument.
 */
export function translateMolangExpression(expression: string, context: MolangContext): ExpressionTranslation {
  const changes: ExpressionTranslation['changes'] = [];
  const unresolved: ExpressionTranslation['unresolved'] = [];
  const rejected: ExpressionTranslation['rejected'] = [];
  if (!expression || typeof expression !== 'string') return { expression, changes, unresolved, rejected };

  const slotNormalisation = normalizeEquippedItemQueries(expression);
  changes.push(...slotNormalisation.changes);
  rejected.push(...slotNormalisation.rejected);

  const rewritten = slotNormalisation.expression.replace(QUERY_TOKEN, (match, rawName: string) => {
    const name = rawName.toLowerCase();
    if (isQuerySupported(name, context)) return match;
    const substitution = SUBSTITUTIONS[name];
    if (substitution) {
      changes.push({ from: match, to: substitution.expression, fidelity: substitution.fidelity, reason: substitution.reason });
      return substitution.expression;
    }
    unresolved.push({
      query: match,
      reason: `"${match}" is not supported in the ${context.replace('_', ' ')} context and no supported equivalent is known, so the expression cannot be preserved faithfully`,
    });
    return match;
  });

  return { expression: rewritten, changes, unresolved, rejected };
}

/** Execution context a shipped document's expressions run in. */
export function molangContextForFile(path: string, doc: Record<string, unknown> | null): MolangContext | null {
  const lower = path.toLowerCase();
  if (/animation_controllers\.json$/.test(lower)) return 'controller';
  if (/\.animation\.json$/.test(lower)) return 'animation';
  if (!/^entity\/[^/]+\.entity\.json$/.test(lower)) return null;
  const description = (doc?.['minecraft:client_entity'] as Record<string, unknown> | undefined)?.description as
    | Record<string, unknown>
    | undefined;
  return description?.identifier === 'minecraft:player' ? 'player_entity' : 'mob_entity';
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Walks one document, handing every string that contains a query to `visit`. The walker returns
 * the original node when nothing changed, so an untouched document is never rewritten.
 */
function walkStrings(
  node: unknown,
  visit: (value: string) => string,
): unknown {
  if (typeof node === 'string') return QUERY_TEST.test(node) ? visit(node) : node;
  if (Array.isArray(node)) return node.map((entry) => walkStrings(entry, visit));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const next = walkStrings(value, visit);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return changed ? out : node;
  }
  return node;
}

/** Counts the query references in a string (used for the scope statement, not for repairs). */
function queriesIn(value: string): string[] {
  return (value.match(QUERY_TOKEN) ?? []).map((token) => token.toLowerCase());
}

export function auditMolangCompatibility(input: {
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles?: Record<string, string | Uint8Array>;
  /** When true, supported rewrites are written back into the file map; unresolved ones never are. */
  repair?: boolean;
  onLog?: (line: string) => void;
}): MolangCompatibilityReport {
  const log = (line: string) => input.onLog?.(line);
  const report: MolangCompatibilityReport = {
    filesScanned: 0,
    expressionsScanned: 0,
    queriesScanned: 0,
    rewritten: 0,
    exact: [],
    approximations: [],
    unsupported: [],
    unresolved: [],
    handSlotRepairs: [],
    invalidHandSlots: [],
    summary: '',
  };
  const packs = [input.resourcePackFiles, input.behaviorPackFiles ?? {}];

  for (const pack of packs) {
    for (const path of Object.keys(pack)) {
      if (!path.toLowerCase().endsWith('.json')) continue;
      const doc = parseJson(pack[path]);
      if (!doc) continue;
      const context = molangContextForFile(path, doc);
      if (!context) continue;
      report.filesScanned += 1;
      const next = walkStrings(doc, (value) => {
        report.expressionsScanned += 1;
        const found = queriesIn(value);
        if (found.length === 0) return value;
        report.queriesScanned += found.length;
        const translation = translateMolangExpression(value, context);
        for (const change of translation.changes) {
          const entry: MolangChange = { file: path, ...change };
          if (change.kind === 'hand-slot') report.handSlotRepairs.push(entry);
          if (change.fidelity === 'exact') report.exact.push(entry);
          else if (change.fidelity === 'approximate') report.approximations.push(entry);
          else report.unsupported.push(entry);
        }
        for (const entry of translation.unresolved) {
          report.unresolved.push({ file: path, query: entry.query, reason: entry.reason });
        }
        for (const entry of translation.rejected) {
          report.invalidHandSlots.push({ file: path, call: entry.call, reason: entry.reason });
        }
        if (translation.expression !== value) report.rewritten += 1;
        return translation.expression;
      });
      if (input.repair && next !== doc) pack[path] = JSON.stringify(next, null, 2);
    }
  }

  report.summary =
    `${report.filesScanned} document(s) with Molang checked, ${report.queriesScanned} query reference(s) in ${report.expressionsScanned} expression(s): ` +
    `${report.rewritten} expression(s) rewritten — ${report.exact.length} exact, ${report.approximations.length} supported proxy, ` +
    `${report.unsupported.length} variable-backed (needs a script), ${report.unresolved.length} with no destination equivalent; ` +
    `${report.handSlotRepairs.length} equipped-item slot argument(s) normalised, ${report.invalidHandSlots.length} rejected as unexpressible.`;
  log(`[ANIM:MOLANG] ${report.summary}`);
  for (const entry of report.approximations.slice(0, 6)) {
    log(`[ANIM:MOLANG:PROXY] ${entry.file}: ${entry.from} → ${entry.to} — ${entry.reason}.`);
  }
  for (const entry of report.unsupported.slice(0, 6)) {
    log(`[ANIM:MOLANG:UNSUPPORTED] ${entry.file}: ${entry.from} → ${entry.to} — ${entry.reason}.`);
  }
  for (const entry of report.unresolved.slice(0, 6)) {
    log(`[ANIM:MOLANG:UNRESOLVED] ${entry.file}: ${entry.query} — ${entry.reason}.`);
  }
  for (const entry of report.handSlotRepairs.slice(0, 6)) {
    log(`[ANIM:MOLANG:SLOT] ${entry.file}: ${entry.from} → ${entry.to} — ${entry.reason}.`);
  }
  for (const entry of report.invalidHandSlots.slice(0, 6)) {
    log(`[ANIM:MOLANG:SLOT:REJECT] ${entry.file}: ${entry.call} — ${entry.reason}.`);
  }
  return report;
}

/** Convenience wrapper: repairs the shipped maps and reports what changed. */
export function applyMolangCompatibilityRepairs(input: {
  resourcePackFiles: Record<string, string | Uint8Array>;
  behaviorPackFiles?: Record<string, string | Uint8Array>;
  onLog?: (line: string) => void;
}): MolangCompatibilityReport {
  return auditMolangCompatibility({ ...input, repair: true });
}