/**
 * Minimal PNG codec used by the PBR / Deferred-material stage.
 *
 * Java PBR packs ship the channel data the engine needs split across separate images
 * (`_n` normal, `_s` specular/roughness, `_e` emissive, `_h` height). Bedrock's deferred
 * pipeline expects emissive and roughness packed into a single
 * `metalness_emissive_roughness` sheet, so the channel data has to be re-encoded — the
 * file cannot simply be copied. This module decodes a PNG to RGBA8 and encodes RGBA8 back
 * to PNG, using the platform's own inflate/deflate streams (no extra dependency).
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || bytes.length === 0) return null;
  try {
    const stream = new DecompressionStream('deflate');
    const writer = stream.writable.getWriter();
    void writer.write(bytes as unknown as BufferSource);
    void writer.close();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const combined = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) {
      combined.set(chunk, cursor);
      cursor += chunk.length;
    }
    return combined;
  } catch {
    return null;
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    void writer.write(bytes as unknown as BufferSource);
    void writer.close();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const combined = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) {
      combined.set(chunk, cursor);
      cursor += chunk.length;
    }
    return combined;
  } catch {
    return null;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes a non-interlaced PNG (8/16-bit, grey/RGB/palette/RGBA) into RGBA8. */
export async function decodePngRgba(bytes: Uint8Array | null | undefined): Promise<RgbaImage | null> {
  if (!bytes || bytes.length < 33) return null;
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) return null;
  }
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    if (type === 'IHDR') {
      width = readUint32(bytes, start);
      height = readUint32(bytes, start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === 'PLTE') palette = bytes.subarray(start, end);
    else if (type === 'tRNS') transparency = bytes.subarray(start, end);
    else if (type === 'IDAT') data.push(bytes.subarray(start, end));
    else if (type === 'IEND') break;
    offset = end + 4;
  }

  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels || !width || !height || interlace !== 0 || data.length === 0) return null;
  if (bitDepth !== 8 && bitDepth !== 16 && bitDepth !== 4 && bitDepth !== 2 && bitDepth !== 1) return null;

  let packed = new Uint8Array(0);
  if (data.length === 1) packed = data[0];
  else {
    const total = data.reduce((sum, part) => sum + part.length, 0);
    packed = new Uint8Array(total);
    let cursor = 0;
    for (const part of data) {
      packed.set(part, cursor);
      cursor += part.length;
    }
  }
  const raw = await inflate(packed);
  if (!raw) return null;

  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < (stride + 1) * height) return null;

  const scan = new Uint8Array(stride * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const row = scan.subarray(y * stride, (y + 1) * stride);
    row.set(raw.subarray(rowStart, rowStart + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
      const value = row[x];
      if (filter === 1) row[x] = (value + a) & 0xff;
      else if (filter === 2) row[x] = (value + b) & 0xff;
      else if (filter === 3) row[x] = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) row[x] = (value + paeth(a, b, c)) & 0xff;
    }
    previous = row;
  }

  const sample = (row: Uint8Array, pixel: number, channel: number): number => {
    const bit = pixel * bitsPerPixel + channel * bitDepth;
    if (bitDepth === 8) return row[bit >> 3] ?? 0;
    if (bitDepth === 16) return row[bit >> 3] ?? 0;
    const byte = row[bit >> 3] ?? 0;
    const shift = 8 - bitDepth - (bit & 7);
    const rawValue = (byte >> shift) & ((1 << bitDepth) - 1);
    return Math.round((rawValue * 255) / ((1 << bitDepth) - 1));
  };

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = scan.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      if (colorType === 3) {
        const index = sample(row, x, 0);
        const at = palette ? index * 3 : -1;
        out[target] = palette && at >= 0 && at + 2 < palette.length ? palette[at] : 0;
        out[target + 1] = palette && at >= 0 && at + 2 < palette.length ? palette[at + 1] : 0;
        out[target + 2] = palette && at >= 0 && at + 2 < palette.length ? palette[at + 2] : 0;
        out[target + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const grey = sample(row, x, 0);
        out[target] = grey;
        out[target + 1] = grey;
        out[target + 2] = grey;
        out[target + 3] = colorType === 4 ? sample(row, x, 1) : 255;
      } else {
        out[target] = sample(row, x, 0);
        out[target + 1] = sample(row, x, 1);
        out[target + 2] = sample(row, x, 2);
        out[target + 3] = colorType === 6 ? sample(row, x, 3) : 255;
      }
    }
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildChunk(type: string, body: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(body, 8);
  const crcInput = new Uint8Array(4 + body.length);
  crcInput.set(chunk.subarray(4, 8), 0);
  crcInput.set(body, 4);
  view.setUint32(8 + body.length, crc32(crcInput));
  return chunk;
}

/** Encodes RGBA8 pixels as a PNG (colour type 6, filter 0, deflate). */
export async function encodePngRgba(image: RgbaImage): Promise<Uint8Array | null> {
  const { width, height, data } = image;
  if (!width || !height || data.length < width * height * 4) return null;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = await deflate(raw);
  if (!compressed) return null;
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const parts = [
    new Uint8Array(SIGNATURE),
    buildChunk('IHDR', header),
    buildChunk('IDAT', compressed),
    buildChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}

/** Nearest-neighbour resample, used when a channel map is a different size to its colour sheet. */
export function resampleRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sy * image.width + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = image.data[from];
      out[to + 1] = image.data[from + 1];
      out[to + 2] = image.data[from + 2];
      out[to + 3] = image.data[from + 3];
    }
  }
  return { width, height, data: out };
}