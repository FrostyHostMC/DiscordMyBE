import type { PackFile } from '@/utils/entityTextureVariants';
import { convertParticleDocuments } from '@/utils/particleConverter';

/**
 * Universal conformance repairs for the defect classes the Bedrock content log reports.
 *
 * Nothing here is written for one mod, one texture or one block: each rule is a schema
 * requirement of the Bedrock client that any imported Java mod can violate, and each repair is
 * derived from the file's own content.
 *
 *  1. Particle documents — a `particles/*.json` file only loads when it declares
 *     `minecraft:particle_effect`. Java ships effect-shaped documents (description/components at
 *     the root) that must be re-rooted, and sprite-declaration documents that carry no effect data
 *     at all and must not be shipped as effects. See `particleConverter`.
 *  2. Texture sets — `format_version` on a `.texture_set.json` document is validated against
 *     the texture schema, not the entity schema; an entity-era value logs
 *     "Unsupported version value in format_version field".
 *  3. Block sound types — `blocks.json` expects a Bedrock block-sound name. Java sound type
 *     names (notably the default `normal`) are not valid there and log
 *     "No sound found for block type ... and event type ...".
 */

/** Version a `minecraft:texture_set` document must declare to be read by the client. */
export const TEXTURE_SET_FORMAT_VERSION = '1.16.100';

const SUPPORTED_TEXTURE_SET_VERSIONS = new Set(['1.16.100', '1.16.200', '1.16.210', '1.16.220']);

/** Block sound names the Bedrock client accepts in `blocks.json`. */
const BEDROCK_BLOCK_SOUNDS = new Set([
  'amethyst_block', 'amethyst_cluster', 'ancient_debris', 'anvil', 'azalea', 'azalea_leaves',
  'bamboo', 'bamboo_sapling', 'bamboo_wood', 'basalt', 'big_dripleaf', 'bone_block', 'calcite',
  'candle', 'cave_vines', 'chain', 'cherry_leaves', 'cherry_wood', 'chiseled_bookshelf',
  'cloth', 'copper', 'copper_bulb', 'copper_grate', 'coral_block', 'crafter',
  'creaking_heart', 'crimson_stem', 'crop', 'decorated_pot', 'deepslate', 'dirt',
  'dripstone_block', 'froglight', 'fungus', 'glass', 'glow_lichen', 'grass', 'gravel',
  'hanging_roots', 'hard_crop', 'heavy_core', 'honey_block', 'iron', 'ladder', 'lantern',
  'large_amethyst_bud', 'leaves', 'lever', 'lily_pad', 'lodestone', 'mangrove_roots',
  'medium_amethyst_bud', 'metal', 'mob_head', 'moss_block', 'moss_carpet', 'mud',
  'mud_bricks', 'muddy_mangrove_roots', 'nether_bricks', 'nether_gold_ore', 'nether_ore',
  'nether_wart', 'netherrack', 'netherite_block', 'nylium', 'packed_mud', 'pointed_dripstone',
  'polished_deepslate', 'powder_snow', 'roots', 'sand', 'scaffolding', 'sculk',
  'sculk_catalyst', 'sculk_sensor', 'sculk_shrieker', 'sculk_vein', 'shroomlight',
  'slime', 'small_amethyst_bud', 'snow', 'soul_sand', 'soul_soil', 'spore_blossom', 'stem',
  'stone', 'suspicious_gravel', 'suspicious_sand', 'sweet_berry_bush', 'trial_spawner', 'tuff',
  'vault', 'vine', 'wart_block', 'weeping_vines', 'wet_grass', 'wood', 'wool',
]);

/** Java `SoundType` names that differ from the Bedrock block-sound name for the same feel. */
const JAVA_SOUND_ALIASES: Record<string, string> = {
  normal: 'stone',
  wool: 'cloth',
  slime_block: 'slime',
  honey: 'honey_block',
  netherite: 'netherite_block',
  amethyst: 'amethyst_block',
  coral: 'coral_block',
  deepslate_tiles: 'deepslate',
  deepslate_bricks: 'deepslate',
  copper_block: 'copper',
  cherry: 'cherry_wood',
  mushroom_stem: 'stem',
  nether_stem: 'stem',
  warped_stem: 'stem',
  crimson: 'crimson_stem',
  sand_soil: 'soul_sand',
  soul: 'soul_sand',
  glow: 'shroomlight',
  moss: 'moss_block',
  berry: 'sweet_berry_bush',
  dry_grass: 'grass',
  metal_heavy: 'metal',
  chain_link: 'chain',
};

