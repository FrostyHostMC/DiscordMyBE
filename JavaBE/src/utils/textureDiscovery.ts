import type { ExtractedZipEntry } from '@/utils/zip';
import { readPngDimensions } from '@/utils/pngUtils';
import { normalizeAssetIdentifier, normalizeAssetPath } from '@/utils/identifierNormalization';

/**
 * Texture discovery.
 *
 * A Java mod keeps an entity's skin wherever it likes: `textures/entity/`,
 * `textures/entities/`, `textures/mob/`, `textures/models/`, a deeply nested folder, or
 * even a purely numeric file name. This module walks EVERY PNG in the archive, keeps the
 * ones a rig can legitimately wear, and lets a mob be matched against the resource string
 * its own class declares instead of the folder the file happens to sit in.
 */

/** Folders mods keep entity sheets in. */
const ENTITY_FOLDER = /(?:^|\/)(?:entity|entities|mob|mobs|models?|creatures?|skins?)(?:\/|$)/;
/** Folders whose art is never a body sheet, whatever its size. */
const NON_SKIN_FOLDER =
  /(?:^|\/)(?:gui|font|particles?|ui|menu|colormap|misc|paintings?|environment|effects?|shaders?)(?:\/|$)/;
/** Stems that name interface art or a layered add-on rather than a body. */
const NON_SKIN_STEM =
  /(^|_)(gui|menu|inventory|container|crafting|trade|button|panel|hud|slot|icon|logo|title|banner|splash|font|atlas|palette|preview|tooltip|background|interface|ui|book|page|glow|eyes|overlay|mask|armor|saddle|shadow|particle|flash|spark|template|blank|empty)(_|$)/;
/** PBR channel maps (`_n`, `_s`, `_e`, `_mer`) are shading data, not skins. */
const PBR_MAP = /_(?:n|s|e|mer)\.png$/i;

export interface DiscoveredTexture {
  /** Lowercase archive path. */
  path: string;
  /** Path from `textures/` without extension (`entity/mob/42`). */
  tail: string;
  stem: string;
  folder: string;
  width: number;
  height: number;
  /** True when the file sits in a folder mods use for entity sheets. */
  entityFolder: boolean;
  /** True when the file can be worn by a rig (art that never is gets excluded). */
  bindable: boolean;
  data: Uint8Array;
}

export interface TextureDiscoveryIndex {
  sheets: DiscoveredTexture[];
  /** Every key a resource string, archive path or mob id can match, entity sheets first. */
  byKey: Map<string, DiscoveredTexture>;
}

/**
 * Keys a resource string, an archive path or an identifier can be matched against.
 * Short and numeric names are kept: `textures/entity/2.png` is a valid resource.
 */
export function textureKeys(value: string): string[] {
  const clean = normalizeAssetPath(value).replace(/(?:\.geo)?\.json$/i, '').replace(/\.png$/i, '');
  const at = clean.indexOf('textures/');
  const rel = at >= 0 ? clean.slice(at + 'textures/'.length) : clean;
  const segments = rel.split('/').filter(Boolean);
  const stem = segments.length > 0 ? segments[segments.length - 1] : rel;
  const folder = segments.length > 1 ? segments[segments.length - 2] : '';
  const keys = new Set<string>();
  const add = (candidate: string) => {
    const key = normalizeAssetIdentifier(candidate);
    if (key) keys.add(key);
  };
  add(rel);
  add(clean);
  add(stem);
  if (folder) add(`${folder}/${stem}`);
  if (segments.length > 2) add(segments.slice(-3).join('/'));
  return [...keys];
}

