import type JSZip from 'jszip';

/**
 * Port of AutoBE Part 16 player-entity passes (_process_packs post-merge fixes):
 * slot sanitization, entity-context query relocation, vanilla animation alias
 * backfill and animate/render-controller deduplication. Unknown references are
 * reported; this pass must not invent animation or Molang-variable fallbacks.
 */

export const VANILLA_PLAYER_ANIMS: Record<string, string> = {
  root: 'controller.animation.player.root',
  move: 'animation.player.move',
  'riding.arms': 'animation.player.riding.arms',
  'riding.legs': 'animation.player.riding.legs',
  holding: 'animation.player.holding',
  brandish_spear: 'animation.player.brandish_spear',
  holding_spyglass: 'animation.player.holding_spyglass',
  charging: 'animation.player.charging',
  'attack.positions': 'animation.player.attack.positions',
  'attack.rotations': 'animation.player.attack.rotations',
  sneaking: 'animation.player.sneaking',
  crouch: 'animation.player.sneaking',
  bob: 'animation.player.bob',
  damage_nearby_mobs: 'animation.player.damage_nearby_mobs',
  fishing_rod: 'animation.player.fishing_rod',
  swimming: 'animation.player.swimming',
  'swimming.legs': 'animation.player.swimming.legs',
  use_item_progress: 'animation.player.use_item_progress',
  skeleton_attack: 'animation.player.skeleton_attack',
  sleeping: 'animation.player.sleeping',
  cape: 'animation.player.cape',
  first_person_base_pose: 'animation.player.first_person_base_pose',
  first_person_empty_hand: 'animation.player.first_person_empty_hand',
  first_person_swap_item: 'animation.player.first_person_swap_item',
  first_person_attack_controller: 'controller.animation.player.first_person_attack',
  first_person_map_controller: 'controller.animation.player.first_person_map',
  first_person_crossbow_equipped: 'animation.player.first_person_crossbow_equipped',
  first_person_breathing_bob: 'animation.player.first_person_breathing_bob',
  third_person_bow: 'animation.player.third_person_bow',
  third_person_crossbow: 'animation.player.third_person_crossbow',
  third_person_die: 'animation.player.third_person_die',
  third_person_map_controller: 'controller.animation.player.third_person_map',
  blink: 'controller.animation.player.blink',
  totem_animation: 'animation.player.totem',
  totem_controller: 'controller.animation.player.totem',
  look_at_target_ui: 'animation.player.look_at_target.ui',
  look_at_target_default: 'animation.player.look_at_target.default',
  look_at_target_gliding: 'animation.player.look_at_target.gliding',
  look_at_target_swimming: 'animation.player.look_at_target.swimming',
  look_at_target_inverted: 'animation.player.look_at_target.inverted'
};

const ENTITY_CTX_QUERIES = [
  'query.is_item_name_any',
  'query.is_item_any_tag',
  'query.equipped_item_any_tag',
  'query.property(',
  'query.has_equippable(',
  'query.get_equipped_item_name('
];

const BAD_SLOTS: Array<[string, string]> = [
  ["'slot.mainhand'", "'slot.weapon.mainhand'"],
  ['"slot.mainhand"', '"slot.weapon.mainhand"'],
  ["'slot.offhand'", "'slot.weapon.offhand'"],
  ['"slot.offhand"', '"slot.weapon.offhand"']
];

function descOf(playerEntity: any): any {
  return playerEntity?.['minecraft:client_entity']?.description ?? {};
}

/** 1. Sanitize known-bad Molang slot names in initialize/pre_animation. */
function sanitizeSlots(playerEntity: any): void {
  const desc = descOf(playerEntity);
  for (const blk of ['initialize', 'pre_animation']) {
    const list = desc.scripts?.[blk];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string') {
        for (const [bad, good] of BAD_SLOTS) list[i] = list[i].replaceAll(bad, good);
      }
    }
  }
}

