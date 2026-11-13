/**
 * Evidence-driven reconstruction of Molang variables a source animation reads but never declares.
 *
 * A converted expression such as `variable.melee_spear_equipped` only means something if the pack
 * can evaluate it. Initializing it to `false` would satisfy the engine and destroy the behaviour,
 * so the only two honest outcomes are:
 *
 *   1. rebuild the value from a Bedrock-native query whose meaning is the same, using evidence
 *      that the referenced item really exists in the archive (equipment detection), or
 *   2. report the exact limitation and leave the variable undeclared.
 *
 * This module implements (1). The item identifiers come from the pack the conversion produced, so
 * nothing is hardcoded and nothing is invented for a specific mod.
 */

export type PackFiles = Record<string, string | Uint8Array>;

/** Tokens in a variable name that mean "the entity is holding/using this thing". */
const EQUIPMENT_TOKENS = new Set([
  'equipped',
  'equip',
  'holding',
  'held',
  'wielding',
  'wielded',
  'carrying',
  'inhand',
  'in_hand',
  'mainhand',
  'offhand',
]);

/** Words that carry no item identity and are dropped before matching. */
const FILLER_TOKENS = new Set(['is', 'has', 'the', 'a', 'an', 'var', 'variable', 'bool', 'flag', 'state', 'melee']);

function splitTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Reads every Bedrock item identifier the exported pack registers. Only items that really ship are
 * returned, so a reconstruction can never reference a phantom item.
 */
export function collectPackItemIdentifiers(files: PackFiles): string[] {
  const ids = new Set<string>();
  for (const [path, raw] of Object.entries(files)) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.json')) continue;
    if (typeof raw !== 'string') continue;
    if (!lower.startsWith('items/')) continue;
    try {
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const description = (doc['minecraft:item'] as Record<string, unknown> | undefined)?.description as
        | Record<string, unknown>
        | undefined;
      const identifier = description?.identifier;
      if (typeof identifier === 'string' && identifier.includes(':')) ids.add(identifier);
    } catch {
      // An unreadable item document contributes no identifier; validation reports it separately.
    }
  }
  return [...ids].sort();
}

/**
 * Rebuilds an equipped-item flag from the pack's own item registry.
 *
 * The semantics are the ones the source expression encodes: the flag is true while the entity
 * holds that item in either hand, so main-hand and off-hand are both tested and both are expressed
 * with the documented hand slots.
 */
export function reconstructEquipmentExpression(
  variableName: string,
  itemIds: string[],
): { expression: string; matchedItemIds: string[]; reason: string } | null {
  const tokens = splitTokens(variableName);
  if (tokens.length === 0) return null;
  if (!tokens.some((token) => EQUIPMENT_TOKENS.has(token))) return null;

  const identity = tokens.filter((token) => !EQUIPMENT_TOKENS.has(token) && !FILLER_TOKENS.has(token));
  if (identity.length === 0) return null;

  const matched = itemIds
    .filter((id) => {
      const itemTokens = splitTokens(id.split(':').pop() ?? id);
      return identity.every((token) => itemTokens.includes(token));
    })
    .slice(0, 4);
  if (matched.length === 0) return null;

  const list = matched.map((id) => `'${id}'`).join(', ');
  const expression =
    `(query.is_item_name_any('slot.weapon.mainhand', ${list})` +
    ` || query.is_item_name_any('slot.weapon.offhand', ${list}))`;
  return {
    expression,
    matchedItemIds: matched,
    reason:
      `the source flag tests a held item; it is rebuilt from the shipped item identifier(s) ${matched.join(', ')} ` +
      'and evaluated in both hand slots so main-hand and off-hand usage stay equivalent',
  };
}