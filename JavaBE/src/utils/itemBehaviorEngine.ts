import type {
  DecompileClassSummary,
  ItemBehaviorProfile,
  ItemClassification,
  ItemEvidenceSource,
  RemakeItem,
} from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import { createItemSemanticContext } from '@/utils/itemSemantics';

/**
 * Universal item behaviour engine.
 *
 * A Bedrock component is derived from the semantic classification only: every behaviour here
 * traces to a capability the imported mod itself declared (inheritance, a call, a data tag or
 * a registry association). Nothing is keyed on a display name, a namespace or a folder, and no
 * item is given a damage, durability, nutrition or cooldown value the mod does not carry.
 *
 * When the source evidence does not support a behaviour, the item keeps its identity and the
 * mapping is reported as unresolved instead of receiving a template.
 */

const CONFIDENCE_BY_SOURCE: Record<ItemEvidenceSource, ItemBehaviorProfile['confidence']> = {
  'registry-signature': 'registry-signature',
  'bytecode-signature': 'bytecode-signature',
  'data-signature': 'data-signature',
  'asset-signature': 'type-default',
  'name-hint': 'name-inferred',
  unresolved: 'unresolved',
};

function evidenceLines(classification: ItemClassification): string[] {
  return classification.evidence
    .filter((entry) => entry.weight >= 0.5)
    .slice(0, 4)
    .map((entry) => `${entry.source}: ${entry.detail}`);
}

function spellPatternsOf(classification: ItemClassification): ItemBehaviorProfile['spellPatterns'] {
  const patterns: NonNullable<ItemBehaviorProfile['spellPatterns']> = [];
  if (classification.capabilities.includes('area-of-effect')) patterns.push('area-of-effect');
  if (classification.capabilities.includes('homing-projectile')) patterns.push('homing-projectile');
  return patterns.length > 0 ? patterns : undefined;
}

