import type {
  BehaviorDomain,
  BehaviorTranslationFinding,
  BehaviorTranslationReport,
  BehaviorTranslationStatus,
  CategoryCounts,
  ComponentProvenance,
  DecompileClassSummary,
  RemakeItem,
  UnsupportedMechanic,
} from '@/types/remaker';
import type { ExtractedZipEntry } from '@/utils/zip';
import type { MobBehaviorProfile } from '@/utils/mobBehaviorProfiles';
import { countsFromProvenance, sumCounts } from '@/utils/provenance';
import { safeFileId } from '@/utils/bedrockIds';
import { boneNamesFromGeometry, classifyLocomotion } from '@/utils/mobLocomotion';
import {
  findBlockstateEvidence,
  readEntryText,
  scanModEvidence,
  textForClasses,
  textForIdentifier,
} from '@/utils/behaviorEvidenceScanner';
import { ensureBlockTrigger, ensureEntityTrigger } from '@/utils/behaviorEventEmitters';
import {
  detectBlockInteraction,
  detectEffectLogic,
  detectEntityTriggers,
  detectEquipmentLogic,
} from '@/utils/behaviorSignalDetectors';
import {
  ensureEntityInventory,
  ensureEntityLoot,
  ensureEntityTimer,
  ensureTradeComponent,
  translateLootTable,
  translateTradeTable,
} from '@/utils/behaviorPackEmitters';
import { applyItemBehaviorComponents, emitItemBehaviorScript } from '@/utils/itemBehaviorEmitters';
import { portWorldGeneration } from '@/utils/worldgenPortEngine';

type PackFiles = Record<string, string | Uint8Array>;

export interface BehaviorTranslationOptions {
  modId: string;
  entries: ExtractedZipEntry[];
  classes: DecompileClassSummary[];
  mobProfiles: Record<string, MobBehaviorProfile>;
  items: RemakeItem[];
  behaviorPackFiles: PackFiles;
  resourcePackFiles: PackFiles;
  recipeStats?: { converted: number; fallback: number; unresolved: string[] };
  playableMode: boolean;
  /** True when an upstream stage failed, so dependent success claims are blocked. */
  stageFailed?: boolean;
  onLog?: (line: string) => void;
}

/** Generic mechanism signatures. No mod, mob, item or block name is referenced. */
const TIMER_HINT = /(cooldown|timer|interval|period|delay|tick)[a-z_]*[^0-9]{0,14}(\d{1,5})/i;
const INVENTORY_HINT = /\b(container|inventory|iitemhandler|itemstack|menu|slots?)\b/i;
const TRADE_HINT = /\b(trade|trades|merchant|offer|villager)\b/i;
const EFFECT_HINT = /\b(status_?effect|mobeffect|applyeffect|potion_?effect|summon)\b/i;

/** A claim is only traceable when it names a path a pack can really contain. */
const PACK_PATH_PATTERN = /^(?:entities|blocks|items|spawn_rules|loot_tables|trading|recipes|features|feature_rules|particles|sounds|scripts|animations|animation_controllers|functions)\/[\w./-]+\.(?:json|js|mcfunction|ogg|wav|mp3)$/;

function detectTimerTicks(text: string): number | null {
  const match = text.match(TIMER_HINT);
  if (!match) return null;
  const ticks = Number.parseInt(match[2], 10);
  if (!Number.isFinite(ticks) || ticks < 5 || ticks > 72000) return null;
  return ticks;
}

function provenanceFor(status: BehaviorTranslationStatus, playableMode: boolean): ComponentProvenance {
  if (status === 'ported') return 'SOURCE';
  if (status === 'approximated') return 'ADAPTED';
  if (status === 'fallback') return playableMode ? 'INVENTED' : 'SCAFFOLD';
  return 'ABSENT';
}