/** 2. Move entity-context queries out of initialize into pre_animation. */
function moveEntityCtxQueries(playerEntity: any): void {
  const desc = descOf(playerEntity);
  desc.scripts = desc.scripts ?? {};
  const initRaw = desc.scripts.initialize;
  const init = Array.isArray(initRaw) ? [...initRaw] : [];
  const pre = Array.isArray(desc.scripts.pre_animation) ? desc.scripts.pre_animation : [];
  desc.scripts.pre_animation = pre;
  const keep: string[] = [];
  const move: string[] = [];
  for (const expr of init) {
    if (typeof expr === 'string' && ENTITY_CTX_QUERIES.some((q) => expr.includes(q))) move.push(expr);
    else keep.push(expr);
  }
  if (move.length > 0) {
    desc.scripts.initialize = keep;
    const existing = pre.map(String).join(' ');
    for (const mv of move) if (!existing.includes(mv)) pre.push(mv);
  }
}

/** 3. Backfill vanilla animation aliases so short names always resolve. */
function backfillVanillaAnims(playerEntity: any): void {
  const desc = descOf(playerEntity);
  if (typeof desc.animations !== 'object' || desc.animations === null || Array.isArray(desc.animations)) {
    desc.animations = {};
  }
  for (const [alias, animId] of Object.entries(VANILLA_PLAYER_ANIMS)) {
    if (!(alias in desc.animations)) desc.animations[alias] = animId;
  }
}

/** 4. Deduplicate scripts.animate by name (dict-with-condition beats plain string). */
function dedupeAnimateBlock(playerEntity: any): void {
  const scripts = descOf(playerEntity).scripts;
  const animateBlock = scripts?.animate;
  if (!Array.isArray(animateBlock)) return;
  const seen = new Map<string, unknown>();
  for (const entry of animateBlock) {
    if (typeof entry === 'string') {
      if (!seen.has(entry)) seen.set(entry, entry);
    } else if (entry && typeof entry === 'object') {
      const key = Object.keys(entry)[0];
      if (key) seen.set(key, entry);
    }
  }
  scripts.animate = [...seen.values()];
}

/** 6. Deduplicate render_controllers by name (first occurrence wins). */
function dedupeRenderControllers(playerEntity: any): void {
  const desc = descOf(playerEntity);
  const list = desc.render_controllers;
  if (!Array.isArray(list)) return;
  const seen = new Map<string, unknown>();
  for (const entry of list) {
    if (entry && typeof entry === 'object') {
      const key = Object.keys(entry)[0];
      if (key && !seen.has(key)) seen.set(key, entry);
    } else if (typeof entry === 'string' && !seen.has(entry)) {
      seen.set(entry, entry);
    }
  }
  desc.render_controllers = [...seen.values()];
}

/** Apply all post-merge fixes to a merged client-entity player definition. */
export function applyPlayerEntityFixes(playerEntity: any): any {
  sanitizeSlots(playerEntity);
  moveEntityCtxQueries(playerEntity);
  backfillVanillaAnims(playerEntity);
  dedupeAnimateBlock(playerEntity);
  dedupeRenderControllers(playerEntity);
  return playerEntity;
}

/**
 * Scan all player animation/controller JSON files in the zip for Molang
 * variables that are used (variable.X) so callers can inject initializers.
 */
