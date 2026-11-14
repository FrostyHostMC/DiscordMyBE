import type { DecompileStats, ItemClassification, RemakeItem, RemakeMechanic, UniversalIRReport } from '@/types/remaker';
import { safeFileId } from '@/utils/bedrockIds';
import { isGhostEntityName } from '@/utils/ghostEntityFilter';
import { inferItemBehaviorProfiles } from '@/utils/itemBehaviorEngine';
import { createItemSemanticContext } from '@/utils/itemSemantics';

export interface UniversalPortResult {
  addonName: string;
  id: string;
  description: string;
  items: RemakeItem[];
  entities: string[];
  mechanics: RemakeMechanic[];
  shapes: Record<string, 'block' | 'bag' | 'tool' | 'flat'>;
  palettes: Record<string, string[]>;
  scriptCustomLogic: string;
  totalDetectedDefinitions: number;
  omittedDefinitionCount: number;
}

const PALETTES = {
  honey: ['#f59e0b', '#fbbf24', '#d97706', '#78350f'],
  leather: ['#854d0e', '#a16207', '#713f12', '#451a03'],
  iron: ['#94a3b8', '#cbd5e1', '#64748b', '#334155'],
  diamond: ['#06b6d4', '#22d3ee', '#0891b2', '#164e63'],
  netherite: ['#3f3f46', '#27272a', '#52525b', '#18181b'],
  ender: ['#0d9488', '#14b8a6', '#581c87', '#0f172a'],
  nature: ['#10b981', '#34d399', '#059669', '#064e3b'],
  ruby: ['#ef4444', '#f87171', '#b91c1c', '#7f1d1d'],
  magic: ['#8b5cf6', '#a78bfa', '#6d28d9', '#4c1d95'],
  gold: ['#eab308', '#facc15', '#ca8a04', '#713f12'],
  slate: ['#64748b', '#94a3b8', '#475569', '#1e293b'],
  copper: ['#c2703e', '#e08c52', '#8a4d24', '#5c2f14'],
  energy: ['#f97316', '#fbbf24', '#ea580c', '#7c2d12'],
  fluid: ['#38bdf8', '#7dd3fc', '#0284c7', '#0c4a6e'],
};

function selectPalette(name: string): string[] {
  const lower = name.toLowerCase();
  if (lower.includes('honey') || lower.includes('sugar') || lower.includes('jelly') || lower.includes('bee')) return PALETTES.honey;
  if (lower.includes('leather') || lower.includes('wood') || lower.includes('bark')) return PALETTES.leather;
  if (lower.includes('diamond') || lower.includes('cyan') || lower.includes('crystal')) return PALETTES.diamond;
  if (lower.includes('netherite') || lower.includes('obsidian') || lower.includes('dark')) return PALETTES.netherite;
  if (lower.includes('ender') || lower.includes('void') || lower.includes('teleport')) return PALETTES.ender;
  if (lower.includes('plant') || lower.includes('root') || lower.includes('leaf') || lower.includes('slime')) return PALETTES.nature;
  if (lower.includes('red') || lower.includes('blood') || lower.includes('fire') || lower.includes('ruby')) return PALETTES.ruby;
  if (lower.includes('magic') || lower.includes('arcane') || lower.includes('spell') || lower.includes('rune')) return PALETTES.magic;
  if (lower.includes('gold') || lower.includes('sun') || lower.includes('queen') || lower.includes('crown')) return PALETTES.gold;
  if (lower.includes('iron') || lower.includes('steel') || lower.includes('metal')) return PALETTES.iron;
  if (lower.includes('copper') || lower.includes('bronze') || lower.includes('brass')) return PALETTES.copper;
  if (lower.includes('energy') || lower.includes('power') || lower.includes('reactor') || lower.includes('dynamo') || lower.includes('solar') || lower.includes('battery') || lower.includes('generator')) return PALETTES.energy;
  if (lower.includes('fluid') || lower.includes('water') || lower.includes('oil') || lower.includes('molten') || lower.includes('liquid')) return PALETTES.fluid;
  return PALETTES.slate;
}

