/**
 * Destination slot-argument contract for the equipped-item queries.
 *
 * `query.is_item_name_any` addresses a slot AND at least one item name:
 * `query.is_item_name_any('slot.weapon.mainhand', 0, 'mod:rune_spear')`. A converted "is there
 * anything in this hand / armour slot" test naturally collapses into
 * `query.is_item_name_any('slot.weapon.offhand')`, which the engine rejects at evaluation time
 * ("requires at least two parameters"), so every animation reading that value stops evaluating.
 *
 * `query.get_equipped_item_name(slot, index)` answers the same occupancy question with a signature
 * the engine accepts, so presence tests are written with it. An item-name test keeps its names and
 * is left untouched.
 */

export interface SlotQueryRepair {
  from: string;
  to: string;
  reason: string;
}

const HAND_SLOT_IDS: Record<string, string> = {
  '0': 'slot.weapon.mainhand',
  main_hand: 'slot.weapon.mainhand',
  mainhand: 'slot.weapon.mainhand',
  'slot.weapon.mainhand': 'slot.weapon.mainhand',
  '1': 'slot.weapon.offhand',
  off_hand: 'slot.weapon.offhand',
  offhand: 'slot.weapon.offhand',
  'slot.weapon.offhand': 'slot.weapon.offhand',
};

/** Documented slot id for any hand/armour spelling a source archive uses. */
export function documentedSlotId(raw: string): string {
  const key = raw.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim().toLowerCase().replace(/\s+/g, '_');
  return HAND_SLOT_IDS[key] ?? key;
}

/** "Is this slot occupied?", expressed in a signature the destination accepts. */
export function slotOccupancyExpression(slot: string): { expression: string; reason: string } {
  const id = documentedSlotId(slot);
  return {
    expression: `(query.get_equipped_item_name('${id}', 0) != '')`,
    reason:
      `the presence form of query.is_item_name_any needs at least one item name, so "the ${id} slot is occupied" ` +
      'is evaluated with query.get_equipped_item_name(slot, index), which accepts the same documented slot and returns the same boolean',
  };
}

/** Splits a call's argument list, ignoring commas inside quotes. */
function splitArguments(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote = '';
  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

/** Index of the `)` closing the `(` at `open`, or -1 when the call is unterminated. */
function closingParen(expression: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Item names an `is_item_name_any` call really tests: everything quoted after the slot argument. */
function itemNameArguments(args: string[]): string[] {
  return args.slice(1).filter((arg) => /^['"]/.test(arg));
}

/**
 * Rewrites every `query.is_item_name_any` call that carries no item name into the occupancy form.
 * Calls that test concrete names are left untouched, so an evidence-backed item test keeps working.
 */
export function repairItemNameQueryArity(expression: string): {
  expression: string;
  repairs: SlotQueryRepair[];
  rejected: Array<{ call: string; reason: string }>;
} {
  const repairs: SlotQueryRepair[] = [];
  const rejected: Array<{ call: string; reason: string }> = [];
  if (!expression || typeof expression !== 'string') return { expression, repairs, rejected };
  const pattern = /query\.is_item_name_any\s*\(/gi;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(expression);
  while (match !== null) {
    const open = match.index + match[0].length - 1;
    const close = closingParen(expression, open);
    if (close < 0) break;
    const call = expression.slice(match.index, close + 1);
    const args = splitArguments(expression.slice(open + 1, close));
    const needsRepair = args.length > 0 && itemNameArguments(args).length === 0;
    if (needsRepair) {
      const occupancy = slotOccupancyExpression(args[0]);
      out += expression.slice(cursor, match.index) + occupancy.expression;
      cursor = close + 1;
      repairs.push({ from: call, to: occupancy.expression, reason: occupancy.reason });
    }
    pattern.lastIndex = close + 1;
    match = pattern.exec(expression);
  }
  if (repairs.length === 0) return { expression, repairs, rejected };
  out += expression.slice(cursor);
  return { expression: out, repairs, rejected };
}