export async function collectUndefinedAnimVars(zip: JSZip): Promise<Set<string>> {
  const used = new Set<string>();
  const jobs: Promise<void>[] = [];
  zip.forEach((path, f) => {
    if (f.dir || !path.toLowerCase().endsWith('.json')) return;
    const lower = path.toLowerCase();
    const isPlayerAnim =
      (lower.includes('animation_controllers') && lower.includes('player')) ||
      (lower.includes('animations') && lower.includes('player') && !lower.endsWith('_controllers.json'));
    if (!isPlayerAnim) return;
    jobs.push(
      f
        .async('text')
        .then((txt) => {
          for (const m of txt.matchAll(/variable\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) used.add(m[1]);
        })
        .catch(() => undefined)
    );
  });
  await Promise.all(jobs);
  return used;
}

/** Find referenced Molang variables without an explicit entity-script initializer. */
export function findUninitializedAnimVars(playerEntity: any, usedVars: Set<string>): string[] {
  const scripts = descOf(playerEntity).scripts ?? {};
  const existing = [
    ...(Array.isArray(scripts.initialize) ? scripts.initialize : []),
    ...(Array.isArray(scripts.pre_animation) ? scripts.pre_animation : []),
  ].filter((entry): entry is string => typeof entry === 'string').join(' ');
  const assigned = new Set<string>();
  for (const match of existing.matchAll(/variable\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g)) assigned.add(match[1]);
  return [...usedVars].filter((name) => !assigned.has(name)).sort();
}

export interface PlayerEntityDiagnostic {
  severity: 'warning' | 'error';
  code: 'missing_animate_alias' | 'uninitialized_molang_variable' | 'missing_player_entity' | 'invalid_player_entity_json';
  message: string;
  reference?: string;
}

function diagnosePlayerEntity(playerEntity: any, usedVars: Set<string>): PlayerEntityDiagnostic[] {
  const desc = descOf(playerEntity);
  const diagnostics: PlayerEntityDiagnostic[] = [];
  const animations = desc.animations ?? {};
  const animateBlock = desc.scripts?.animate;
  if (Array.isArray(animateBlock)) {
    for (const entry of animateBlock) {
      const alias = typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? Object.keys(entry)[0]
          : null;
      if (alias && !(alias in animations)) {
        diagnostics.push({
          severity: 'error',
          code: 'missing_animate_alias',
          reference: alias,
          message: `scripts.animate references missing animation/controller alias "${alias}". AutoBE did not substitute a different animation.`,
        });
      }
    }
  }
  for (const name of findUninitializedAnimVars(playerEntity, usedVars)) {
    diagnostics.push({
      severity: 'warning',
      code: 'uninitialized_molang_variable',
      reference: `variable.${name}`,
      message: `Molang variable "${name}" is referenced but has no explicit initializer in player entity scripts. AutoBE did not guess a default value.`,
    });
  }
  return diagnostics;
}

const PLAYER_ENTITY_PATHS = ['entity/player.entity.json', 'entity/player.json'];

/**
 * Full RP-side player pass. Returns diagnostics instead of inventing fallback
 * animations, zero-valued Molang variables, or a minimal replacement player entity.
 */
export async function applyPlayerEntityPass(rpZip: JSZip): Promise<PlayerEntityDiagnostic[]> {
  const usedVars = await collectUndefinedAnimVars(rpZip);
  const diagnostics: PlayerEntityDiagnostic[] = [];
  let playerFile: string | null = null;
  let playerEntity: any = null;
  for (const path of PLAYER_ENTITY_PATHS) {
    const file = rpZip.file(path);
    if (!file) continue;
    try {
      playerEntity = JSON.parse(await file.async('text'));
      playerFile = path;
      break;
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'invalid_player_entity_json',
        reference: path,
        message: `Player entity file "${path}" could not be parsed; AutoBE did not replace it with a stub.`,
      });
    }
  }
  if (!playerEntity) {
    if (usedVars.size > 0) diagnostics.push({
      severity: 'error',
      code: 'missing_player_entity',
      message: 'Player animation files reference Molang variables but no valid player client-entity definition exists. AutoBE did not generate a replacement player entity.',
    });
    return diagnostics;
  }

  applyPlayerEntityFixes(playerEntity);
  diagnostics.push(...diagnosePlayerEntity(playerEntity, usedVars));
  rpZip.file(playerFile!, JSON.stringify(playerEntity, null, 2));
  return diagnostics;
}
