import type {
  DecompileClassSummary,
  ItemCapability,
  ItemClassification,
  ItemEvidenceRecord,
  ItemEvidenceSource,
  ItemSemanticRole,
  RemakeItem,
} from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { detectCooldownTicks } from '@/utils/behaviorSignalDetectors';

/**
 * Universal, evidence-based item semantics.
 *
 * Item roles used to be decided by keyword matching on the display name, which produced a
 * single "weapon" template for any unfamiliar item. A role is now recovered only from what
 * the imported mod actually declares, strongest evidence first:
 *
 *   1. registry   — the mod registers this id as the spawn egg of a registered entity;
 *   2. inheritance — the superclass of the item's own class (SwordItem, ArmorItem, ...);
 *   3. bytecode   — interfaces/methods/calls the item's own class invokes;
 *   4. data       — the item tags the mod's own JSON assigns;
 *   5. assets     — a blockstate/model/block texture proves a block item;
 *   6. display name — never decides a role; it is recorded as a rejected hint.
 *
 * Anything below the decision threshold keeps its identity as a generic item and is reported
 * as UNCERTAIN. No damage, durability or nutrition number is ever produced here.
 */

export type ItemSemanticShape = 'block' | 'bag' | 'tool' | 'flat';

export interface ItemSemanticContext {
  classify(input: { id: string; name: string }): ItemClassification;
}

interface RoleRule {
  role: ItemSemanticRole;
  label: string;
  shape: ItemSemanticShape;
  pattern: RegExp;
  slot?: RemakeItem['slot'];
  capabilities: ItemCapability[];
}

interface Candidate {
  role: ItemSemanticRole;
  label: string;
  shape: ItemSemanticShape;
  slot?: RemakeItem['slot'];
  capabilities: ItemCapability[];
  source: ItemEvidenceSource;
  weight: number;
  detail: string;
}

/** Minimum confidence a record needs before it may decide a role. */
const DECISION_THRESHOLD = 0.5;
const WEIGHT_REGISTRY = 0.95;
const WEIGHT_LINEAGE = 0.9;
const WEIGHT_CODE = 0.8;
const WEIGHT_DATA = 0.7;
const WEIGHT_ASSET = 0.6;
const WEIGHT_EXISTENCE = 0.35;
const WEIGHT_NAME = 0.2;

/** What the item's own superclass is. The strongest non-registry evidence available. */
export const ITEM_LINEAGE_RULES: RoleRule[] = [
  { role: 'spawn-egg', label: 'Spawn egg (SpawnEggItem subclass)', shape: 'flat', pattern: /spawneggitem|spawneggbuilder|spawneggtype/, capabilities: ['summon-entity'] },
  { role: 'food', label: 'Consumable (food item class)', shape: 'flat', pattern: /itemfood|fooditem|edibleitem/, capabilities: ['consume'] },
  { role: 'armor', label: 'Wearable (ArmorItem subclass)', shape: 'block', pattern: /armoritem|itemarmor/, capabilities: ['wearable'] },
  { role: 'equipment', label: 'Hand equipment (ShieldItem subclass)', shape: 'tool', pattern: /shielditem/, slot: 'offhand', capabilities: ['use-hook'] },
  { role: 'fluid', label: 'Fluid vessel (BucketItem subclass)', shape: 'flat', pattern: /bucketitem/, capabilities: ['fluid-container'] },
  { role: 'ammunition', label: 'Ammunition (ArrowItem subclass)', shape: 'flat', pattern: /arrowitem/, capabilities: [] },
  { role: 'projectile-launcher', label: 'Projectile launcher (bow or throwable item class)', shape: 'tool', pattern: /bowitem|crossbowitem|throwableprojectileitem|projectileitem|snowballitem|eggitem|enderpearlitem/, capabilities: ['projectile-launch'] },
  { role: 'weapon', label: 'Weapon (SwordItem subclass)', shape: 'tool', pattern: /sworditem/, capabilities: ['melee-strike'] },
  { role: 'tool', label: 'Harvest tool (DiggerItem subclass)', shape: 'tool', pattern: /diggeritem|pickaxeitem|axeitem|shovelitem|hoeitem|shearsitem/, capabilities: ['harvest'] },
  { role: 'vehicle', label: 'Vehicle item (boat or minecart class)', shape: 'flat', pattern: /boatitem|minecartitem/, capabilities: ['summon-entity'] },
  { role: 'block-item', label: 'Block item (BlockItem subclass)', shape: 'block', pattern: /blockitem/, capabilities: ['place-block'] },
];

