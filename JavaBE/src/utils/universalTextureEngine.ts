import type { AssetIndex, IndexedTexture } from '@/utils/assetIndex';
import { yieldToUi } from '@/utils/archiveScale';
import { lookupTextureByRef, normKey } from '@/utils/assetIndex';
import type { ExtractedZipEntry } from '@/utils/zip';
import {
  aliasTextureTails,
  classifyTextureRole,
  parseMcmetaAnimation,
  readPngHeader,
  textureTail,
  toBedrockTexturePath,
  type JavaTextureAnimation,
  type TextureRole,
} from '@/utils/textureMetadata';

/**
 * PHASE 3 — Universal Texture Engine.
 *
 * Discovers and decodes every texture in the archive, preserves dimensions,
 * aspect ratio and the alpha channel, interprets Java `.mcmeta` animation data,
 * plans Bedrock flipbooks with the original frame timing, flags emissive /
 * normal maps, normalizes paths, and reports missing or repaired references.
 *
 * Nothing is ever stretched, replaced or dropped silently: every adjustment
 * produces a report entry the port log prints.
 */

const MOBILE_TEXTURE_LIMIT = 1024;

export interface TextureEngineRecord {
  /** Path relative to `textures/`, without extension. */
  tail: string;
  stem: string;
  path: string;
  bucket: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  role: TextureRole;
  animated: boolean;
  frameCount: number;
  /** Single-frame size; equals the full image for non-animated textures. */
  frameWidth: number;
  frameHeight: number;
  ticksPerFrame: number;
  frameTimes: number[];
  /** Explicit playback order when the Java metadata reorders frames. */
  frameOrder?: number[];
  interpolate: boolean;
  /** True when the frame timing came from a real `.mcmeta` file. */
  fromMetadata: boolean;
  oversized: boolean;
}

export type TextureIssueKind =
  | 'missing-reference'
  | 'repaired-reference'
  | 'animated'
  | 'frames'
  | 'oversized'
  | 'undecodable'
  | 'channel-map';

export interface TextureEngineIssue {
  kind: TextureIssueKind;
  path: string;
  detail: string;
  resolved: boolean;
}

export interface FlipbookEntry {
  flipbook_texture: string;
  atlas_tile: string;
  ticks_per_frame: number;
  frames?: number[];
  blend_frames: boolean;
  /** Archive texture the timing came from, for auditability. */
  source: string;
}

export interface UniversalTextureEngineReport {
  discovered: number;
  decoded: number;
  animated: number;
  alphaTextures: number;
  records: TextureEngineRecord[];
  issues: TextureEngineIssue[];
  missingReferences: TextureEngineIssue[];
  repairedReferences: TextureEngineIssue[];
  oversized: string[];
  emissive: string[];
  normalMaps: string[];
  stripsWithoutMetadata: string[];
  flipbooks: FlipbookEntry[];
  appliedFlipbookCount: number;
  summary: string;
}

/** Looks up the decoded record for a texture by archive path, tail or stem. */
export function findTextureRecord(
  report: UniversalTextureEngineReport | null | undefined,
  nameOrPath: string,
): TextureEngineRecord | null {
  if (!report) return null;
  const tail = textureTail(nameOrPath);
  const direct = report.records.find((record) => record.tail === tail);
  if (direct) return direct;
  const stem = normKey(tail.split('/').pop() ?? tail);
  if (!stem) return null;
  const byStem = report.records.filter((record) => normKey(record.stem) === stem);
  return byStem.length === 1 ? byStem[0] : null;
}

/** Animated record for a texture — used to decide frame handling, not to guess. */
export function findAnimatedTextureRecord(
  report: UniversalTextureEngineReport | null | undefined,
  nameOrPath: string,
): TextureEngineRecord | null {
  const record = findTextureRecord(report, nameOrPath);
  return record && record.animated ? record : null;
}