/** Recursively indexes every PNG the archive ships, in any `textures/**` folder. */
export function buildTextureDiscoveryIndex(entries: ExtractedZipEntry[]): TextureDiscoveryIndex {
  const sheets: DiscoveredTexture[] = [];
  for (const entry of entries) {
    if (!entry?.data || entry.data.length < 40) continue;
    const raw = entry.path.replace(/\\/g, '/');
    if (!/\.png$/i.test(raw)) continue;
    if (PBR_MAP.test(raw)) continue;
    const size = readPngDimensions(entry.data);
    if (!size || size.width < 8 || size.height < 8) continue;
    const path = normalizeAssetPath(raw);
    const at = path.indexOf('textures/');
    const tail = (at >= 0 ? path.slice(at + 'textures/'.length) : path).replace(/\.png$/i, '');
    const segments = tail.split('/').filter(Boolean);
    const stem = segments.length > 0 ? segments[segments.length - 1] : tail;
    const folder = segments.length > 1 ? segments[segments.length - 2] : '';
    const frameStrip = size.height > size.width && size.height % size.width === 0;
    const bindable =
      size.width >= 16 &&
      size.height >= 16 &&
      size.width <= 2048 &&
      size.height <= 2048 &&
      !frameStrip &&
      !NON_SKIN_STEM.test(stem) &&
      !NON_SKIN_FOLDER.test(tail);
    sheets.push({
      path,
      tail,
      stem,
      folder,
      width: size.width,
      height: size.height,
      entityFolder: ENTITY_FOLDER.test(tail),
      bindable,
      data: entry.data,
    });
  }

  const byKey = new Map<string, DiscoveredTexture>();
  const ordered = [...sheets].sort((a, b) => Number(b.entityFolder) - Number(a.entityFolder));
  for (const sheet of ordered) {
    for (const key of textureKeys(sheet.tail)) if (!byKey.has(key)) byKey.set(key, sheet);
  }
  return { sheets, byKey };
}

/** Resolves the skin a class resource string names, in any folder the archive uses. */
export function resolveDeclaredTexture(
  index: TextureDiscoveryIndex,
  refs: string[],
): DiscoveredTexture | null {
  for (const ref of refs) {
    const keys = textureKeys(ref);
    for (let i = 0; i < keys.length; i++) {
      const hit = index.byKey.get(keys[i]);
      if (!hit) continue;
      // The folder-qualified keys a class resource string carries always win; a bare file
      // name only resolves to a sheet a rig can actually wear, never to item or menu art.
      if (i < 2 || hit.bindable) return hit;
    }
  }
  return null;
}

/**
 * Discovery tier: the best unclaimed sheet that fits a rig. An unreferenced PNG is still an
 * authentic asset, so a mob keeps this file (copied to `textures/entity/`) instead of being
 * reported ABSENT while something usable sits in the archive.
 */
export function pickFittingTexture(
  index: TextureDiscoveryIndex,
  options: { mobId: string; displayName?: string; claimed?: Set<string>; minScore?: number },
): DiscoveredTexture | null {
  const keys = new Set<string>();
  for (const value of [options.mobId, options.mobId.replace(/_spawn_egg$/, ''), options.displayName ?? '']) {
    for (const key of textureKeys(value)) keys.add(key);
  }
  const claimed = options.claimed ?? new Set<string>();
  const minScore = options.minScore ?? 24;
  let best: DiscoveredTexture | null = null;
  let bestScore = minScore - 1;
  for (const sheet of index.sheets) {
    if (!sheet.bindable) continue;
    if (claimed.has(sheet.path) || claimed.has(sheet.tail) || claimed.has(sheet.stem)) continue;
    let score = sheet.entityFolder ? 24 : 8;
    // A large sheet outside an entity folder can still be a body; a 16x16 block tile cannot.
    if (!sheet.entityFolder && sheet.width >= 32 && sheet.height >= 32) score += 18;
    const stemKey = normalizeAssetIdentifier(sheet.stem);
    const folderKey = normalizeAssetIdentifier(sheet.folder);
    if (keys.has(stemKey)) score += 60;
    else if (folderKey && keys.has(folderKey)) score += 30;
    else if ([...keys].some((key) => key.length >= 4 && (stemKey.startsWith(key) || key.startsWith(stemKey)))) {
      score += 20;
    }
    if (/^\d+$/.test(sheet.stem)) score += 4;
    if (sheet.width >= 64 && sheet.height >= 64) score += 6;
    if (score > bestScore) {
      bestScore = score;
      best = sheet;
    }
  }
  return best;
}