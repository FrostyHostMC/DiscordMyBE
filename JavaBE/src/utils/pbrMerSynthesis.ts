/**
 * Bedrock Deferred-material synthesis.
 *
 * Bedrock's deferred pipeline reads one packed sheet — `metalness_emissive_roughness`
 * (red = metalness, green = emissive, blue = roughness) — while Java packs keep those
 * channels in separate images using different channel layouts. Copying a Java specular
 * sheet into that slot would silently swap roughness for smoothness, so the channels are
 * re-encoded here and every derivation is reported instead of assumed.
 */

import { decodePngRgba, encodePngRgba, resampleRgba, type RgbaImage } from '@/utils/pngCodec';

export interface MerSynthesisInput {
  /** The shipped colour sheet; its dimensions define the output sheet. */
  color: Uint8Array | null;
  specular?: Uint8Array | null;
  emissive?: Uint8Array | null;
}

export interface MerSynthesisResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  roughnessSource: string;
  metalnessSource: string;
  emissiveSource: string;
  note: string;
}

const luminance = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

function minAlpha(image: RgbaImage): number {
  let min = 255;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] < min) min = image.data[i];
    if (min === 0) break;
  }
  return min;
}

export async function synthesizeMerSheet(input: MerSynthesisInput): Promise<MerSynthesisResult | null> {
  const color = await decodePngRgba(input.color);
  const specular = input.specular ? await decodePngRgba(input.specular) : null;
  const emissive = input.emissive ? await decodePngRgba(input.emissive) : null;

  const reference = color ?? emissive ?? specular;
  if (!reference) return null;
  const width = reference.width;
  const height = reference.height;
  if (!width || !height) return null;

  const spec = specular ? resampleRgba(specular, width, height) : null;
  const glow = emissive ? resampleRgba(emissive, width, height) : null;

  // A Java specular sheet keeps smoothness in the alpha channel (OptiFine/LabPBR style).
  // When the alpha channel is fully opaque the greyscale body is the only signal left.
  const alphaCarriesSmoothness = spec ? minAlpha(spec) < 250 : false;

  const sheet = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const at = i * 4;
    let roughness = 255;
    if (spec) {
      if (alphaCarriesSmoothness) {
        roughness = 255 - spec.data[at + 3];
      } else {
        const smoothness = luminance(spec.data[at], spec.data[at + 1], spec.data[at + 2]);
        roughness = 255 - smoothness;
      }
    }
    const emissiveValue = glow
      ? Math.round((luminance(glow.data[at], glow.data[at + 1], glow.data[at + 2]) * glow.data[at + 3]) / 255)
      : 0;
    sheet[at] = 0; // metalness
    sheet[at + 1] = emissiveValue; // emissive
    sheet[at + 2] = roughness; // roughness
    sheet[at + 3] = 255;
  }

  const bytes = await encodePngRgba({ width, height, data: sheet });
  if (!bytes) return null;

  const roughnessSource = spec
    ? alphaCarriesSmoothness
      ? 'Java specular alpha channel (smoothness) inverted to roughness'
      : 'Java specular greyscale luminance inverted to roughness'
    : 'no specular sheet in the source pack — roughness left fully rough so no shininess is invented';
  const emissiveSource = glow
    ? 'Java emissive sheet luminance moved into the green channel'
    : 'no emissive sheet in the source pack — emissive left at 0';
  const metalnessSource =
    'Java sheets declare no Bedrock-layout metalness channel — metalness left at 0 rather than guessed';

  return {
    bytes,
    width,
    height,
    roughnessSource,
    metalnessSource,
    emissiveSource,
    note: `MER sheet rebuilt at ${width}x${height}: ${roughnessSource}; ${emissiveSource}; ${metalnessSource}. Channel order is converted, not copied — review the surface in a Deferred-capable client before shipping.`,
  };
}