/** Pack files that carry a mapping for this domain and target, if they really shipped. */
function shippedSupportFiles(domain: BehaviorDomain, target: string, pack: PackFiles): string[] {
  const found: string[] = [];
  const consider = (path: string) => {
    if (pack[path] != null && !found.includes(path)) found.push(path);
  };
  const considerPrefix = (prefix: string) => {
    for (const path of Object.keys(pack)) {
      if (found.length >= 3) break;
      if (path.startsWith(prefix) && pack[path] != null && !found.includes(path)) found.push(path);
    }
  };

  if (target === 'all') {
    switch (domain) {
      case 'recipes': considerPrefix('recipes/'); break;
      case 'particles': considerPrefix('particles/'); break;
      case 'sounds': considerPrefix('sounds/'); break;
      case 'worldgen': considerPrefix('features/'); considerPrefix('feature_rules/'); break;
      case 'villager-trades': considerPrefix('trading/'); break;
      case 'loot-tables': considerPrefix('loot_tables/'); break;
      case 'item-interaction': considerPrefix('items/'); break;
      case 'health-attributes': considerPrefix('entities/'); break;
      case 'entity-ai':
      case 'movement': considerPrefix('entities/'); break;
      default: break;
    }
    return found;
  }

  if (domain === 'spawning') consider(`spawn_rules/${target}.json`);
  else if (domain === 'loot-tables') consider(`loot_tables/entities/${target}.json`);
  else if (domain === 'custom-blocks' || domain === 'block-interaction') consider(`blocks/${target}.json`);
  else if (domain === 'custom-items' || domain === 'item-interaction' || domain === 'projectiles') {
    consider(`items/${target}.json`);
    consider(`blocks/${target}.json`);
  } else {
    consider(`entities/${target}.json`);
    consider(`items/${target}.json`);
    consider(`blocks/${target}.json`);
  }
  return found;
}

/**
 * Resolves every mapping against the files that really ship. A mapping reported as ported or
 * approximated must be traceable to at least one file in the pack; otherwise it is downgraded
 * to UNRESOLVED so no success claim is ever made without output behind it.
 */
function verifyFindings(pack: PackFiles, findings: BehaviorTranslationFinding[]): number {
  let unverified = 0;
  for (const finding of findings) {
    const claimed = finding.bedrockOutput
      .map((line) => line.trim())
      .filter((line) => PACK_PATH_PATTERN.test(line))
      .filter((path) => pack[path] != null);
    finding.outputFiles = Array.from(new Set([...claimed, ...shippedSupportFiles(finding.domain, finding.target, pack)]));
    finding.verified = finding.outputFiles.length > 0;
    if (finding.status !== 'ported' && finding.status !== 'approximated') continue;
    if (finding.verified) continue;
    finding.status = 'unresolved';
    finding.provenance = 'ABSENT';
    finding.note = `${finding.note} No shipped file backs this mapping, so it is reported UNRESOLVED instead of ported.`.trim();
    unverified += 1;
  }
  return unverified;
}

/**
 * Behaviour Translation Engine (Phase 5).
 *
 * Reconstructs Java behaviour from the mod's own bytecode, registrations and data files and
 * emits Bedrock-compatible components, item components, runtime trigger bindings, loot/trade
 * tables, timers, world-generation features and feature rules. Anything that cannot be
 * reproduced honest-to-Bedrock is reported as UNSUPPORTED rather than faked, and every
 * mapping is verified against the files that actually ship before it counts as ported.
 */