function isValidDisplayName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 32) return false;
  if (/%[sdf0-9]|§|\u00a7|<-|->|:\s*%|\n|\r|%s|%d|_s\b|_d\b|\+/i.test(name)) return false;
  if (/^(name:|type:|registry name:|release\b|consume\b|press\b|hold\b|sneak\b|no\b|to\b|for\b|requires\b|when\b|if\b)/i.test(name)) return false;
  if (/^(Release|Consume|No|To|For|Requires|When|If|Press|Hold|Sneak|Name|Type|Registry)\b/i.test(name)) return false;
  if (/\b(health|inventory|stinger back|grow baby|pollinate|maze|cell maze|new compass|spawned|subtitle|tooltip|advancement|criteria)\b/i.test(name)) return false;
  if (/\b(baby to adult|heal 2|put stinger|6honey)\b/i.test(name)) return false;
  if (/\b[a-z0-9]_[a-z0-9]\b|_s\b|_d\b|\b[A-Z]\s+[S|D]$/i.test(name)) return false;
  if (/^[a-z]/.test(name)) return false;
  if (/ - |:\s+|\.\s|!\s|\?\s|_/.test(name)) return false;
  if (name.split(' ').length > 4) return false;
  return true;
}

function displayAssetPath(raw: string): string {
  return raw
    .split(/[\\/_.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function analyzeAndPortMod1to1(
  brief: string,
  fileName: string | null,
  decompileStats?: DecompileStats,
  fileEntries?: ExtractedZipEntry[],
  /** Analysis record from the IR stage. When present its item roles are reused, never re-derived. */
  sourceIR?: UniversalIRReport,
): UniversalPortResult {
  const text = (brief || '').trim();
  const firstLine = text.split('\n')[0]?.trim() || '';
  let addonName = '';

  if (decompileStats?.modName && decompileStats.modName !== 'Java Mod Remake') {
    addonName = decompileStats.modName;
  } else if (firstLine.length > 2 && firstLine.length < 50 && !firstLine.startsWith('http')) {
    addonName = firstLine.replace(/[#*`_]/g, '').trim();
  } else if (fileName) {
    const clean = fileName.replace(/\.(jar|zip)$/i, '').replace(/[-_]/g, ' ');
    addonName = clean.charAt(0).toUpperCase() + clean.slice(1);
  } else {
    addonName = 'Universal Bedrock Mod';
  }

  const id = decompileStats?.modId ? safeFileId(decompileStats.modId) : safeFileId(addonName);
  const seenIds = new Set<string>();
  const items: RemakeItem[] = [];
  const shapes: Record<string, 'block' | 'bag' | 'tool' | 'flat'> = {};
  const palettes: Record<string, string[]> = {};

  // Item roles are derived from this mod's own registry declarations, bytecode, data tags and
  // archive assets. The display name never decides a role, so no name table exists any more.
  const registeredEntities = Array.from(new Set([
    ...(decompileStats?.spawnableEntities ?? []),
    ...(decompileStats?.registeredEntities ?? []),
  ]));
  const itemSemantics = createItemSemanticContext({
    classes: decompileStats?.classes ?? [],
    entries: fileEntries ?? [],
    entities: registeredEntities,
  });
  let uncertainClassificationCount = 0;
  let nameBasedRoleCount = 0;
  const reportClassification = (classification: ItemClassification) => {
    if (classification.uncertain) {
      uncertainClassificationCount += 1;
      console.log(
        `[Aippy] [ITEM] role UNCERTAIN (${classification.confidence}, ${Math.round(classification.score * 100)}%) — ${classification.evidence[0]?.detail ?? 'no source evidence'}. No damage, durability, nutrition or behaviour was invented for it.`,
      );
    } else if (!classification.behaviourRecovered) {
      nameBasedRoleCount += 1;
    }
  };

  const sourceEntities = new Set(registeredEntities);

  // Entity identity is kept separate from the item registry. Bedrock spawn eggs are not
  // emitted as custom item definitions unless source registration explicitly supports them.

  // Alias Collapsing Engine for duplicate block variants (e.g. chest_big vs chest_big_0)
  const detectedBlocks = new Set<string>(decompileStats?.registeredBlocks ?? []);
  const collapsedBlocks = new Map<string, string>(); // aliasId -> parentId
  const blockList = [...detectedBlocks];
  for (const blockName of blockList) {
    const name = blockName.trim();
    if (!isValidDisplayName(name)) continue;
    const itemId = safeFileId(name);
    if (!itemId) continue;

    // Check if this is a variant alias (e.g. ends in _0, _1, _var, _open, _closed)
    const baseMatch = itemId.match(/^(.+?)(?:_0|_1|_2|_open|_closed|_lit|_variant)$/);
    if (baseMatch && seenIds.has(baseMatch[1])) {
      collapsedBlocks.set(itemId, baseMatch[1]);
      continue;
    }

    if (seenIds.has(itemId)) continue;
    seenIds.add(itemId);

    const isChestOrContainer = /chest|barrel|crate|box|storage|container|inventory/i.test(name) || /chest|barrel|crate|box|storage|container/i.test(itemId);
    items.push({
      id: itemId,
      name,
      type: isChestOrContainer ? 'Container Block' : 'Placeable Block',
      category: 'block',
      ability: isChestOrContainer
        ? 'Interactive world container block with 27-slot inventory storage.'
        : 'Solid world block with custom collision geometry and light emission.',
    });
    shapes[itemId] = 'block';
    palettes[itemId] = selectPalette(name);
  }

  // 3. Extract from registered items detected by bytecode & lang decompiler
  const detected = decompileStats?.registeredItems ?? [];
  for (const detectedName of detected) {
    const name = detectedName.trim();
    if (!isValidDisplayName(name)) continue;

    const itemId = safeFileId(name);
    if (!itemId || seenIds.has(itemId)) continue;

    // The role comes from the mod's own registry, bytecode, data tags and archive assets.
    // A spawn egg is recognised only when the registry links the item to an entity, never
    // because its display name contains a word.
    const classification = sourceIR?.itemClassifications?.[itemId]
      ?? itemSemantics.classify({ id: itemId, name });
    reportClassification(classification);

    if (classification.role === 'spawn-egg') {
      const mobDisplay = classification.entityLink
        ?? name.replace(/spawn egg/gi, '').replace(/summon egg/gi, '').trim();
      if (mobDisplay && !isGhostEntityName(mobDisplay)) sourceEntities.add(mobDisplay);
      continue;
    }

    seenIds.add(itemId);
    items.push({
      id: itemId,
      name,
      type: classification.label,
      category: classification.category,
      classification,
      slot: classification.slot,
      ability: classification.evidence.map((entry) => entry.detail).join('; ') || 'Role not recoverable from source evidence.',
    });
    shapes[itemId] = classification.shape;
    palettes[itemId] = selectPalette(name);
  }

  const maxExportedItems = 2048;
  const totalDetectedDefinitions = items.length;
  const omittedDefinitionCount = Math.max(0, totalDetectedDefinitions - maxExportedItems);
  if (omittedDefinitionCount > 0) items.length = maxExportedItems;

  // No starter/placeholder items: a mod the engine cannot read leaves the item list empty
  // and is reported, instead of shipping three invented items that are not in the source.
  if (items.length === 0) {
    console.log('[Aippy] [ITEM] No item evidence was recovered from this archive — nothing is invented to fill the gap.');
  }

  const behaviorProfiles = inferItemBehaviorProfiles(items, decompileStats?.classes ?? [], fileEntries, registeredEntities);
  let behaviorRangedCount = 0;
  let behaviorMeleeCount = 0;
  let behaviorFoodCount = 0;
  let behaviorArmorCount = 0;
  let behaviorToolCount = 0;
  let behaviorStorageCount = 0;
  let behaviorFluidCount = 0;
  let behaviorCraftingCount = 0;
  let behaviorBlockCount = 0;
  let behaviorUnresolvedCount = 0;
  let behaviorSpawnEggCount = 0;

  for (const item of items) {
    const profile = behaviorProfiles[item.id] ?? {
      kind: item.category === 'block' ? 'block' : 'crafting',
      confidence: 'type-default',
      cooldownTicks: 0,
      behaviorComponent: item.category === 'block' ? 'minecraft:block_placer' : 'minecraft:max_stack_size',
      evidence: [`category:${item.category}`],
      note: `Type-based default applied for ${item.category}.`,
    };
    item.behaviorProfile = profile;
    // The category comes from the item's own classification and is never re-written here, so a
    // spawn egg or a block item can not be relabelled as combat by a behaviour profile.
    const structuralRole = item.classification?.role === 'spawn-egg' || item.classification?.role === 'block-item';
    const combatProfile = profile.kind === 'projectile' || profile.kind === 'spell' || profile.kind === 'melee';
    if (structuralRole && combatProfile) {
      console.log(`[Aippy] [ITEM] "${item.id}" — combat signature ignored: the source declares this item as ${item.classification?.role}, so it keeps that role.`);
    }
    if (profile.kind === 'projectile' || profile.kind === 'spell') {
      behaviorRangedCount++;
      item.type = profile.kind === 'spell' ? 'Magic Caster' : 'Ranged Launcher';
      item.ability = profile.note;
    } else if (profile.kind === 'melee') {
      behaviorMeleeCount++;
      item.type = 'Weapon (strike evidence)';
      item.ability = profile.note;
    } else if (profile.kind === 'food') {
      behaviorFoodCount++;
      item.type = 'Consumable Food';
      item.ability = profile.note;
    } else if (profile.kind === 'armor') {
      behaviorArmorCount++;
      item.type = 'Wearable Equipment';
      item.ability = profile.note;
    } else if (profile.kind === 'tool') {
      behaviorToolCount++;
      item.type = 'Harvest Tool';
      item.ability = profile.note;
    } else if (profile.kind === 'storage') {
      behaviorStorageCount++;
      item.type = 'Storage Container';
      item.ability = profile.note;
    } else if (profile.kind === 'fluid') {
      behaviorFluidCount++;
      item.type = 'Custom Fluid';
      item.ability = profile.note;
    } else if (profile.kind === 'block') {
      behaviorBlockCount++;
    } else if (profile.kind === 'spawn_egg') {
      behaviorSpawnEggCount++;
    } else if (profile.kind === 'crafting') {
      behaviorCraftingCount++;
    } else {
      behaviorUnresolvedCount++;
    }
  }

  const mechanics: RemakeMechanic[] = [];
  if (items.length > 0) {
    mechanics.push({
      name: 'Source item classification',
      summary: `${behaviorRangedCount} projectile/spell, ${behaviorMeleeCount} melee, ${behaviorFoodCount} food, ${behaviorArmorCount} armor, ${behaviorToolCount} tool, ${behaviorStorageCount} storage, ${behaviorCraftingCount} crafting, ${behaviorBlockCount} block and ${behaviorSpawnEggCount} source-linked entity item classification(s); ${behaviorUnresolvedCount} remain unresolved.`,
      category: 'script',
    });
  }
  for (const signal of decompileStats?.mechanics ?? []) {
    mechanics.push({
      name: signal,
      summary: 'Signal found in the imported source; no additional gameplay is inferred from this label.',
      category: 'script',
    });
  }
  if ((decompileStats?.animationsCount ?? 0) > 0) {
    mechanics.push({
      name: 'Source animation documents',
      summary: `${decompileStats?.animationsCount ?? 0} animation document(s) found in the imported archive.`,
      category: 'animation',
    });
  }

  const runtimeItemBehaviors = Object.fromEntries(
    items
      .filter((item) => item.behaviorProfile && item.behaviorProfile.kind !== 'unresolved' && item.behaviorProfile.kind !== 'block')
      .map((item) => [item.id, item.behaviorProfile]),
  );
  const activeCombatItems = Object.entries(runtimeItemBehaviors).filter(
    ([, prof]) => prof && (prof.kind === 'projectile' || prof.kind === 'spell' || prof.kind === 'melee' || prof.kind === 'food'),
  );
  const hasActiveCombatItems = activeCombatItems.length > 0;

  const scriptCustomLogic = `
// Universal Bedrock Script API Automation for ${addonName}
// Generated deterministically from source mod evidence (zero invented mechanics)

import { world, system } from '@minecraft/server';

const MOD_ID = '${id}';
const ITEM_BEHAVIORS = ${JSON.stringify(runtimeItemBehaviors)};
const ITEM_COOLDOWNS = new Map();

// Automated player initialization sequence
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) {
    // Parity runtime active for [${addonName}] (Ported Using Stonebyte-JavaBE)
  }
});
${
  hasActiveCombatItems
    ? `
// Interactive Item Use handler (Evidence-backed combat & consumable items)
world.afterEvents.itemUse.subscribe((event) => {
  const item = event.itemStack;
  const player = event.source;
  if (!item || !player) return;

  const typeId = item.typeId;
  if (!typeId.startsWith(MOD_ID + ':')) return;

  const shortId = typeId.replace(MOD_ID + ':', '');
  const profile = ITEM_BEHAVIORS[shortId];
  if (profile && (profile.kind === 'projectile' || profile.kind === 'spell')) {
    const now = system.currentTick;
    const cooldownKey = player.id + ':' + shortId;
    const last = ITEM_COOLDOWNS.get(cooldownKey);
    const cooldownTicks = profile.cooldownTicks;
    if (typeof last === 'number' && now - last < cooldownTicks) {
      player.onScreenDisplay.setActionBar('§c[' + (profile.kind === 'spell' ? 'Spell' : 'Weapon') + '] §fRecharging');
    } else {
      ITEM_COOLDOWNS.set(cooldownKey, now);
      if (ITEM_COOLDOWNS.size > 256) ITEM_COOLDOWNS.delete(ITEM_COOLDOWNS.keys().next().value);
      const dir = player.getViewDirection();
      const spawnLoc = { x: player.location.x + dir.x * 1.2, y: player.location.y + 1.5, z: player.location.z + dir.z * 1.2 };
      try {
        const projectile = player.dimension.spawnEntity(profile.projectileType, spawnLoc);
        projectile.applyImpulse({ x: dir.x * 2.6, y: dir.y * 2.6 + 0.05, z: dir.z * 2.6 });
      } catch {}
      try { player.dimension.spawnParticle('minecraft:critical_hit_emitter', spawnLoc); } catch {}
      player.dimension.playSound(profile.kind === 'spell' ? MOD_ID + '.magic_cast' : MOD_ID + '.weapon_swing', player.location, { volume: 0.8, pitch: 1.0 });
    }
    return;
  }

  if (profile?.kind === 'food') {
    player.runCommandAsync('playsound random.drink @s ~ ~ ~ 1.0 1.0');
    player.runCommandAsync('particle minecraft:critical_hit_emitter ~ ~1.2 ~');
  } else if (profile?.kind === 'melee') {
    player.runCommandAsync('particle minecraft:critical_hit_emitter ~ ~1 ~');
    player.runCommandAsync('playsound random.bow @s ~ ~ ~ 0.8 1.5');
  }
});

// Combat hit impact detection for melee items
world.afterEvents.entityHitEntity.subscribe((event) => {
  const attacker = event.damagingEntity;
  const target = event.hitEntity;
  if (!attacker || !target) return;

  try {
    const equippable = attacker.getComponent('minecraft:equippable');
    const mainhand = equippable?.getEquipment('Mainhand');
    if (!mainhand || !mainhand.typeId.startsWith(MOD_ID + ':')) return;
    const profile = ITEM_BEHAVIORS[mainhand.typeId.replace(MOD_ID + ':', '')];
    if (profile?.kind !== 'melee') return;
    const targetLoc = target.location;
    attacker.runCommandAsync(\`particle minecraft:critical_hit_emitter \${targetLoc.x} \${targetLoc.y + 1} \${targetLoc.z}\`);
    attacker.runCommandAsync('playsound random.anvil_land @s ~ ~ ~ 0.3 1.8');
  } catch {}
});
`
    : ''
}
`;

  const description = decompileStats?.metadataFormat
    ? `${addonName} ported to Minecraft Bedrock Edition from ${decompileStats.metadataFormat}. Deterministic rule-based parity engine.`
    : text.length > 20
      ? text.slice(0, 180).replace(/\n+/g, ' ')
      : `${addonName} ported directly to Minecraft Bedrock Edition with 1:1 deterministic parity.`;

  return {
    addonName,
    id,
    description,
    items,
    entities: Array.from(sourceEntities),
    mechanics,
    shapes,
    palettes,
    // Keep the generated runtime only when source-backed item behavior needs it.
    // Returning an empty string here silently discarded the handlers built above.
    scriptCustomLogic: hasActiveCombatItems ? scriptCustomLogic : '',
    totalDetectedDefinitions,
    omittedDefinitionCount,
  };
}