function repairTexturePath(index: AssetIndex, ref: string): IndexedTexture | null {
  const direct = lookupTextureByRef(index, ref);
  if (direct) return direct;
  // Path-shape repair only (block/ vs blocks/, item/ vs items/, models/entity/):
  // a reference is never re-pointed at a different texture by name similarity.
  for (const candidate of aliasTextureTails(textureTail(ref))) {
    const hit = index.byTail.get(candidate);
    if (hit) return hit;
  }
  return null;
}

function collectMissingReferences(
  index: AssetIndex,
): { missing: TextureEngineIssue[]; repaired: TextureEngineIssue[] } {
  const missing: TextureEngineIssue[] = [];
  const repaired: TextureEngineIssue[] = [];
  const seen = new Set<string>();
  const models = [...index.itemModels, ...index.blockModels];
  for (const model of models) {
    for (const [variable, value] of Object.entries(model.textures)) {
      if (typeof value !== 'string' || value.startsWith('#')) continue;
      const key = `${model.path}#${variable}=${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (lookupTextureByRef(index, value)) continue;
      const texture = repairTexturePath(index, value);
      if (texture) {
        repaired.push({
          kind: 'repaired-reference',
          path: value,
          detail: `"${model.path}" textures.${variable} pointed at an unnormalized path — repaired to ${texture.path}.`,
          resolved: true,
        });
        continue;
      }
      missing.push({
        kind: 'missing-reference',
        path: value,
        detail: `"${model.path}" textures.${variable} has no file in the archive — marked UNMATCHED, nothing was substituted.`,
        resolved: false,
      });
    }
  }
  return { missing, repaired };
}

/**
 * Discovery + decoding pass. Runs once per conversion, before any pack file is
 * written, so every downstream stage can consult the real texture metadata.
 */
export async function runUniversalTextureEngine(
  entries: ExtractedZipEntry[],
  index: AssetIndex | null,
  onLog?: (line: string) => void,
): Promise<UniversalTextureEngineReport> {
  const log = (line: string) => onLog?.(line);
  const metadata = new Map<string, JavaTextureAnimation>();
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    if (entryIndex > 0 && entryIndex % 240 === 0) await yieldToUi();
    const entry = entries[entryIndex];
    const path = entry.path.replace(/\\/g, '/').toLowerCase();
    if (!path.endsWith('.png.mcmeta') || !entry.data) continue;
    const animation = parseMcmetaAnimation(entry.data);
    if (!animation) continue;
    metadata.set(textureTail(path), animation);
  }

  const records: TextureEngineRecord[] = [];
  const issues: TextureEngineIssue[] = [];
  const oversized: string[] = [];
  const emissive: string[] = [];
  const normalMaps: string[] = [];
  const stripsWithoutMetadata: string[] = [];
  let decoded = 0;
  let alphaTextures = 0;

  const textures = index?.textures ?? [];
  for (let textureIndex = 0; textureIndex < textures.length; textureIndex += 1) {
    if (textureIndex > 0 && textureIndex % 240 === 0) await yieldToUi();
    const texture = textures[textureIndex];
    const header = readPngHeader(texture.data);
    if (header) decoded += 1;
    const width = header?.width ?? texture.width;
    const height = header?.height ?? texture.height;
    if (!width || !height) {
      issues.push({
        kind: 'undecodable',
        path: texture.path,
        detail: 'PNG header could not be decoded — texture stays ABSENT, no substitute was drawn.',
        resolved: false,
      });
      continue;
    }

    const animation =
      metadata.get(texture.tail) ?? metadata.get(texture.tail.split('/').pop() ?? texture.tail) ?? null;
    const geometricFrames = height > width && height % width === 0 ? height / width : 1;
    const strip = geometricFrames >= 2;
    const frameCount = animation?.frames.length ? animation.frames.length : strip ? geometricFrames : 1;
    const frameWidth = animation?.declaredWidth ?? width;
    const frameHeight = animation?.declaredHeight ?? (strip ? width : height);
    const role = classifyTextureRole(texture.tail);
    const isOversized = width > MOBILE_TEXTURE_LIMIT || height > MOBILE_TEXTURE_LIMIT;
    const sequential = Array.from({ length: frameCount }, (_, i) => i);
    const reordered =
      animation && animation.frames.length > 1
        ? animation.frames.join(',') !== sequential.slice(0, animation.frames.length).join(',')
        : false;

    const record: TextureEngineRecord = {
      tail: texture.tail,
      stem: texture.stem,
      path: texture.path,
      bucket: texture.bucket,
      width,
      height,
      hasAlpha: header?.hasAlpha ?? false,
      role,
      animated: frameCount > 1,
      frameCount,
      frameWidth,
      frameHeight,
      ticksPerFrame: animation?.frametime ?? 1,
      frameTimes: animation?.frameTimes.length ? animation.frameTimes : new Array(frameCount).fill(1),
      ...(reordered && animation ? { frameOrder: [...animation.frames] } : {}),
      interpolate: animation?.interpolate ?? false,
      fromMetadata: Boolean(animation),
      oversized: isOversized,
    };
    records.push(record);

    if (record.hasAlpha) alphaTextures += 1;
    if (role === 'emissive') emissive.push(texture.path);
    if (role === 'normal') normalMaps.push(texture.path);
    if (isOversized) {
      oversized.push(`${texture.path} (${width}x${height})`);
      issues.push({
        kind: 'oversized',
        path: texture.path,
        detail: `${width}x${height} exceeds the ${MOBILE_TEXTURE_LIMIT}px mobile Bedrock budget — reported for downscaling, aspect ratio preserved.`,
        resolved: false,
      });
    }
    if (strip && !animation) {
      stripsWithoutMetadata.push(texture.path);
      issues.push({
        kind: 'frames',
        path: texture.path,
        detail: `Vertical ${geometricFrames}-frame strip with no .mcmeta — frame timing is UNRESOLVED and defaults to 1 tick/frame; all frames are preserved.`,
        resolved: false,
      });
    }
    if (record.animated) {
      issues.push({
        kind: 'animated',
        path: texture.path,
        detail: `${frameCount} frame(s), ${record.ticksPerFrame} tick(s)/frame${record.interpolate ? ', interpolated' : ''}${animation ? '' : ' (timing UNRESOLVED)'}.`,
        resolved: Boolean(animation),
      });
    }
  }

  const references = index ? collectMissingReferences(index) : { missing: [], repaired: [] };
  const repairedReferences = references.repaired;
  const missingReferences = references.missing;
  const animatedCount = records.filter((record) => record.animated).length;
  const summary =
    `${records.length} texture(s) discovered, ${decoded} decoded, ${alphaTextures} with alpha preserved, ` +
    `${animatedCount} animated, ${emissive.length} emissive map(s), ${normalMaps.length} normal map(s), ` +
    `${repairedReferences.length} reference repair(s), ${missingReferences.length} unresolvable reference(s)`;

  log(
    `[TEXTURE-ENGINE] Universal Texture Engine scanned ${entries.length} archive entries -> ${records.length} texture(s) decoded (dimensions, aspect ratio and alpha channel preserved).`,
  );
  if (animatedCount > 0) {
    const metaDriven = records.filter((record) => record.animated && record.fromMetadata).length;
    log(
      `[TEXTURE-ENGINE] ${animatedCount} animated texture(s): ${metaDriven} with Java .mcmeta frame timing, ${stripsWithoutMetadata.length} strip(s) without metadata (timing marked UNRESOLVED).`,
    );
  }
  if (emissive.length > 0 || normalMaps.length > 0) {
    log(
      `[TEXTURE-ENGINE] PBR channel maps detected — emissive: ${emissive.slice(0, 4).join(', ') || 'none'} | normal: ${normalMaps.slice(0, 4).join(', ') || 'none'}.`,
    );
  }
  for (const repair of repairedReferences.slice(0, 6)) log(`[TEXTURE-ENGINE][REPAIR] ${repair.detail}`);
  for (const miss of missingReferences.slice(0, 8)) log(`[TEXTURE-ENGINE][UNMATCHED] ${miss.detail}`);
  for (const big of oversized.slice(0, 4)) log(`[TEXTURE-ENGINE][SIZE] ${big}`);
  log(`[TEXTURE-ENGINE] ${summary}.`);

  return {
    discovered: records.length,
    decoded,
    animated: animatedCount,
    alphaTextures,
    records,
    issues,
    missingReferences,
    repairedReferences,
    oversized,
    emissive,
    normalMaps,
    stripsWithoutMetadata,
    flipbooks: [],
    appliedFlipbookCount: 0,
    summary,
  };
}

/**
 * Post-assembly pass: registers Bedrock flipbooks for every animated block
 * texture that actually shipped, using the Java frame timing. Item icons cannot
 * be flipbooked by the Bedrock item atlas, so those are reported instead of
 * being silently cropped.
 */
export function applyTextureEngineToPack(
  report: UniversalTextureEngineReport,
  resourcePackFiles: Record<string, string | Uint8Array>,
  onLog?: (line: string) => void,
): void {
  const log = (line: string) => onLog?.(line);
  let terrainTiles = new Set<string>();
  const terrainRaw = resourcePackFiles['textures/terrain_texture.json'];
  if (typeof terrainRaw === 'string') {
    try {
      const parsed = JSON.parse(terrainRaw) as { texture_data?: Record<string, unknown> };
      terrainTiles = new Set(Object.keys(parsed.texture_data ?? {}));
    } catch {
      terrainTiles = new Set();
    }
  }

  const flipbooks: FlipbookEntry[] = [];
  for (const key of Object.keys(resourcePackFiles)) {
    const match = key.match(/^textures\/(blocks|items)\/([^/]+)\.png$/);
    if (!match) continue;
    const bucket = match[1];
    const tile = match[2];
    const bytes = resourcePackFiles[key];
    if (!(bytes instanceof Uint8Array)) continue;
    const header = readPngHeader(bytes);
    if (!header) continue;
    const frames = header.height > header.width && header.height % header.width === 0
      ? header.height / header.width
      : 1;
    if (frames < 2) continue;
    if (bucket === 'items') {
      report.issues.push({
        kind: 'frames',
        path: key,
        detail: `Animated ${frames}-frame icon strip: the Bedrock item atlas has no flipbook support, so the icon renders its first frame. Reported, not silently dropped.`,
        resolved: false,
      });
      continue;
    }
    if (!terrainTiles.has(tile)) {
      report.issues.push({
        kind: 'frames',
        path: key,
        detail: 'Animated block strip is not registered in the terrain atlas, so no flipbook can reference it.',
        resolved: false,
      });
      continue;
    }
    const source = findTextureRecord(report, key);
    flipbooks.push({
      flipbook_texture: toBedrockTexturePath(`blocks/${tile}`),
      atlas_tile: tile,
      ticks_per_frame: source?.ticksPerFrame ?? 1,
      ...(source?.frameOrder ? { frames: source.frameOrder } : {}),
      blend_frames: source?.interpolate ?? false,
      source: source?.path ?? key,
    });
  }

  report.flipbooks = flipbooks;
  report.appliedFlipbookCount = flipbooks.length;
  if (flipbooks.length === 0) return;

  resourcePackFiles['textures/flipbook_textures.json'] = JSON.stringify(
    flipbooks.map(({ source, ...entry }) => {
      void source;
      return entry;
    }),
    null,
    2,
  );
  const ordered = flipbooks.filter((entry) => entry.frames).length;
  log(
    `[TEXTURE-ENGINE] Bedrock flipbook generated for ${flipbooks.length} animated block texture(s) with preserved frame timing${ordered > 0 ? ` (${ordered} with a custom frame order)` : ''}.`,
  );
}