/** What the item's own code does. Weaker than inheritance, which it cannot override. */
export const ITEM_CODE_RULES: RoleRule[] = [
  { role: 'spawn-egg', label: 'Spawn egg (spawn egg registration call)', shape: 'flat', pattern: /spawnegg|registerspawn/, capabilities: ['summon-entity'] },
  { role: 'food', label: 'Consumable (food properties built in code)', shape: 'flat', pattern: /foodproperties|finishusingitem|getfoodproperties|nutrition|saturation/, capabilities: ['consume'] },
  { role: 'armor', label: 'Wearable (armour material built in code)', shape: 'block', pattern: /armormaterial|getdefensefor/, capabilities: ['wearable'] },
  { role: 'fluid', label: 'Fluid vessel (fluid API call)', shape: 'flat', pattern: /fluidstack|fluidcontainer|getfluid|bucketfill/, capabilities: ['fluid-container'] },
  { role: 'storage', label: 'Storage container (inventory or menu API call)', shape: 'bag', pattern: /menupprovider|iinventory|containerprovider|openmenu|iteminventory/, capabilities: ['container'] },
  { role: 'projectile-launcher', label: 'Projectile launcher (projectile spawn call)', shape: 'tool', pattern: /spawnprojectile|shootprojectile|launchprojectile|shootarrow|firedarrow/, capabilities: ['projectile-launch'] },
  { role: 'weapon', label: 'Weapon (strike or attack-damage call)', shape: 'tool', pattern: /getattackdamage|meleeattack|sweepattack|applyattackdamage|setattackdamage/, capabilities: ['melee-strike'] },
  { role: 'tool', label: 'Harvest tool (block-break speed call)', shape: 'tool', pattern: /getdestroyspeed|mineblock|harvestlevel|isdiggersuitable/, capabilities: ['harvest'] },
  { role: 'block-item', label: 'Block item (block placement call)', shape: 'block', pattern: /placeblock|registerblock/, capabilities: ['place-block'] },
];

/** Item tags the mod's own JSON assigns. */
export const ITEM_TAG_RULES: RoleRule[] = [
  { role: 'weapon', label: 'Weapon (mod item tag)', shape: 'tool', pattern: /^(swords?|melee_weapon|weapons?)$/, capabilities: ['melee-strike'] },
  { role: 'tool', label: 'Tool (mod item tag)', shape: 'tool', pattern: /^(pickaxes?|shovels?|hoes|axes|shears|tools?)$/, capabilities: ['harvest'] },
  { role: 'armor', label: 'Wearable (mod item tag)', shape: 'block', pattern: /^(head_armor|chest_armor|leg_armor|foot_armor|armors?|helmets|chestplates|leggings|boots)$/, capabilities: ['wearable'] },
  { role: 'food', label: 'Consumable (mod item tag)', shape: 'flat', pattern: /^(foods?|drinks?|edible)$/, capabilities: ['consume'] },
  { role: 'ammunition', label: 'Ammunition (mod item tag)', shape: 'flat', pattern: /^(arrows?|ammunition|bullets?|projectiles?)$/, capabilities: [] },
  { role: 'vehicle', label: 'Vehicle item (mod item tag)', shape: 'flat', pattern: /^(boats?|minecarts?)$/, capabilities: ['summon-entity'] },
];

const CATEGORY_BY_ROLE: Record<ItemSemanticRole, NonNullable<RemakeItem['category']>> = {
  weapon: 'weapon',
  'projectile-launcher': 'weapon',
  ammunition: 'item',
  tool: 'tool',
  armor: 'armor',
  equipment: 'armor',
  food: 'food',
  'spawn-egg': 'spawn_egg',
  'block-item': 'block',
  storage: 'storage',
  fluid: 'fluid',
  machine: 'machine',
  material: 'item',
  utility: 'item',
  vehicle: 'item',
  unresolved: 'item',
};

const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const decoder = new TextDecoder();

