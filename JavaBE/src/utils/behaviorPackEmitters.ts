/**
 * Bedrock behaviour emitters.
 *
 * Converts evidence-backed Java data into real Bedrock structures (loot tables, villager
 * trade tables) and writes evidence-derived components onto an entity definition. Every
 * emitter is idempotent: an existing Bedrock component is never overwritten, so the
 * bounded self-healing loop can re-run this stage safely.
 */

type PackFiles = Record<string, string | Uint8Array>;

interface JavaLootEntry {
  type?: string;
  name?: string;
  weight?: number;
  functions?: Array<Record<string, unknown>>;
}

interface JavaLootPool {
  rolls?: number | { min?: number; max?: number };
  entries?: JavaLootEntry[];
}

/** Bedrock loot functions with a 1:1 Java counterpart. */
const MAPPED_LOOT_FUNCTIONS = new Set(['set_count', 'looting_enchant']);

export interface LootTranslation {
  json: string;
  droppedFunctions: string[];
}

function translateLootEntry(entry: JavaLootEntry, dropped: string[]): Record<string, unknown> | null {
  const type = String(entry.type ?? 'minecraft:item').replace(/^minecraft:/, '');
  if (type === 'empty') return { type: 'empty', weight: entry.weight ?? 1 };
  // Nested loot tables, groups and alternatives have no safe 1:1 mapping — the whole
  // table is reported UNRESOLVED instead of shipping a partial drop list.
  if (type !== 'item' || !entry.name) return null;
  const functions: Array<Record<string, unknown>> = [];
  for (const fn of entry.functions ?? []) {
    const id = String(fn.function ?? '').replace(/^minecraft:/, '');
    if (!MAPPED_LOOT_FUNCTIONS.has(id)) {
      dropped.push(id || 'unknown');
      continue;
    }
    functions.push({ ...fn, function: id });
  }
  return {
    type: 'item',
    name: entry.name,
    weight: entry.weight ?? 1,
    ...(functions.length > 0 ? { functions } : {}),
  };
}

export function translateLootTable(raw: string): LootTranslation | null {
  let parsed: { pools?: JavaLootPool[] };
  try {
    parsed = JSON.parse(raw) as { pools?: JavaLootPool[] };
  } catch {
    return null;
  }
  const pools = parsed.pools;
  if (!Array.isArray(pools) || pools.length === 0) return null;
  const dropped: string[] = [];
  const outPools: Array<Record<string, unknown>> = [];
  for (const pool of pools) {
    const entries: Array<Record<string, unknown>> = [];
    for (const entry of pool.entries ?? []) {
      const mapped = translateLootEntry(entry, dropped);
      if (!mapped) return null;
      entries.push(mapped);
    }
    if (entries.length === 0) continue;
    outPools.push({ rolls: pool.rolls ?? 1, entries });
  }
  if (outPools.length === 0) return null;
  return {
    json: JSON.stringify({ pools: outPools }, null, 2),
    droppedFunctions: Array.from(new Set(dropped)),
  };
}

interface TradeStack {
  item?: string;
  id?: string;
  quantity?: number;
  count?: number;
}

interface JavaTrade {
  wants?: TradeStack[];
  gives?: TradeStack[];
  max_uses?: number;
}

function normaliseStacks(stacks: TradeStack[] | undefined): Array<{ item: string; quantity: number }> {
  const out: Array<{ item: string; quantity: number }> = [];
  for (const stack of stacks ?? []) {
    const item = stack.item ?? stack.id;
    if (!item) continue;
    const quantity = Math.max(1, Math.round(stack.quantity ?? stack.count ?? 1));
    out.push({ item, quantity });
  }
  return out;
}

/** Java-style trade document -> Bedrock economy trade table. Returns null when unusable. */
export function translateTradeTable(raw: string): string | null {
  let parsed: { tiers?: unknown; trades?: JavaTrade[] };
  try {
    parsed = JSON.parse(raw) as { tiers?: unknown; trades?: JavaTrade[] };
  } catch {
    return null;
  }
  // Already a Bedrock table: never rewritten.
  if (parsed.tiers) return null;
  if (!Array.isArray(parsed.trades) || parsed.trades.length === 0) return null;
  const trades = parsed.trades
    .map((trade) => ({
      wants: normaliseStacks(trade.wants),
      gives: normaliseStacks(trade.gives),
      ...(trade.max_uses ? { max_uses: Math.max(1, Math.round(trade.max_uses)) } : {}),
    }))
    .filter((trade) => trade.wants.length > 0 && trade.gives.length > 0);
  if (trades.length === 0) return null;
  return JSON.stringify({ tiers: [{ groups: [{ num_to_select: trades.length, trades }] }] }, null, 2);
}

interface EntityDoc {
  'minecraft:entity'?: {
    components?: Record<string, unknown>;
    events?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

function readEntityDoc(pack: PackFiles, path: string): EntityDoc | null {
  const raw = pack[path];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as EntityDoc;
  } catch {
    return null;
  }
}

function writeEntityDoc(pack: PackFiles, path: string, doc: EntityDoc): void {
  pack[path] = JSON.stringify(doc, null, 2);
}

/** Evidence-derived periodic timer (`minecraft:timer` is a real Bedrock entity component). */
export function ensureEntityTimer(pack: PackFiles, path: string, seconds: number, eventName: string): boolean {
  const doc = readEntityDoc(pack, path);
  const entity = doc?.['minecraft:entity'];
  if (!entity) return false;
  const components = (entity.components = entity.components ?? {});
  if (components['minecraft:timer']) return false;
  components['minecraft:timer'] = {
    time: seconds,
    looping: true,
    time_down_event: { event: eventName, target: 'self' },
  };
  const events = (entity.events = entity.events ?? {});
  if (!events[eventName]) events[eventName] = { sequence: [] };
  writeEntityDoc(pack, path, doc);
  return true;
}

/** Container logic detected in the mob's own class -> inventory-bearing entity. */
export function ensureEntityInventory(pack: PackFiles, path: string, size = 27): boolean {
  const doc = readEntityDoc(pack, path);
  const entity = doc?.['minecraft:entity'];
  if (!entity) return false;
  const components = (entity.components = entity.components ?? {});
  if (components['minecraft:inventory']) return false;
  components['minecraft:inventory'] = {
    container_type: 'inventory',
    inventory_size: size,
    private: true,
    can_be_siphoned_from: false,
  };
  writeEntityDoc(pack, path, doc);
  return true;
}

/** Binds an emitted loot table to the entity that drops it (Bedrock never auto-detects). */
export function ensureEntityLoot(pack: PackFiles, path: string, tablePath: string): boolean {
  const doc = readEntityDoc(pack, path);
  const entity = doc?.['minecraft:entity'];
  if (!entity) return false;
  const components = (entity.components = entity.components ?? {});
  if (components['minecraft:loot']) return false;
  components['minecraft:loot'] = { table: tablePath };
  writeEntityDoc(pack, path, doc);
  return true;
}

/** Binds a converted trade table to a mob that has trading evidence. */
export function ensureTradeComponent(pack: PackFiles, path: string, displayName: string, tablePath: string): boolean {
  const doc = readEntityDoc(pack, path);
  const entity = doc?.['minecraft:entity'];
  if (!entity) return false;
  const components = (entity.components = entity.components ?? {});
  if (components['minecraft:trade_table']) return false;
  components['minecraft:trade_table'] = {
    display_name: displayName,
    table: tablePath,
    new_screen_layout: false,
  };
  writeEntityDoc(pack, path, doc);
  return true;
}