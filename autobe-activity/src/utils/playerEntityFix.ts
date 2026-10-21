/**
 * Port of AutoBE Part 16 player-entity passes (_process_packs post-merge fixes):
 * slot sanitization, entity-context query relocation, vanilla animation alias
 * backfill, animate/render-controller deduplication, and undefined animation
 * variable injection into entity/player.entity.json.
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

/** Sensible defaults for known runtime variables that must live in pre_animation. */
const RUNTIME_VARS: Record<string, string> = {
  is_holding_left: "variable.is_holding_left = !query.is_item_name_any('slot.weapon.offhand', 0, 'minecraft:air');",
  player_arm_height: 'variable.player_arm_height = 0.0;',
  short_arm_offset_left: 'variable.short_arm_offset_left = 0.0;',
  short_arm_offset_right: 'variable.short_arm_offset_right = 0.0;',
  is_horizontal_splitscreen: 'variable.is_horizontal_splitscreen = 0.0;',
  is_vertical_splitscreen: 'variable.is_vertical_splitscreen = 0.0;'
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

/** 4. Stub any animate-block short-names that are not defined. */
function stubMissingAnimateAliases(playerEntity: any): void {
  const desc = descOf(playerEntity);
  const anims = desc.animations ?? {};
  const animateBlock = desc.scripts?.animate;
  if (!Array.isArray(animateBlock)) return;
  for (const entry of animateBlock) {
    const name = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? Object.keys(entry)[0] : null;
    if (name && !(name in anims)) anims[name] = 'animation.player.move';
  }
}

/** 5. Deduplicate scripts.animate by name (dict-with-condition beats plain string). */
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
  stubMissingAnimateAliases(playerEntity);
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

/** Inject missing variable initializers into the merged player entity scripts. */
export function injectUndefinedVars(playerEntity: any, undefinedVars: Set<string>): void {
  if (undefinedVars.size === 0) return;
  const desc = descOf(playerEntity);
  desc.scripts = desc.scripts ?? {};
  const init: string[] = Array.isArray(desc.scripts.initialize) ? desc.scripts.initialize : [];
  const pre: string[] = Array.isArray(desc.scripts.pre_animation) ? desc.scripts.pre_animation : [];
  desc.scripts.initialize = init;
  desc.scripts.pre_animation = pre;
  const existing = (init.join(' ') + ' ' + pre.join(' '));
  const assigned = new Set<string>();
  for (const m of existing.matchAll(/variable\.([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g)) assigned.add(m[1]);
  for (const name of [...undefinedVars].sort()) {
    if (assigned.has(name)) continue;
    if (name in RUNTIME_VARS) pre.push(RUNTIME_VARS[name]);
    else init.push(`variable.${name} = 0.0;`);
  }
}

/** Build a minimal client-entity stub when no pack supplied a player entity. */
export function buildStubPlayerEntity(undefinedVars: Set<string>): any {
  const scripts: any = {};
  const init: string[] = [];
  const pre: string[] = [];
  for (const name of [...undefinedVars].sort()) {
    if (name in RUNTIME_VARS) pre.push(RUNTIME_VARS[name]);
    else init.push(`variable.${name} = 0.0;`);
  }
  if (init.length > 0) scripts.initialize = init;
  if (pre.length > 0) scripts.pre_animation = pre;
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: 'minecraft:player',
        animations: { ...VANILLA_PLAYER_ANIMS },
        scripts
      }
    }
  };
}

const PLAYER_ENTITY_PATHS = ['entity/player.entity.json', 'entity/player.json'];

/**
 * Full RP-side player pass: run fixes on the merged player entity (if any),
 * inject undefined animation variables, and write a stub when absent.
 */
export async function applyPlayerEntityPass(rpZip: JSZip): Promise<void> {
  const undefinedVars = await collectUndefinedAnimVars(rpZip);
  let playerFile: string | null = null;
  let playerEntity: any = null;
  for (const p of PLAYER_ENTITY_PATHS) {
    const f = rpZip.file(p);
    if (f) {
      try {
        playerEntity = JSON.parse(await f.async('text'));
        playerFile = p;
        break;
      } catch {
        // fall through to stub
      }
    }
  }
  if (playerEntity) {
    applyPlayerEntityFixes(playerEntity);
    injectUndefinedVars(playerEntity, undefinedVars);
    rpZip.file('entity/player.entity.json', JSON.stringify(playerEntity, null, 2));
    if (playerFile && playerFile !== 'entity/player.entity.json') rpZip.remove(playerFile);
  } else if (undefinedVars.size > 0) {
    rpZip.file('entity/player.entity.json', JSON.stringify(buildStubPlayerEntity(undefinedVars), null, 2));
  }
}