function profileFor(item: RemakeItem, classification: ItemClassification): ItemBehaviorProfile {
  const confidence = CONFIDENCE_BY_SOURCE[classification.confidence];
  const evidence = evidenceLines(classification);
  const origin = evidence[0] ?? `${classification.confidence} evidence`;
  const cooldownTicks = Math.max(0, classification.cooldownTicks);

  // A spawn egg only ever becomes an entity placer: it can never inherit combat components.
  if (classification.role === 'spawn-egg') {
    return {
      kind: 'spawn_egg',
      confidence,
      cooldownTicks: 0,
      behaviorComponent: 'minecraft:entity_placer',
      evidence,
      note: `Spawn egg for "${classification.entityLink ?? item.id}" recovered from registry evidence (${origin}). Mapped to minecraft:entity_placer.`,
    };
  }

  const spellPatterns = spellPatternsOf(classification);
  const launches = classification.capabilities.includes('projectile-launch');
  const casts = classification.capabilities.includes('spell-cast');

  if (casts) {
    return {
      kind: 'spell',
      confidence,
      cooldownTicks,
      projectileType: classification.projectileHint,
      spellPatterns,
      behaviorComponent: 'minecraft:shooter',
      evidence,
      note: `Spell-casting logic recovered from the mod (${origin}). Mapped to a Bedrock shooter component${classification.projectileHint ? ` with ${classification.projectileHint}` : '; the source projectile type was not recovered, so no projectile entity was assumed'}.`,
    };
  }

  if (launches) {
    return {
      kind: 'projectile',
      confidence,
      cooldownTicks,
      projectileType: classification.projectileHint,
      spellPatterns,
      behaviorComponent: 'minecraft:shooter',
      evidence,
      note: `Projectile launch logic recovered from the mod (${origin}). Mapped to a Bedrock shooter component${classification.projectileHint ? ` with ${classification.projectileHint}` : '; the source projectile type was not recovered, so no projectile entity was assumed'}.`,
    };
  }

  if (classification.capabilities.includes('melee-strike')) {
    return {
      kind: 'melee',
      confidence,
      cooldownTicks,
      behaviorComponent: 'minecraft:damage',
      evidence,
      note: `Strike logic recovered from the mod (${origin}). A minecraft:damage component is only written when the mod declares an attack value; none is invented.`,
    };
  }

  switch (classification.role) {
    case 'food':
      return {
        kind: 'food',
        confidence,
        cooldownTicks,
        behaviorComponent: 'minecraft:food',
        evidence,
        note: `Consumable behavior recovered from the mod (${origin}). Nutrition is written only from a declared value; a documented Bedrock default is reported when the mod carries none.`,
      };
    case 'armor':
    case 'equipment':
      return {
        kind: 'armor',
        confidence,
        cooldownTicks,
        behaviorComponent: 'minecraft:wearable',
        evidence,
        note: `Wearable behavior recovered from the mod (${origin}). The equipment slot comes from the source evidence.`,
      };
    case 'tool':
      return {
        kind: 'tool',
        confidence,
        cooldownTicks,
        behaviorComponent: 'minecraft:digger',
        evidence,
        note: `Harvest logic recovered from the mod (${origin}). Mapped to a Bedrock digger component.`,
      };
    case 'fluid':
      return {
        kind: 'fluid',
        confidence,
        cooldownTicks,
        behaviorComponent: 'minecraft:fluid_container',
        evidence,
        note: `Fluid vessel behavior recovered from the mod (${origin}). Mapped to a Bedrock fluid container component.`,
      };
    case 'storage':
      return {
        kind: 'storage',
        confidence,
        cooldownTicks,
        behaviorComponent: 'minecraft:inventory',
        evidence,
        note: `Container behavior recovered from the mod (${origin}). Mapped to a Bedrock inventory component.`,
      };
    case 'block-item':
      return {
        kind: 'block',
        confidence,
        cooldownTicks,
        behaviorComponent: 'minecraft:block_placer',
        evidence,
        note: `Block item proven by the source archive (${origin}). Mapped to a Bedrock block placer bound to the converted block.`,
      };
    case 'vehicle':
      return {
        kind: 'crafting',
        confidence: 'unresolved',
        cooldownTicks: 0,
        behaviorComponent: 'minecraft:max_stack_size',
        evidence,
        note: `Vehicle item recovered from the mod (${origin}), but Bedrock has no data-driven vehicle item — reported UNRESOLVED; no item was turned into a generic placeholder.`,
      };
    case 'ammunition':
      return {
        kind: 'crafting',
        confidence,
        cooldownTicks: 0,
        behaviorComponent: 'minecraft:max_stack_size',
        evidence,
        note: `Ammunition recovered from the mod (${origin}). It is carried as an item only; no launch behavior belongs to the projectile itself.`,
      };
    default:
      break;
  }

  if (classification.uncertain) {
    return {
      kind: 'unresolved',
      confidence: 'unresolved',
      cooldownTicks: 0,
      behaviorComponent: 'minecraft:max_stack_size',
      evidence,
      note: `No behaviour evidence was recovered for "${item.id}" (${classification.confidence}). Its identity is preserved as a plain item and reported UNRESOLVED — no role, damage or durability was invented.`,
    };
  }

  return {
    kind: 'crafting',
    confidence,
    cooldownTicks: 0,
    behaviorComponent: 'minecraft:max_stack_size',
    evidence,
    note: `No use, strike, projectile, food, wearable or container behaviour was declared for "${item.id}" (${origin}). It ships as a plain item; nothing was invented.`,
  };
}

export function inferItemBehaviorProfiles(
  items: RemakeItem[],
  classes: DecompileClassSummary[] = [],
  fileEntries?: ExtractedZipEntry[],
  entities?: string[],
): Record<string, ItemBehaviorProfile> {
  const profiles: Record<string, ItemBehaviorProfile> = {};
  const context = createItemSemanticContext({ classes, entries: fileEntries, entities });
  for (const item of items) {
    const classification = item.classification ?? context.classify({ id: item.id, name: item.name });
    item.classification = classification;
    profiles[item.id] = profileFor(item, classification);
  }
  return profiles;
}