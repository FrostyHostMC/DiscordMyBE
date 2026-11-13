import type { PngHeader } from '@/utils/textureMetadata';

/**
 * Material mapping for entity geometry.
 *
 * The material is derived from the shipped skin's own PNG header and from whether an
 * emissive map actually exists — never from a mob name. Bedrock needs a cutout
 * material for any skin with an alpha channel, because the opaque `entity` material
 * renders alpha pixels as solid black.
 */

export interface EntityMaterialChoice {
  material: string;
  evidence: string;
}

/** Materials a `minecraft:client_entity` descriptor may legitimately reference. */
export const BEDROCK_ENTITY_MATERIALS = new Set([
  'entity',
  'entity_alphatest',
  'entity_alphatest_one_sided',
  'entity_alphablend',
  'entity_emissive',
  'entity_emissive_alpha',
  'entity_emissive_alpha_one_sided',
  'entity_static',
  'entity_flat',
  'entity_multitexture',
  'entity_change_color',
  'armor',
  'armor_enchanted',
  'armor_trim',
]);

export function resolveEntityMaterial(
  header: PngHeader | null,
  hasEmissive: boolean,
): EntityMaterialChoice {
  if (hasEmissive) {
    return {
      material: 'entity_emissive_alpha',
      evidence: 'emissive map ships next to the body sheet, so the alpha-capable emissive material is used',
    };
  }
  if (!header) {
    return {
      material: 'entity_alphatest',
      evidence: 'PNG header unreadable — cutout material kept so a transparent skin never renders black',
    };
  }
  if (header.hasAlpha) {
    return {
      material: 'entity_alphatest',
      evidence: `skin colour type ${header.colorType} carries an alpha channel (${header.bitDepth}-bit)${hasEmissive ? '; an emissive sheet ships but needs a texture_set, so it stays unmapped' : ''}`,
    };
  }
  return {
    material: 'entity',
    evidence: `skin colour type ${header.colorType} has no alpha channel (${header.bitDepth}-bit)`,
  };
}