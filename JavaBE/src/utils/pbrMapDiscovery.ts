/**
 * Universal PBR channel-map discovery.
 *
 * Java resource packs and Iris/OptiFine shader packs store physically-based material data
 * in sibling images named after their colour sheet. The conventions are the same across
 * every mod and pack, so discovery here is naming-convention driven and never keyed to a
 * specific mod, folder or texture name: any archive that follows a convention is picked up.
 */

import type { ExtractedZipEntry } from '@/utils/zip';
import { textureTail, toBedrockTexturePath } from '@/utils/textureMetadata';

export type PbrChannel = 'normal' | 'mer' | 'specular' | 'emissive' | 'height';

export interface PbrMapCandidate {
  channel: PbrChannel;
  /** Path inside the imported archive. */
  sourcePath: string;
  data: Uint8Array;
  /** Bedrock path (no extension) of the colour sheet this map belongs to. */
  baseTexture: string;
  /** Which naming convention matched. */
  convention: string;
}

export interface PbrDiscovery {
  candidates: PbrMapCandidate[];
  inspectedPngs: number;
  ignored: string[];
  conventions: string[];
}

interface ChannelRule {
  channel: PbrChannel;
  suffix: RegExp;
  convention: string;
}

/** Longest suffixes first so `_normalmap` never degrades to `_n`. */
const CHANNEL_RULES: ChannelRule[] = [
  { channel: 'mer', suffix: /(?:[_\-.])(?:metalness_emissive_roughness|mer)$/i, convention: 'pre-packed Bedrock MER sheet (_mer)' },
  { channel: 'normal', suffix: /(?:[_\-.])(?:normalmap|normal_map|normal|normals|nrm|n)$/i, convention: 'normal map (_n / _normal / _normalmap)' },
  { channel: 'specular', suffix: /(?:[_\-.])(?:specularmap|specular|smoothness|roughness|metalness|metallic|spec|sg|s)$/i, convention: 'specular / roughness / metalness sheet (_s / _specular / _roughness / _mer channel)' },
  { channel: 'emissive', suffix: /(?:[_\-.])(?:emissivemap|emissive|emission|emit|glow|e)$/i, convention: 'emissive sheet (_e / _emissive / _glow)' },
  { channel: 'height', suffix: /(?:[_\-.])(?:heightmap|height|displacement|parallax|bump|hgt|h)$/i, convention: 'height / parallax sheet (_h / _height / _heightmap)' },
];

/** UI, font and shader-stage folders never hold material maps. */
const IGNORED_PATH = /(?:^|\/)(?:shaders|ui|font|gui|misc|colormap|painting|environment)\/|\.mcmeta$/i;

export function discoverPbrMaps(entries: ExtractedZipEntry[]): PbrDiscovery {
  const candidates: PbrMapCandidate[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  let inspectedPngs = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const path = entry.path.replace(/\\/g, '/');
    if (!/\.png$/i.test(path)) continue;
    inspectedPngs += 1;
    if (IGNORED_PATH.test(path)) {
      if (ignored.length < 20) ignored.push(path);
      continue;
    }
    const tail = textureTail(path);
    if (!tail || tail.length < 2) continue;
    const rule = CHANNEL_RULES.find((entryRule) => entryRule.suffix.test(tail));
    if (!rule) continue;
    const baseTail = tail.replace(rule.suffix, '');
    if (!baseTail || baseTail === tail) continue;
    const baseTexture = toBedrockTexturePath(baseTail);
    const key = `${baseTexture}|${rule.channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      channel: rule.channel,
      sourcePath: path,
      data: entry.data,
      baseTexture,
      convention: rule.convention,
    });
  }

  return {
    candidates,
    inspectedPngs,
    ignored,
    conventions: CHANNEL_RULES.map((rule) => rule.convention),
  };
}