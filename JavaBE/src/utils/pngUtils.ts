export interface PngSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads the real pixel dimensions straight out of a PNG's IHDR chunk.
 * Used to build Bedrock geometry UVs and to reject icon-sized false positives
 * when linking authentic mod textures to mobs, blocks and items.
 */
export function readPngDimensions(bytes: Uint8Array | null | undefined): PngSize | null {
  if (!bytes || bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height || width > 4096 || height > 4096) return null;
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Java animated textures are shipped as vertical frame strips (16x256 etc.).
 * Bedrock atlases must receive a single square frame instead of the whole strip.
 */
export function isVerticalAnimationStrip(bytes: Uint8Array): boolean {
  const size = readPngDimensions(bytes);
  if (!size) return false;
  return size.height > size.width && size.height % size.width === 0 && size.height / size.width >= 2;
}

const LEGACY_TEXTURE_UPSCALING_KEY = 'aippy.autoUpscaleLegacyTextures.v1';

export function getAutoUpscaleLegacyTextures(): boolean {
  try {
    return localStorage.getItem(LEGACY_TEXTURE_UPSCALING_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoUpscaleLegacyTextures(enabled: boolean): void {
  try {
    localStorage.setItem(LEGACY_TEXTURE_UPSCALING_KEY, String(enabled));
  } catch {
    // Keep the in-session toggle usable when browser storage is unavailable.
  }
}

/**
 * Upscales a low-resolution legacy texture using nearest-neighbor sampling so it
 * reaches at least 64px on its shortest edge. This prevents sampling artifacts
 * (mip bleeding, sub-pixel shimmer) when a 16x16 or 32x32 legacy mod skin is
 * bound to a high-fidelity Bedrock geometry. Aspect ratio is preserved and
 * non-square animation strips are left untouched.
 * Returns null when the browser cannot decode/re-encode the PNG.
 */
export async function upscaleLegacyTexture(
  bytes: Uint8Array,
  target = 64,
): Promise<Uint8Array | null> {
  const size = readPngDimensions(bytes);
  if (!size) return null;
  // Only upscale genuinely small, non-strip textures
  if (Math.min(size.width, size.height) >= target) return null;
  if (isVerticalAnimationStrip(bytes)) return null;

  try {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const factor = Math.max(2, Math.floor(target / Math.min(bitmap.width, bitmap.height)));
    const outW = bitmap.width * factor;
    const outH = bitmap.height * factor;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close();
    const outBlob: Blob = await new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    ));
    const buffer = await outBlob.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Downscales an oversized entity skin (e.g. 2048x2048) to fit within maxDimension (default 1024)
 * using nearest-neighbor sampling to avoid GPU memory exhaustion on mobile Bedrock devices.
 */
export async function downscaleLargeTexture(
  bytes: Uint8Array,
  maxDimension = 1024,
): Promise<Uint8Array | null> {
  const size = readPngDimensions(bytes);
  if (!size) return null;
  if (size.width <= maxDimension && size.height <= maxDimension) return null;
  if (isVerticalAnimationStrip(bytes)) return null;

  try {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(maxDimension / bitmap.width, maxDimension / bitmap.height);
    const outW = Math.max(16, Math.round(bitmap.width * scale));
    const outH = Math.max(16, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close();
    const outBlob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    const buffer = await outBlob.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}