export function translateBehaviors(options: BehaviorTranslationOptions): BehaviorTranslationReport {
  const { modId, entries, classes, mobProfiles, items, behaviorPackFiles, resourcePackFiles, recipeStats, playableMode, stageFailed } = options;
  const onLog = options.onLog;
  const evidence = scanModEvidence(entries, classes);
  const findings: BehaviorTranslationFinding[] = [];
  const unsupported: UnsupportedMechanic[] = [];
  const filesWritten: string[] = [];

  const push = (
    domain: BehaviorDomain,
    target: string,
    status: BehaviorTranslationStatus,
    javaEvidence: string[],
    bedrockOutput: string[],
    note: string,
  ) => {
    findings.push({
      id: `${domain}:${target}:${findings.length}`,
      domain,
      target,
      status,
      provenance: provenanceFor(status, playableMode),
      javaEvidence: javaEvidence.filter((line) => line.length > 0).slice(0, 4),
      bedrockOutput: bedrockOutput.filter((line) => line.length > 0).slice(0, 4),
      outputFiles: [],
      verified: false,
      note,
    });
  };

  const pushUnsupported = (domain: BehaviorDomain, target: string, reason: string, sourceEvidence: string) => {
    push(domain, target, 'unsupported', [sourceEvidence], [], reason);
    unsupported.push({
      id: `${domain}:${target}:${unsupported.length}`,
      domain,
      target,
      reason,
      sourceEvidence: sourceEvidence || 'mod code',
      alternative: 'Requires manual @minecraft/server scripting — not generated automatically.',
    });
  };

  // 1. Entity behaviour: AI, movement, combat, health, timers, containers, spawn, loot, trades.
  const entityPaths = Object.keys(behaviorPackFiles).filter((key) => /^entities\/[^/]+\.json$/.test(key));
  const mobCode = new Map<string, string>();

  for (const path of entityPaths) {
    const mobId = path.slice('entities/'.length, -'.json'.length);
    const profile = mobProfiles[mobId];
    const classNames = profile?.sourceClasses ?? [];
    const codeText = textForClasses(evidence, classNames);
    mobCode.set(mobId, codeText);
    const sourceLabel = classNames[0] ?? 'no matching class';

    if (!profile || profile.isDefault) {
      push('entity-ai', mobId, 'unresolved', [], [], 'No attack, hostility or trading evidence in the mod — no AI or combat components were written.');
    } else if (profile.confidence === 'bytecode-signature' || profile.confidence === 'data-signature') {
      push('entity-ai', mobId, 'ported', profile.evidence, [`${profile.disposition} ${profile.attack} AI components`], `${profile.disposition} ${profile.attack} behaviour reconstructed from mod evidence.`);
    } else {
      push('entity-ai', mobId, 'approximated', profile.evidence, [`${profile.disposition} ${profile.attack} AI components`], `Behaviour derived from class association (${profile.confidence}).`);
    }

    const locomotion = classifyLocomotion(
      boneNamesFromGeometry(resourcePackFiles[`models/entity/${mobId}.geo.json`]),
      profile?.flyingDetected ?? false,
    );
    if (locomotion.detected) {
      push('movement', mobId, 'ported', [locomotion.evidence], [`${locomotion.rig} navigation & movement`], `Locomotion recovered from the shipped skeleton (${locomotion.evidence}).`);
    } else {
      push('movement', mobId, 'fallback', [], ['standard Bedrock walk navigation'], 'No recovered skeleton — standard Bedrock navigation shipped as structure.');
    }

    if (profile && profile.attack !== 'none') {
      const damage = profile.damageDetected ? `${profile.damage} damage` : 'no damage value in mod code (attack component omitted)';
      push('combat', mobId, profile.damageDetected ? 'ported' : 'approximated', profile.evidence, [profile.attack === 'ranged' || profile.attack === 'spell' ? 'shooter + ranged_attack' : 'melee_attack + hurt_by_target'], `${profile.attack} combat mapping, ${damage}.`);
    } else {
      push('combat', mobId, 'unresolved', [], [], 'No combat evidence — no melee or ranged attack component was generated.');
    }

    if (profile?.healthDetected) {
      push('health-attributes', mobId, 'ported', profile.evidence, [`minecraft:health ${profile.health}`], 'Health value recovered from mod code.');
    } else {
      push('health-attributes', mobId, 'fallback', [], ['minecraft:health 20 (Bedrock default)'], 'No health value in the mod — Bedrock default shipped as structure.');
    }

    const ticks = detectTimerTicks(codeText);
    if (ticks !== null) {
      const seconds = Math.min(60, Math.max(0.5, Math.round((ticks / 20) * 10) / 10));
      const eventName = `${modId}:${mobId}_timer`;
      const written = ensureEntityTimer(behaviorPackFiles, path, seconds, eventName);
      if (written) filesWritten.push(path);
      push(
        'timers-cooldowns',
        mobId,
        written ? 'approximated' : 'unresolved',
        [sourceLabel, `${ticks} tick interval detected`],
        written ? [path, `minecraft:timer ${seconds}s`, eventName] : [],
        written ? `Periodic timer reconstructed from a ${ticks}-tick interval in the mob's own code.` : 'Interval detected but the entity already declares a timer.',
      );
    }

    if (INVENTORY_HINT.test(codeText)) {
      const written = ensureEntityInventory(behaviorPackFiles, path);
      if (written) filesWritten.push(path);
      push(
        'inventory',
        mobId,
        written ? 'approximated' : 'unresolved',
        [sourceLabel],
        written ? [path, 'minecraft:inventory (27 slots)'] : [],
        written ? 'Container logic detected in the mob class; inventory component emitted.' : 'Container logic detected but the entity already declares an inventory.',
      );
    }

    if (EFFECT_HINT.test(codeText)) {
      pushUnsupported('effects', mobId, 'On-hit status effects and summons need per-target logic; Bedrock has no data-driven entity component for it.', sourceLabel);
    }

    // Entity events: Java handlers are mapped onto the real Bedrock trigger components that
    // exist for them. Only the empty hook ships (structure), never an invented response.
    const triggers = detectEntityTriggers(codeText);
    if (triggers.length > 0) {
      const emitted: string[] = [];
      for (const trigger of triggers) {
        const eventName = `${modId}:${mobId}_${trigger.component.replace('minecraft:on_', '')}_hook`;
        if (ensureEntityTrigger(behaviorPackFiles, path, trigger.component, eventName)) emitted.push(`${trigger.component} → ${eventName}`);
      }
      if (emitted.length > 0) {
        filesWritten.push(path);
        push('entity-events', mobId, 'fallback', triggers.map((trigger) => `${trigger.label} in ${sourceLabel}`), [path, ...emitted], 'Trigger hook emitted as SCAFFOLD structure. The Java handler body runs arbitrary code, so no gameplay response was generated.');
        pushUnsupported('entity-events', mobId, 'The Java event handler body has no data-driven Bedrock counterpart; only the trigger hook ships and the response needs the Script API.', sourceLabel);
      } else {
        push('entity-events', mobId, 'unresolved', triggers.map((trigger) => trigger.label), [], 'Event handlers detected but the entity definition already declares those trigger components.');
      }
    } else {
      push('entity-events', mobId, 'unresolved', [], [], 'No hurt, death or target handler in the mod\'s own class — no trigger component was generated.');
    }

    if (detectEquipmentLogic(codeText)) {
      push('equipment', mobId, 'unresolved', [sourceLabel], [], 'Equipment logic detected in the mob class. Bedrock mob equipment needs minecraft:equippable (1.21.30+) with an explicit slot that the code does not declare — left for manual review.');
    }

    const spawnPath = `spawn_rules/${mobId}.json`;
    if (profile?.spawnDetected && behaviorPackFiles[spawnPath]) {
      push('spawning', mobId, 'approximated', [profile.spawnEvidence ?? ''], [spawnPath], 'Spawn rule emitted from the detected spawn registration; weight and biome filter are generic Bedrock defaults.');
    } else if (profile?.spawnDetected) {
      push('spawning', mobId, 'unresolved', [profile.spawnEvidence ?? ''], [], 'Spawn registration detected but no spawn rule shipped.');
    } else {
      push('spawning', mobId, 'unresolved', [], [], 'No spawn registration in the mod — spawn egg only, no natural spawn rule.');
    }

    const lootPath = `loot_tables/entities/${mobId}.json`;
    if (behaviorPackFiles[lootPath]) {
      push('loot-tables', mobId, 'ported', [profile?.lootEvidence ?? ''], [lootPath], 'Loot table shipped from the mod.');
    } else if (profile?.lootDetected && profile.lootEvidence) {
      const raw = readEntryText(entries, profile.lootEvidence);
      const translated = raw ? translateLootTable(raw) : null;
      if (translated) {
        behaviorPackFiles[lootPath] = translated.json;
        filesWritten.push(lootPath);
        if (ensureEntityLoot(behaviorPackFiles, path, lootPath)) filesWritten.push(path);
        const dropped = translated.droppedFunctions.length > 0 ? ` (unmapped function(s): ${translated.droppedFunctions.join(', ')})` : '';
        push('loot-tables', mobId, 'approximated', [profile.lootEvidence], [lootPath, path], `Loot table converted from ${profile.lootEvidence}${dropped}.`);
      } else {
        push('loot-tables', mobId, 'unresolved', [profile.lootEvidence], [], 'Loot evidence found but the table could not be converted to a Bedrock loot table.');
      }
    } else {
      push('loot-tables', mobId, 'unresolved', [], [], 'No loot table in the mod — the mob drops nothing.');
    }
  }

  // 2. Villager trades: convert real trade data; code-built offers are reported unsupported.
  const tradeTables: string[] = [];
  for (const tradePath of evidence.trades) {
    const raw = readEntryText(entries, tradePath);
    const translated = raw ? translateTradeTable(raw) : null;
    if (!translated) continue;
    const stem = safeFileId((tradePath.split('/').pop() ?? 'trades').replace(/\.json$/i, '')) || 'trades';
    const relPath = `trading/economy_trades/${modId}_${stem}.json`;
    behaviorPackFiles[relPath] = translated;
    filesWritten.push(relPath);
    tradeTables.push(relPath);
  }
  if (tradeTables.length > 0) {
    const table = tradeTables[0];
    for (const path of entityPaths) {
      const mobId = path.slice('entities/'.length, -'.json'.length);
      if (!TRADE_HINT.test(mobCode.get(mobId) ?? '')) continue;
      const displayName = mobId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const written = ensureTradeComponent(behaviorPackFiles, path, displayName, table);
      if (written) filesWritten.push(path);
      push('villager-trades', mobId, written ? 'approximated' : 'unresolved', [evidence.trades[0]], written ? [table, path] : [table], written ? `Trade table bound to the mob from ${evidence.trades[0]}.` : 'Trade table converted but the entity already declares one.');
    }
  } else if (evidence.trades.length > 0) {
    push('villager-trades', 'all', 'unresolved', evidence.trades.slice(0, 2), [], 'Trade data found but its structure is not convertible to a Bedrock economy trade table.');
  } else if (TRADE_HINT.test(evidence.allText)) {
    pushUnsupported('villager-trades', 'all', 'Villager offers are built in Java code and the mod ships no data-driven trade table to convert.', 'mod code');
  }

  // 3. Items, projectiles and blocks: reuse the evidence-backed item profiles.
  for (const item of items) {
    const profile = item.behaviorProfile;
    const confidence = profile?.confidence ?? 'unresolved';
    const kind = profile?.kind ?? 'unresolved';
    const domain: BehaviorDomain = kind === 'projectile' || kind === 'spell'
      ? 'projectiles'
      : item.category === 'block' ? 'custom-blocks' : 'custom-items';
    const status: BehaviorTranslationStatus = confidence === 'bytecode-signature' || confidence === 'data-signature'
      ? 'ported'
      : confidence === 'type-default' ? 'fallback' : 'unresolved';
    const blockstate = item.category === 'block' ? findBlockstateEvidence(evidence, item.id) : null;
    const domainStatus: BehaviorTranslationStatus = item.category === 'block' && blockstate ? 'ported' : status;
    push(
      domain,
      item.id,
      domainStatus,
      [...(profile?.evidence ?? []), blockstate ?? ''],
      [profile?.behaviorComponent ?? '', blockstate ? 'blocks/ definition + blockstate geometry' : ''],
      profile?.note ?? (item.category === 'block' && blockstate
        ? `Blockstate recovered from ${blockstate}; geometry and collision generated from it.`
        : 'No behaviour or blockstate evidence for this entry.'),
    );
    const cooldownTicks = profile?.cooldownTicks ?? 0;
    if (cooldownTicks > 0) {
      push('timers-cooldowns', item.id, 'ported', profile?.evidence ?? [], [`minecraft:cooldown ${(cooldownTicks / 20).toFixed(2)}s`], 'Item cooldown converted from the detected cooldown value.');
    }
    if (kind === 'storage') {
      push('inventory', item.id, 'approximated', profile?.evidence ?? [], ['minecraft:inventory-bearing item'], 'Container item mapped to a Bedrock storage component.');
    }
    if (kind === 'armor') {
      push('equipment', item.id, 'approximated', profile?.evidence ?? [], ['minecraft:wearable + attachable'], 'Wearable mapped to a Bedrock equipment slot with armour attachable binding.');
    }
    if (detectEffectLogic((profile?.evidence ?? []).join(' '))) {
      pushUnsupported('effects', item.id, 'The item applies a mob/status effect in Java. Bedrock has no data-driven apply-effect item component, so the effect itself was not generated.', profile?.evidence?.[0] ?? item.id);
    }
  }

  // 3a. Item behaviour OUTPUT: evidence-backed components are written into the shipped item
  // definitions, and projectile/spell use triggers are registered in a shipped script module.
  const itemComponents = applyItemBehaviorComponents(behaviorPackFiles, items);
  for (const path of itemComponents.files) filesWritten.push(path);
  for (const component of itemComponents.components) {
    push(
      'custom-items',
      component.item,
      'approximated',
      ['item behaviour evidence'],
      [component.file, component.component],
      `${component.component} written into the shipped item definition from the item's own behaviour evidence.`,
    );
  }
  const scriptEmission = emitItemBehaviorScript(behaviorPackFiles, modId, items);
  for (const path of scriptEmission.scriptFiles) filesWritten.push(path);
  for (const binding of scriptEmission.bindings) {
    push(
      'projectiles',
      binding.itemId,
      binding.approximated ? 'approximated' : 'ported',
      [binding.evidence],
      [`items/${binding.itemId}.json`, 'scripts/behaviors.js'],
      `${binding.note} The trigger runs in the shipped script module and is untested in game.`,
    );
  }
  for (const skipped of scriptEmission.skipped) {
    pushUnsupported('projectiles', skipped.item, skipped.reason, 'item bytecode');
  }

  // 3b. Per-block interaction hooks: every imported block is inspected through its own
  // blockstate file and its own class, so no blanket "blocks are unsupported" claim is made.
  const blockItems = items.filter((item) => item.category === 'block');
  for (const block of blockItems) {
    const blockPath = `blocks/${block.id}.json`;
    if (!behaviorPackFiles[blockPath]) continue;
    const blockstate = findBlockstateEvidence(evidence, block.id);
    const signals = detectBlockInteraction(textForIdentifier(evidence, block.id));
    const emitted: string[] = [];
    if (signals.place) {
      const event = `${modId}:${block.id}_placed_hook`;
      if (ensureBlockTrigger(behaviorPackFiles, blockPath, 'minecraft:on_player_placing', event)) emitted.push(`minecraft:on_player_placing → ${event}`);
    }
    if (signals.destroy) {
      const event = `${modId}:${block.id}_destroyed_hook`;
      if (ensureBlockTrigger(behaviorPackFiles, blockPath, 'minecraft:on_player_destroyed', event)) emitted.push(`minecraft:on_player_destroyed → ${event}`);
    }
    if (emitted.length > 0) {
      filesWritten.push(blockPath);
      push('block-interaction', block.id, 'fallback', [blockstate ?? 'block class', 'placement/destruction hook'], [blockPath, ...emitted], 'Block trigger hook emitted as SCAFFOLD structure; the Java handler body is not data-driven in Bedrock.');
    }
    if (signals.interact) {
      pushUnsupported('block-interaction', block.id, 'Java right-click/activate hooks need per-block scripting; the generated block ships no data-driven interact component.', blockstate ?? 'mod code');
    }
    if (emitted.length === 0 && !signals.interact) {
      push('block-interaction', block.id, 'unresolved', blockstate ? [blockstate] : [], [], 'No placement, destruction or interaction hook in the mod\'s own block class — no block event was generated.');
    }
    if (signals.container) {
      pushUnsupported('inventory', block.id, 'Container block logic detected. Bedrock blocks have no data-driven container inventory, so no inventory component was generated.', blockstate ?? 'mod code');
    }
  }

  if (evidence.attributes.length > 0) {
    push('health-attributes', 'all', 'approximated', evidence.attributes.slice(0, 2), ['minecraft:health / movement values'], 'Data-driven attribute files detected and mapped onto entity components.');
  }

  // 4. Recipes, particles, sounds and world generation.
  const shippedRecipes = Object.keys(behaviorPackFiles).filter((key) => key.startsWith('recipes/') && key.endsWith('.json'));
  if (recipeStats) {
    if (recipeStats.converted > 0) {
      push('recipes', 'all', 'ported', evidence.recipes.slice(0, 2), shippedRecipes.slice(0, 2), `${recipeStats.converted} Java recipe(s) converted 1:1 into ${shippedRecipes.length} shipped recipe file(s).`);
    }
    if (recipeStats.fallback > 0) {
      push('recipes', 'all', 'fallback', [], shippedRecipes.slice(0, 2), `${recipeStats.fallback} contextual fallback recipe(s) generated — not derived from the mod.`);
    }
    if (recipeStats.converted === 0 && recipeStats.fallback === 0) {
      push('recipes', 'all', 'unresolved', [], [], 'No recipes in the mod and none generated.');
    }
    if (recipeStats.unresolved.length > 0) {
      push('recipes', 'unresolved-ingredients', 'unresolved', recipeStats.unresolved.slice(0, 4), [], `${recipeStats.unresolved.length} ingredient(s) could not be resolved to a Bedrock identifier.`);
    }
  }

  // Every claim below is checked against the files that really shipped, not against the
  // archive alone: a path the pipeline saw is not proof of an emitted definition.
  const shippedParticles = Object.keys(resourcePackFiles).filter((key) => key.startsWith('particles/') && key.endsWith('.json'));
  if (evidence.particles.length > 0) {
    if (shippedParticles.length > 0) {
      push('particles', 'all', 'ported', evidence.particles.slice(0, 2), shippedParticles.slice(0, 2), `${evidence.particles.length} particle asset(s) recovered; ${shippedParticles.length} Bedrock particle definition(s) shipped.`);
    } else {
      push('particles', 'all', 'unresolved', evidence.particles.slice(0, 2), [], `${evidence.particles.length} particle asset(s) found but no particle definition shipped — UNRESOLVED.`);
    }
  } else {
    push('particles', 'all', 'unresolved', [], [], 'No particle definitions in the mod — theme particles are withheld unless playable mode is on.');
  }

  const shippedAudio = Object.keys(resourcePackFiles).filter((key) => key.startsWith('sounds/') && /\.(ogg|wav|mp3)$/i.test(key));
  const shippedSoundDefs = Boolean(resourcePackFiles['sounds/sound_definitions.json']);
  if (evidence.sounds.length > 0 && shippedAudio.length > 0) {
    push('sounds', 'all', 'ported', evidence.sounds.slice(0, 2), ['sounds/sound_definitions.json', `${shippedAudio.length} audio file(s)`], `${evidence.sounds.length} sound asset(s)/definition(s) found; ${shippedAudio.length} audio file(s) registered as real Bedrock events.`);
  } else if (evidence.sounds.length > 0) {
    push('sounds', 'all', 'unresolved', evidence.sounds.slice(0, 2), shippedSoundDefs ? ['sounds/sound_definitions.json'] : [], 'Sound assets found but no audio file shipped — entity sounds stay on vanilla events.');
  } else {
    push('sounds', 'all', 'fallback', [], shippedSoundDefs ? ['sounds/sound_definitions.json (vanilla events)'] : [], 'No audio files in the mod — entity sounds reuse vanilla events (structure only).');
  }

  // 4b. World generation: biomes, features, structures and dimensions are parsed and
  // classified one by one. Only representations Bedrock really supports are written.
  const worldgen = portWorldGeneration({ entries, behaviorPackFiles, onLog });
  for (const path of worldgen.filesWritten) filesWritten.push(path);
  for (const definition of worldgen.definitions) {
    const label = definition.sourcePath.split('/').pop() ?? definition.sourcePath;
    if (definition.status === 'unsupported') {
      pushUnsupported('worldgen', label, definition.reason, definition.sourcePath);
      continue;
    }
    push(
      'worldgen',
      label,
      definition.status === 'unresolved' ? 'unresolved' : 'approximated',
      [definition.sourcePath],
      definition.outputs,
      definition.reason,
    );
  }

  const useLogicItems = items.filter((item) => {
    const kind = item.behaviorProfile?.kind;
    return kind === 'melee' || kind === 'projectile' || kind === 'spell';
  });
  if (useLogicItems.length > 0) {
    const runtimeBound = scriptEmission.scriptFiles.length > 0;
    const componentCount = itemComponents.components.length;
    push(
      'item-interaction',
      'all',
      runtimeBound || componentCount > 0 ? 'approximated' : 'unresolved',
      useLogicItems.slice(0, 2).map((item) => item.id),
      [
        ...(runtimeBound ? ['scripts/behaviors.js'] : []),
        ...(componentCount > 0 ? [`${componentCount} evidence-derived item component(s)`] : []),
      ],
      runtimeBound
        ? `${useLogicItems.length} item(s) carry use logic; the shipped script module handles the runtime triggers and ${componentCount} item component(s) were written from evidence.`
        : `${useLogicItems.length} item(s) carry use logic but no Bedrock item component or runtime trigger binding could be generated from the available evidence.`,
    );
  }

  // 5. A failed upstream stage blocks dependent success claims: the pack those claims would
  // point at was never completed, so nothing is reported as ported.
  if (stageFailed) {
    for (const finding of findings) {
      if (finding.status !== 'ported' && finding.status !== 'approximated') continue;
      finding.status = 'unresolved';
      finding.provenance = 'ABSENT';
      finding.note = `${finding.note} Blocked: an upstream pipeline stage failed, so this mapping is not reported as converted.`.trim();
    }
  }

  // 6. Traceability gate: no ported/approximated claim without a shipped file behind it.
  const unverifiedClaims = verifyFindings(behaviorPackFiles, findings);

  const byDomain = new Map<BehaviorDomain, ComponentProvenance[]>();
  for (const finding of findings) {
    const list = byDomain.get(finding.domain) ?? [];
    list.push(finding.provenance);
    byDomain.set(finding.domain, list);
  }
  const domainCounts: Partial<Record<BehaviorDomain, CategoryCounts>> = {};
  for (const [domain, values] of byDomain) domainCounts[domain] = countsFromProvenance(values);
  const totals = sumCounts(Object.values(domainCounts));
  const emitted = Array.from(new Set(filesWritten));
  const verifiedClaims = findings.filter((finding) => finding.verified).length;

  const report: BehaviorTranslationReport = {
    playableMode,
    entitiesAnalyzed: entityPaths.length,
    itemsAnalyzed: items.length,
    findings,
    unsupported,
    domainCounts,
    totals,
    filesWritten: emitted,
    emittedFileCount: emitted.length,
    unverifiedClaims,
    stageFailed: Boolean(stageFailed),
    worldgen,
    summary: `${findings.length} behaviour mapping(s) across ${byDomain.size} domain(s): ${totals.ported} ported, ${totals.approximated} approximated, ${totals.fallback} fallback, ${totals.unresolved} unresolved, ${unsupported.length} unsupported mechanic(s). ${emitted.length} behaviour file(s) emitted, ${verifiedClaims} mapping(s) traceable to a shipped file, ${unverifiedClaims} downgraded because nothing shipped for them. Structural reconstruction only — in-game behaviour has not been tested.`,
  };

  onLog?.(`[BEHAVIOR-TRANSLATION] ${report.summary}`);
  onLog?.(`[BEHAVIOR-TRANSLATION] Emitted ${emitted.length} behaviour file(s): ${emitted.slice(0, 6).join(', ') || 'none'}.`);
  if (unverifiedClaims > 0) {
    onLog?.(`[BEHAVIOR-TRANSLATION] ${unverifiedClaims} mapping(s) claimed output that no shipped file backs — reported UNRESOLVED instead of ported.`);
  }
  if (itemComponents.components.length > 0) {
    onLog?.(`[BEHAVIOR-TRANSLATION] ${itemComponents.components.length} item component(s) written from item behaviour evidence: ${itemComponents.components.slice(0, 4).map((component) => `${component.item}/${component.component}`).join(', ')}.`);
  }
  if (scriptEmission.scriptFiles.length > 0) {
    onLog?.(`[BEHAVIOR-TRANSLATION] ${scriptEmission.bindings.length} runtime trigger binding(s) registered in ${scriptEmission.scriptFiles[0]} (untested in game).`);
  }
  onLog?.(`[BEHAVIOR-TRANSLATION:WORLDGEN] ${worldgen.summary}`);
  for (const item of unsupported.slice(0, 6)) {
    onLog?.(`[BEHAVIOR-TRANSLATION:UNSUPPORTED] ${item.domain} / ${item.target} — ${item.reason}`);
  }
  if (unsupported.length > 6) {
    onLog?.(`[BEHAVIOR-TRANSLATION:UNSUPPORTED] ${unsupported.length - 6} further unsupported mechanism(s) not listed.`);
  }

  return report;
}