/** Item ids the mod's own `tags/item` files assign, keyed by un-namespaced id. */
function collectItemTags(entries: ExtractedZipEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    if (!/\/tags\/(items?)\//.test(path) || !path.endsWith('.json')) continue;
    const tagName = path.split('/').pop()?.replace(/\.json$/, '') ?? '';
    if (!tagName) continue;
    try {
      const doc = JSON.parse(decoder.decode(entry.data)) as { values?: unknown[] };
      for (const value of Array.isArray(doc?.values) ? doc.values : []) {
        if (typeof value !== 'string') continue;
        const cleaned = value.replace(/^#/, '').replace(/^[a-z0-9_.-]+:/i, '').toLowerCase();
        if (!cleaned) continue;
        const list = map.get(cleaned) ?? [];
        if (!list.includes(tagName)) list.push(tagName);
        map.set(cleaned, list);
      }
    } catch {
      // A malformed tag file is skipped, never guessed at.
    }
  }
  return map;
}

/**
 * Links an item id to the classes the mod actually shipped for it: first by the namespaced
 * identifier the class declares, then by class-name correspondence.
 */
export function linkItemClasses(id: string, classes: DecompileClassSummary[]): DecompileClassSummary[] {
  const idKey = compact(id);
  if (idKey.length < 3) return [];
  const exact = classes.filter((entry) =>
    (entry.registryIds ?? []).some((registryId) => compact(registryId.split(':').pop() ?? '') === idKey));
  if (exact.length > 0) return exact;
  return classes.filter((entry) => {
    const classKey = compact(entry.className.replace(/(item|weapon|projectile|block|entity|base|tiered)$/i, ''));
    return classKey.length > 3 && (classKey.includes(idKey) || idKey.includes(classKey));
  });
}

/** True when the registry itself links this item to an entity as its spawn egg. */
function resolveEntityLink(id: string, entityNames: string[]): string | null {
  const key = compact(id);
  if (!key.endsWith('spawnegg')) return null;
  const base = key.slice(0, -'spawnegg'.length);
  if (base.length < 2) return null;
  const match = entityNames.find((entry) => {
    const entityKey = compact(entry.replace(/spawn egg/gi, ''));
    return entityKey === base || `${entityKey}spawnegg` === key;
  });
  return match ?? null;
}

function projectileHintFor(text: string): ItemClassification['projectileHint'] {
  if (/splashpotion|throwablepotionitem|ligneringpotion/.test(text)) return 'minecraft:splash_potion';
  if (/snowball/.test(text)) return 'minecraft:snowball';
  if (/thrownegg|eggitem/.test(text)) return 'minecraft:egg';
  if (/arrow|bowitem|crossbowitem/.test(text)) return 'minecraft:arrow';
  return undefined;
}

function extraCapabilities(signalText: string, code: string, lineage: string): ItemCapability[] {
  const capabilities: ItemCapability[] = [];
  if (signalText.includes('bytecode-signature:projectile-launch')) capabilities.push('projectile-launch');
  if (signalText.includes('bytecode-signature:area-of-effect')) capabilities.push('area-of-effect');
  if (signalText.includes('bytecode-signature:homing-projectile')) capabilities.push('homing-projectile');
  if (/\b(spellitem|castspell|spellcaster|spellcast|magicwand|wanditem|staffitem|castmagic)\b/.test(`${code} ${lineage}`)) capabilities.push('spell-cast');
  if (/\b(onitemrightclick|useon|onitemuse|itemuse|onuse)\b/.test(code)) capabilities.push('use-hook');
  return capabilities;
}

export function createItemSemanticContext(input: {
  classes?: DecompileClassSummary[];
  entries?: ExtractedZipEntry[];
  /** Registered entity display names — used only to prove an item is that entity's spawn egg. */
  entities?: string[];
}): ItemSemanticContext {
  const classes = input.classes ?? [];
  const entries = input.entries ?? [];
  const entityNames = input.entities ?? [];
  const tagsById = collectItemTags(entries);
  const archivePaths = entries.map((entry) => entry.path.replace(/\\/g, '/').toLowerCase());

  return {
    classify({ id, name }) {
      const candidates: Candidate[] = [];
      const linked = linkItemClasses(id, classes);
      const lineage = linked
        .map((entry) => `${entry.superName ?? ''} ${entry.className}`)
        .join(' ')
        .toLowerCase();
      const signals = linked.flatMap((entry) => entry.signals ?? []).join(' ').toLowerCase();
      const code = linked
        .flatMap((entry) => [...(entry.registryIds ?? []), ...entry.methods, ...(entry.signals ?? [])])
        .join(' ')
        .toLowerCase();
      const tags = tagsById.get(id.toLowerCase()) ?? [];
      const slug = id.toLowerCase();

      const push = (
        role: ItemSemanticRole,
        label: string,
        shape: ItemSemanticShape,
        capabilities: ItemCapability[],
        source: ItemEvidenceSource,
        weight: number,
        detail: string,
        slot?: RemakeItem['slot'],
      ) => {
        if (candidates.some((entry) => entry.role === role)) return;
        candidates.push({ role, label, shape, capabilities, source, weight, detail, slot });
      };

      // 1. Registry: the mod itself registers this item as an entity's spawn egg.
      const entityLink = resolveEntityLink(id, entityNames);
      if (entityLink) {
        push('spawn-egg', 'Spawn egg (entity association in the registry)', 'flat', ['summon-entity'],
          'registry-signature', WEIGHT_REGISTRY,
          `registry: "${id}" is registered as the spawn egg of entity "${entityLink}"`);
      }

      // 2. Inheritance of the item's own class.
      for (const rule of ITEM_LINEAGE_RULES) {
        const match = lineage.match(rule.pattern);
        if (!match) continue;
        push(rule.role, rule.label, rule.shape, rule.capabilities, 'bytecode-signature', WEIGHT_LINEAGE,
          `bytecode: "${linked[0]?.className ?? 'mod class'}" extends ${linked[0]?.superName ?? match[0]}`, rule.slot);
      }

      // 3. What the item's own code calls.
      for (const rule of ITEM_CODE_RULES) {
        const match = code.match(rule.pattern);
        if (!match) continue;
        push(rule.role, rule.label, rule.shape, rule.capabilities, 'bytecode-signature', WEIGHT_CODE,
          `bytecode: "${linked[0]?.className ?? 'mod class'}" calls ${match[0]}`);
      }

      // 4. Item tags the mod's own JSON assigns.
      for (const tag of tags) {
        for (const rule of ITEM_TAG_RULES) {
          if (!rule.pattern.test(tag)) continue;
          push(rule.role, rule.label, rule.shape, rule.capabilities, 'data-signature', WEIGHT_DATA,
            `data: item tag "#${tag}"`);
        }
      }

      // 5. Archive assets: a blockstate or block model proves a block item. An item texture on
      //    its own only proves the item exists, so it can never decide a role.
      const blockAsset = archivePaths.some((path) =>
        path.endsWith(`blockstates/${slug}.json`)
        || path.endsWith(`models/block/${slug}.json`)
        || path.endsWith(`textures/block/${slug}.png`)
        || path.endsWith(`textures/blocks/${slug}.png`));
      if (blockAsset) {
        push('block-item', 'Block item (blockstate or block model in the archive)', 'block', ['place-block'],
          'asset-signature', WEIGHT_ASSET, `archive: blockstate/model/texture declares "${slug}" as a block`);
      }
      const hasItemTexture = archivePaths.some((path) =>
        path.endsWith(`textures/item/${slug}.png`) || path.endsWith(`textures/items/${slug}.png`));

      const ranked = candidates.slice().sort((a, b) => b.weight - a.weight);
      const best = ranked[0];
      const cooldownTicks = Math.max(0, detectCooldownTicks(`${code} ${signals}`) ?? 0);
      const evidence: ItemEvidenceRecord[] = ranked.map((entry) => ({
        source: entry.source,
        detail: entry.detail,
        weight: entry.weight,
      }));

      if (!best || best.weight < DECISION_THRESHOLD) {
        if (hasItemTexture) {
          evidence.push({
            source: 'asset-signature',
            detail: `archive: an item texture exists for "${slug}" — that proves the item exists, not what it does`,
            weight: WEIGHT_EXISTENCE,
          });
        }
        evidence.push({
          source: 'name-hint',
          detail: `display name "${name}" was not used: a name never decides a role`,
          weight: WEIGHT_NAME,
        });
        const capabilities = extraCapabilities(signals, code, lineage);
        return {
          role: 'unresolved',
          category: 'item',
          label: 'Item (role not recoverable from source evidence)',
          shape: 'flat',
          confidence: best ? best.source : 'unresolved',
          score: best?.weight ?? 0,
          evidence,
          capabilities,
          cooldownTicks,
          projectileHint: undefined,
          uncertain: true,
          behaviourRecovered: false,
        };
      }

      const capabilities = Array.from(new Set([...best.capabilities, ...extraCapabilities(signals, code, lineage)]));
      return {
        role: best.role,
        category: CATEGORY_BY_ROLE[best.role],
        label: best.label,
        shape: best.shape,
        confidence: best.source,
        score: best.weight,
        evidence,
        capabilities,
        cooldownTicks,
        slot: best.slot,
        entityLink: entityLink ?? undefined,
        projectileHint: projectileHintFor(`${lineage} ${code}`),
        uncertain: false,
        behaviourRecovered: best.source === 'registry-signature'
          || best.source === 'bytecode-signature'
          || best.source === 'data-signature',
      };
    },
  };
}