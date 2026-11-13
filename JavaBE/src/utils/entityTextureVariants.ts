import { readPngHeader } from '@/utils/textureMetadata';

/**
 * Entity texture + geometry variant discovery.
 *
 * A Java mod can ship several body sheets for one mob (`<mob>/<mob>.png`,
 * `<mob>/<mob>_angry.png`, `<mob>_variant2.png`). Those are real texture variants and
 * are registered so a render controller can select them. Material channel maps
 * (emissive / normal / metalness / height) and overlays are NOT variants — binding one
 * as a body sheet smears a channel map across every cube.
 */

export type PackFile = string | Uint8Array;

export interface EntityTextureVariant {
  /** Descriptor key inside the client entity (`variant_1`, `variant_2`, …). */
  key: string;
  /** Texture path without the `.png` extension. */
  path: string;
  /** Source suffix used in logs. */
  label: string;
  width: number;
  height: number;
}

const CHANNEL_OR_LAYER =
  /(^|_)(armor|armour|layer|overlay|outer|inner|emissive|glow|normal|mer|metalness|roughness|height|heightmap|saddle|harness|hitbox|hit_box|shadow|icon|gui|ui|item|sheared|tame|sitting|sitting_alt)(_|$)/;

const MAX_VARIANTS = 8;

function stem(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Registers the base sheet plus every genuine body-sheet variant that shipped. */
export function discoverEntityTextureVariants(
  files: Record<string, PackFile>,
  mobId: string,
): { base: string | null; variants: EntityTextureVariant[] } {
  const prefix = `textures/entity/${mobId}`;
  const base =
    [`${prefix}`, `${prefix}/${mobId}`].find((path) => Boolean(files[`${path}.png`])) ?? null;
  const variants: EntityTextureVariant[] = [];
  const seen = new Set<string>([base ?? '']);

  for (const path of Object.keys(files).sort()) {
    if (variants.length >= MAX_VARIANTS) break;
    if (!path.startsWith('textures/entity/') || !path.endsWith('.png')) continue;
    const ref = path.slice(0, -4);
    if (seen.has(ref)) continue;
    let suffix = '';
    if (ref.startsWith(`${prefix}/`)) suffix = ref.slice(prefix.length + 1);
    else if (ref.startsWith(`${prefix}_`)) suffix = ref.slice(prefix.length + 1);
    if (!suffix || suffix.includes('/')) continue;
    // The mirrored `<mob>/<mob>.png` copy and channel maps are not variants.
    if (suffix === mobId || suffix === stem(base ?? '')) continue;
    if (CHANNEL_OR_LAYER.test(suffix.toLowerCase())) continue;
    const header = readPngHeader(files[path] as Uint8Array | undefined);
    if (!header || header.width < 8 || header.height < 8) continue;
    // A vertical frame strip is an animated sheet, never a body variant.
    if (header.height > header.width) continue;
    if (base && path === `${base}.png`) continue;
    seen.add(ref);
    variants.push({
      key: `variant_${variants.length + 1}`,
      path: ref,
      label: suffix,
      width: header.width,
      height: header.height,
    });
  }

  return { base, variants };
}

/** Sibling emissive/glow map shipped next to a body sheet, if the mod has one. */
export function findEmissiveSibling(
  files: Record<string, PackFile>,
  base: string | null,
): string | null {
  if (!base) return null;
  for (const suffix of ['_emissive', '_glow', '_e']) {
    const candidate = `${base}${suffix}`;
    if (files[`${candidate}.png`]) return candidate;
  }
  return null;
}