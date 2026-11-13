/**
 * Universal Texture Engine — decoding primitives.
 *
 * Everything here reads what a PNG / Java `.mcmeta` file actually declares:
 * real pixel dimensions, the alpha channel, and the frame timing of animated
 * textures. Nothing is guessed from a file name alone.
 */

export type TextureRole = 'albedo' | 'emissive' | 'normal' | 'metalness' | 'height';

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
  colorType: number;
  hasAlpha: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads the IHDR chunk: dimensions, bit depth, colour type and alpha support. */
export function readPngHeader(bytes: Uint8Array | null | undefined): PngHeader | null {
  if (!bytes || bytes.length < 33) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height) return null;
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    // Palette images keep transparency in a tRNS chunk that follows IHDR.
    let paletteAlpha = false;
    if (colorType === 3) {
      const limit = Math.min(bytes.length - 4, 2048);
      for (let i = 33; i < limit; i++) {
        if (bytes[i] === 0x74 && bytes[i + 1] === 0x52 && bytes[i + 2] === 0x4e && bytes[i + 3] === 0x53) {
          paletteAlpha = true;
          break;
        }
      }
    }
    return {
      width,
      height,
      bitDepth,
      colorType,
      hasAlpha: colorType === 4 || colorType === 6 || paletteAlpha,
    };
  } catch {
    return null;
  }
}

export interface JavaTextureAnimation {
  /** Frame indices in playback order. */
  frames: number[];
  /** Ticks each frame is held — parallel to `frames`. */
  frameTimes: number[];
  /** Default ticks per frame when an entry declares none. */
  frametime: number;
  /** Java `interpolate` flag: frames blend instead of snapping. */
  interpolate: boolean;
  declaredWidth?: number;
  declaredHeight?: number;
}

/** Parses a Java `.png.mcmeta` animation block, preserving per-frame timing. */
export function parseMcmetaAnimation(raw: Uint8Array | string | null | undefined): JavaTextureAnimation | null {
  if (!raw) return null;
  let doc: unknown;
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    if (!text.trim()) return null;
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const animation = (doc as { animation?: Record<string, unknown> } | null)?.animation;
  if (!animation || typeof animation !== 'object') return null;

  const frametime =
    typeof animation.frametime === 'number' && animation.frametime > 0 ? Math.round(animation.frametime) : 1;
  const frames: number[] = [];
  const frameTimes: number[] = [];
  const declared = Array.isArray(animation.frames) ? animation.frames : null;
  if (declared) {
    for (const frame of declared) {
      if (typeof frame === 'number' && Number.isFinite(frame)) {
        frames.push(frame);
        frameTimes.push(frametime);
        continue;
      }
      if (frame && typeof frame === 'object') {
        const entry = frame as { index?: unknown; time?: unknown };
        const index = typeof entry.index === 'number' ? entry.index : frames.length;
        const time = typeof entry.time === 'number' && entry.time > 0 ? Math.round(entry.time) : frametime;
        frames.push(index);
        frameTimes.push(time);
      }
    }
  }
  return {
    frames,
    frameTimes,
    frametime,
    interpolate: animation.interpolate === true,
    declaredWidth: typeof animation.width === 'number' ? animation.width : undefined,
    declaredHeight: typeof animation.height === 'number' ? animation.height : undefined,
  };
}

/** Normalizes any archive path to a `textures/`-relative tail without extension. */
export function textureTail(path: string): string {
  const clean = path.replace(/\\/g, '/').toLowerCase();
  const marker = clean.lastIndexOf('/textures/');
  const relative = clean.startsWith('textures/')
    ? clean.slice('textures/'.length)
    : marker >= 0
      ? clean.slice(marker + '/textures/'.length)
      : clean.replace(/^\/+/, '');
  return relative.replace(/(?:\.png)?\.mcmeta$/i, '').replace(/\.png$/i, '');
}

/**
 * Java splits resources into `block/` + `item/`, Bedrock into `blocks/` + `items/`,
 * and some mods nest skins under `models/entity/`. Bedrock only accepts one shape.
 */
export function toBedrockTexturePath(tail: string): string {
  const normalized = tail
    .replace(/^textures\//, '')
    .replace(/^block\//, 'blocks/')
    .replace(/^item\//, 'items/')
    .replace(/^entities\//, 'entity/')
    .replace(/^models\/entity\//, 'entity/')
    .replace(/^mob\//, 'entity/');
  return `textures/${normalized}`;
}

const NORMAL_ROLE = /(?:^|[_-])(?:n|normal|normalmap|normal_map)$/;
const EMISSIVE_ROLE = /(?:^|[_-])(?:e|emissive|emissive_texture|glow)$/;
const METALNESS_ROLE = /(?:^|[_-])(?:mer|metalness|metallic|roughness)$/;
const HEIGHT_ROLE = /(?:^|[_-])(?:height|heightmap)$/;

/** Classifies PBR channel maps so they are never bound as a base colour sheet. */
export function classifyTextureRole(tail: string): TextureRole {
  const stem = tail.split('/').pop() ?? tail;
  if (NORMAL_ROLE.test(stem)) return 'normal';
  if (EMISSIVE_ROLE.test(stem)) return 'emissive';
  if (METALNESS_ROLE.test(stem)) return 'metalness';
  if (HEIGHT_ROLE.test(stem)) return 'height';
  return 'albedo';
}

/** Alternate archive tails a Java texture reference may legitimately resolve to. */
export function aliasTextureTails(tail: string): string[] {
  const base = tail.replace(/^textures\//, '');
  const candidates = new Set<string>([base]);
  if (base.startsWith('block/')) candidates.add(`blocks/${base.slice('block/'.length)}`);
  if (base.startsWith('blocks/')) candidates.add(`block/${base.slice('blocks/'.length)}`);
  if (base.startsWith('item/')) candidates.add(`items/${base.slice('item/'.length)}`);
  if (base.startsWith('items/')) candidates.add(`item/${base.slice('items/'.length)}`);
  if (base.startsWith('entity/')) candidates.add(`entities/${base.slice('entity/'.length)}`);
  if (base.startsWith('entities/')) candidates.add(`entity/${base.slice('entities/'.length)}`);
  if (base.startsWith('models/entity/')) candidates.add(`entity/${base.slice('models/entity/'.length)}`);
  if (!base.includes('/')) {
    candidates.add(`entity/${base}`);
    candidates.add(`block/${base}`);
    candidates.add(`item/${base}`);
  }
  return [...candidates];
}