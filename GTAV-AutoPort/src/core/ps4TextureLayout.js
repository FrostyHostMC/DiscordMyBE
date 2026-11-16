const DDS_MAGIC = [0x44, 0x44, 0x53, 0x20];
const MAX_DIMENSION = 16384;
const MAX_MIPS = 16;
const MAX_STORAGE_BYTES = 64 * 1024 * 1024;
const MAX_BLOCKS = 4 * 1024 * 1024;
const BLOCK_BYTES = Object.freeze({ BC1: 8, BC3: 16, BC5: 16 });
const FORMAT_CODES = Object.freeze({ BC1: 0x47, BC3: 0x4d, BC5: 0x53 });
export const PS4_TEXTURE_TILE_MODE = 0x800001;
export const PS4_TEXTURE_TILE_INDEX = 13;

function fail(message) { throw new Error("PS4 texture storage conversion: " + message); }
function ascii(bytes, offset, length) { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function isMagic(bytes) { return bytes.length >= 4 && DDS_MAGIC.every((value, index) => bytes[index] === value); }

function decodeFormat(fourCC, dxgiFormat) {
  if (fourCC === "DXT1" || dxgiFormat === 71) return "BC1";
  if (fourCC === "DXT5" || dxgiFormat === 77) return "BC3";
  if (["ATI2", "BC5U"].includes(fourCC) || dxgiFormat === 83) return "BC5";
  return null;
}

export function inspectDdsTexture(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) return { status: "invalid-input", error: "DDS inspection requires Uint8Array-compatible bytes." };
  if (!isMagic(bytes)) return { status: "not-dds", error: "DDS magic was not found." };
  if (bytes.length < 128) return { status: "truncated", error: "DDS header is shorter than 128 bytes." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 124 || view.getUint32(76, true) !== 32) {
    return { status: "invalid-header", error: "DDS header or pixel-format structure size is invalid." };
  }
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const declaredMipCount = view.getUint32(28, true);
  const mipCount = Math.max(1, declaredMipCount);
  const pixelFlags = view.getUint32(80, true);
  const fourCC = ascii(bytes, 84, 4);
  const caps2 = view.getUint32(112, true);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { status: "unsupported-dimensions", width, height, error: "DDS dimensions are zero or exceed the 16384-pixel safety limit." };
  }
  if (mipCount > Math.min(MAX_MIPS, Math.floor(Math.log2(Math.max(width, height))) + 1)) {
    return { status: "invalid-mip-count", width, height, mipCount, error: "DDS mip count exceeds the complete dimension chain." };
  }
  if ((caps2 & 0x00000200) || (caps2 & 0x00200000)) {
    return { status: "unsupported-texture-shape", width, height, mipCount, error: "Cubemap and volume DDS textures are not supported by this single-slice encoder." };
  }
  if ((pixelFlags & 0x4) === 0) return { status: "unsupported-pixel-format", width, height, mipCount, error: "DDS pixel format does not declare a FourCC-compressed surface." };
  let dataOffset = 128;
  let dxgiFormat = null;
  let resourceDimension = null;
  let arraySize = 1;
  let miscFlag = 0;
  if ((pixelFlags & 0x4) && fourCC === "DX10") {
    if (bytes.length < 148) return { status: "truncated", error: "DDS DX10 extension header is truncated." };
    dxgiFormat = view.getUint32(128, true);
    resourceDimension = view.getUint32(132, true);
    miscFlag = view.getUint32(136, true);
    arraySize = view.getUint32(140, true);
    dataOffset = 148;
    if (resourceDimension !== 3 || arraySize !== 1 || (miscFlag & 0x4)) {
      return { status: "unsupported-texture-shape", width, height, mipCount, dxgiFormat, resourceDimension, arraySize, error: "Only non-array, non-cubemap 2D DX10 DDS textures are supported." };
    }
  }
  const format = decodeFormat(fourCC, dxgiFormat);
  if (!format) {
    return { status: "unsupported-format", width, height, mipCount, fourCC, dxgiFormat, error: "Only BC1/DXT1, BC3/DXT5 and BC5/ATI2 compressed textures are supported." };
  }
  const blockBytes = BLOCK_BYTES[format];
  const mips = [];
  let cursor = dataOffset;
  let totalBlocks = 0;
  for (let level = 0; level < mipCount; level++) {
    const mipWidth = Math.max(1, width >> level);
    const mipHeight = Math.max(1, height >> level);
    const widthBlocks = Math.ceil(mipWidth / 4);
    const heightBlocks = Math.ceil(mipHeight / 4);
    const size = widthBlocks * heightBlocks * blockBytes;
    if (!Number.isSafeInteger(size) || cursor + size > bytes.length) {
      return { status: "truncated-payload", width, height, mipCount, format, mipLevel: level, expectedBytes: size, availableBytes: Math.max(0, bytes.length - cursor), error: "DDS compressed mip payload is truncated." };
    }
    mips.push({ level, width: mipWidth, height: mipHeight, widthBlocks, heightBlocks, offset: cursor, size });
    cursor += size;
    totalBlocks += widthBlocks * heightBlocks;
  }
  if (totalBlocks > MAX_BLOCKS) return { status: "over-budget", width, height, mipCount, format, error: "DDS texture exceeds the compressed-block work budget." };
  return {
    status: "supported",
    width,
    height,
    mipCount,
    format,
    blockBytes,
    formatCode: FORMAT_CODES[format],
    fourCC,
    dxgiFormat,
    dataOffset,
    payloadBytes: cursor - dataOffset,
    trailingBytes: bytes.length - cursor,
    mips,
    warnings: bytes.length > cursor ? ["DDS contains trailing bytes beyond the declared mip payload; they are not included in the converted texture."] : []
  };
}

