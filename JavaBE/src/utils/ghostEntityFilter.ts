/**
 * Ghost Entity Filter.
 * Java mods register plenty of names that are not mobs: block entities, spell
 * projectiles, particle emitters and raw art sheets. Minting a spawn egg for one
 * of them produced an invisible biped that sampled a projectile skin inside the
 * game — the classic ghost entity artifact. Every registry path runs through this
 * single test so the rule can never drift between modules.
 */
const TECH_PREFIX =
  /^(block_?entity|tile_?entity|base_?entity|custom_?entity|abstract|dummy|hitbox|collision|marker|seat|vehicle_?seat|projectile|particle|fire_?ball|fireball|arrow_?entity|bolt_?entity|orb_?entity|beam_?entity|effect_?entity|spawner|template|placeholder|test_?entity|entity_?base|visual_?effect|event_?trigger|sub_?model|sub_?part|render_?layer)/;

/**
 * Art sheets, rigs, sub-models, layers, bones, parts, and abstract base classes
 * are referenced by a mob id but never describe a living spawnable mob.
 * e.g., `undead_base.png`, `witheria_armor`, `boss_head`, `dragon_wings` must be
 * merged into their parent entity rather than minted as standalone spawn eggs.
 */
const ART_SUFFIX =
  /(texture|overlay|overlays|sprite|model|layer|layers|outer|inner|particle|particles|projectile|projectiles|hitbox|emissive|glow|mask|base|default|mesh|rig|bones?|parts?|segments?|frames?|core|shell|carapace|head|torso|body|arm|arms|leg|legs|wing|wings|tail|tails|horn|horns|jaw|jaws|eyes?|teeth|armor|corpse|dead|death|idle|walk|attack|hurt|flinch|phase\d*|stage\d*|form\d*)$/;

/** Cast / spell names describe a projectile effect, not a living entity. */
const SPELL_TOKENS = new Set([
  'gui',
  'menu',
  'hud',
  'icon',
  'tooltip',
  'pyromancy',
  'sorcery',
  'miracle',
  'incantation',
  'spell',
  'projectile',
  'fireball',
  'magic',
  'enchantment',
]);

const TRANSIENT_EFFECT_TOKENS = new Set([
  'area', 'barrier', 'barrior', 'beam', 'bomb', 'bolt', 'bullet', 'circle', 'clash',
  'cloud', 'core', 'dust', 'effect', 'emitter', 'empty', 'explosion', 'flash', 'glint',
  'hit', 'impact', 'indicator', 'laser', 'particle', 'projectile', 'slash', 'smash',
  'spark', 'spell', 'trail', 'transparent', 'warning', 'wave', 'whoosh', 'frame',
  'event', 'trigger', 'visual', 'orb', 'shot', 'missile', 'rocket', 'fireball',
  'zone', 'burst', 'ring', 'aura', 'shockwave', 'splash', 'slice', 'swing', 'ray',
  'puff', 'smoke', 'spore', 'bubble', 'shrapnel', 'fragment', 'debris', 'shard',
]);

export function isGhostEntityName(name: string): boolean {
  const snake = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!snake) return true;
  if (TECH_PREFIX.test(snake)) return true;
  if (ART_SUFFIX.test(snake)) return true;
  const tokens = snake.split('_').filter(Boolean);
  return tokens.some(
    (token) => SPELL_TOKENS.has(token) || TRANSIENT_EFFECT_TOKENS.has(token),
  );
}