const DEFAULT_BLOCK_SOUND = 'stone';

/** Maps any Java or Bedrock block-sound name onto a name the client accepts. */
export function mapBlockSoundType(raw: unknown): { sound: string; recognised: boolean } {
  const value = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!value) return { sound: DEFAULT_BLOCK_SOUND, recognised: false };
  if (BEDROCK_BLOCK_SOUNDS.has(value)) return { sound: value, recognised: true };
  const alias = JAVA_SOUND_ALIASES[value];
  if (alias) return { sound: alias, recognised: true };
  return { sound: DEFAULT_BLOCK_SOUND, recognised: false };
}

export interface ParticleRepairResult {
  repaired: number;
  dropped: string[];
  /** Java sprite declarations removed from particles/ — never expressible as an effect. */
  textureDeclarations: string[];
  /** Effects whose render texture was bound to a sprite the pack really ships. */
  texturesBound: string[];
  /** Effects still naming a sprite the pack does not ship (reported, not substituted). */
  unresolvedTextures: string[];
}

function parseObject(raw: PackFile | undefined): Record<string, any> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, any>;
  } catch {
    return null;
  }
}

/** 1. Every shipped particle document must satisfy the `minecraft:particle_effect` schema. */
export function repairParticleDocuments(
  files: Record<string, PackFile>,
  modId: string,
  log: (line: string) => void,
): ParticleRepairResult {
  const conversion = convertParticleDocuments(files, modId, log);
  return {
    repaired: conversion.converted.length,
    dropped: conversion.dropped,
    textureDeclarations: conversion.textureDeclarations,
    texturesBound: conversion.texturesBound,
    unresolvedTextures: conversion.unresolvedTextures,
  };
}

/** 2. `format_version` on a texture-set document must be a version the texture schema reads. */
export function repairTextureSetVersions(
  files: Record<string, PackFile>,
  log: (line: string) => void,
): number {
  let fixed = 0;
  for (const path of Object.keys(files)) {
    const lower = path.toLowerCase();
    if (!lower.startsWith('textures/') || !lower.endsWith('.json')) continue;
    const doc = parseObject(files[path]);
    if (!doc || !doc['minecraft:texture_set']) continue;
    const version = String(doc.format_version ?? '');
    if (SUPPORTED_TEXTURE_SET_VERSIONS.has(version)) continue;
    doc.format_version = TEXTURE_SET_FORMAT_VERSION;
    files[path] = JSON.stringify(doc, null, 2);
    fixed += 1;
    log(
      `[CONFORM] ${path}: texture-set format_version "${version || 'ABSENT'}" is not a version the texture schema reads — set to ${TEXTURE_SET_FORMAT_VERSION}.`,
    );
  }
  return fixed;
}

/** 3. `blocks.json` sound entries must be block-sound names the client recognises. */
export function repairBlockSoundTypes(
  files: Record<string, PackFile>,
  log: (line: string) => void,
): number {
  const doc = parseObject(files['blocks.json']);
  if (!doc) return 0;
  let fixed = 0;
  for (const [key, entry] of Object.entries(doc)) {
    if (key === 'format_version') continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const block = entry as Record<string, any>;
    if (block.sound === undefined) continue;
    const original = String(block.sound ?? '');
    const mapped = mapBlockSoundType(original);
    if (mapped.sound === original) continue;
    block.sound = mapped.sound;
    fixed += 1;
    log(
      mapped.recognised
        ? `[CONFORM] blocks.json "${key}": sound type "${original}" is a Java name — mapped to the Bedrock block sound "${mapped.sound}".`
        : `[CONFORM] blocks.json "${key}": sound type "${original}" is not a Bedrock block sound — set to the default "${mapped.sound}" (structure only, no audio invented).`,
    );
  }
  if (fixed > 0) files['blocks.json'] = JSON.stringify(doc, null, 2);
  return fixed;
}