export function createPs4TextureLayout(width, height, mipCount, format) {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_DIMENSION)) {
    fail("width and height must be integers from 1 to " + MAX_DIMENSION + ".");
  }
  const maximumMips = Math.floor(Math.log2(Math.max(width, height))) + 1;
  if (!Number.isSafeInteger(mipCount) || mipCount < 1 || mipCount > Math.min(MAX_MIPS, maximumMips)) fail("mip count is outside the supported range.");
  if (!Object.hasOwn(BLOCK_BYTES, format)) fail("format must be BC1, BC3 or BC5.");
  const blockBytes = BLOCK_BYTES[format];
  const mips = [];
  let storageBytes = 0;
  let totalBlocks = 0;
  for (let level = 0; level < mipCount; level++) {
    const mipWidth = Math.max(1, width >> level);
    const mipHeight = Math.max(1, height >> level);
    const widthBlocks = Math.ceil(mipWidth / 4);
    const heightBlocks = Math.ceil(mipHeight / 4);
    const pitchBlocks = Math.ceil(widthBlocks / 8) * 8;
    const paddedHeightBlocks = Math.ceil(heightBlocks / 8) * 8;
    mips.push({ level, width: mipWidth, height: mipHeight, widthBlocks, heightBlocks, pitchBlocks, paddedHeightBlocks, offsetBytes: storageBytes });
    storageBytes += pitchBlocks * paddedHeightBlocks * blockBytes;
    totalBlocks += widthBlocks * heightBlocks;
    if (!Number.isSafeInteger(storageBytes) || storageBytes > MAX_STORAGE_BYTES || totalBlocks > MAX_BLOCKS) fail("layout exceeds the 64 MiB storage or block-work budget.");
  }
  return { width, height, mipCount, format, blockBytes, formatCode: FORMAT_CODES[format], tileMode: PS4_TEXTURE_TILE_MODE, tileIndex: PS4_TEXTURE_TILE_INDEX, alignmentBytes: 64 * blockBytes, storageBytes, mips };
}

function blockOffset(layout, mip, x, y) {
  const tile = Math.floor(y / 8) * (mip.pitchBlocks / 8) + Math.floor(x / 8);
  const within = (x & 1) | ((y & 1) << 1) | ((x & 2) << 1) | ((y & 2) << 2) | ((x & 4) << 2) | ((y & 4) << 3);
  return mip.offsetBytes + (tile * 64 + within) * layout.blockBytes;
}

export function tilePs4TextureMips(mipPayloads, layout) {
  if (!layout || !Array.isArray(layout.mips) || !Array.isArray(mipPayloads) || mipPayloads.length !== layout.mipCount) fail("every mip payload is required exactly once.");
  const output = new Uint8Array(layout.storageBytes);
  for (let level = 0; level < layout.mipCount; level++) {
    const mip = layout.mips[level];
    const payload = mipPayloads[level] instanceof Uint8Array ? mipPayloads[level] : null;
    if (!payload || payload.length !== mip.widthBlocks * mip.heightBlocks * layout.blockBytes) fail("mip " + level + " payload length does not match its complete compressed extent.");
    for (let y = 0; y < mip.heightBlocks; y++) {
      for (let x = 0; x < mip.widthBlocks; x++) {
        const sourceOffset = (y * mip.widthBlocks + x) * layout.blockBytes;
        const targetOffset = blockOffset(layout, mip, x, y);
        output.set(payload.subarray(sourceOffset, sourceOffset + layout.blockBytes), targetOffset);
      }
    }
  }
  return output;
}

export function untilePs4TextureMips(allocation, layout) {
  const bytes = allocation instanceof Uint8Array ? allocation : null;
  if (!layout || !Array.isArray(layout.mips) || !bytes || bytes.length !== layout.storageBytes) fail("allocation length does not match the typed layout.");
  return layout.mips.map((mip) => {
    const output = new Uint8Array(mip.widthBlocks * mip.heightBlocks * layout.blockBytes);
    for (let y = 0; y < mip.heightBlocks; y++) {
      for (let x = 0; x < mip.widthBlocks; x++) {
        const sourceOffset = blockOffset(layout, mip, x, y);
        const targetOffset = (y * mip.widthBlocks + x) * layout.blockBytes;
        output.set(bytes.subarray(sourceOffset, sourceOffset + layout.blockBytes), targetOffset);
      }
    }
    return output;
  });
}

export function convertDdsToPs4TextureStorage(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  const inspection = inspectDdsTexture(bytes);
  if (inspection.status !== "supported") return { status: "not-converted", inspection, storage: null, layout: null };
  const layout = createPs4TextureLayout(inspection.width, inspection.height, inspection.mipCount, inspection.format);
  const mipPayloads = inspection.mips.map((mip) => bytes.slice(mip.offset, mip.offset + mip.size));
  const storage = tilePs4TextureMips(mipPayloads, layout);
  const roundTrip = untilePs4TextureMips(storage, layout);
  const roundTripVerified = roundTrip.every((mip, index) => mip.length === mipPayloads[index].length && mip.every((value, offset) => value === mipPayloads[index][offset]));
  if (!roundTripVerified) fail("internal untile round-trip verification failed.");
  return {
    status: "ps4-texture-storage-candidate",
    inspection,
    layout,
    storage,
    roundTripVerified,
    installable: false,
    targetCompatibility: "experimental storage-layout conversion only; not a complete PS4 RSC7/YTD texture dictionary"
  };
}
