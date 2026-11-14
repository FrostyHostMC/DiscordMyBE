import { archiveEntryPriority, yieldToUi } from '@/utils/archiveScale';

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// DOS date/time must be a real, valid timestamp. A value of 0 decodes to an
// illegal date (month 0 / day 0) and strict ZIP readers — including the
// Minecraft Bedrock pack importer — reject the archive as corrupt, which
// surfaced as "unknown pack or broken" on import.
const DOS_TIME = (12 << 11) | (0 << 5) | 0; // 12:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

export interface ZipEntry {
  path: string;
  data: Uint8Array | string;
}

export interface ExtractedZipEntry {
  path: string;
  data: Uint8Array;
  isDirectory: boolean;
  uncompressedSize: number;
}

// Bit 11 of the general purpose flag marks the entry name as UTF-8. Without it, any
// non-ASCII mod name makes Bedrock's importer misread the directory table and reject
// the whole pack as "unknown pack or broken".
const UTF8_NAME_FLAG = 0x0800;
const MSDOS_DIRECTORY_ATTRIBUTE = 0x10;

interface PackedEntry {
  path: string;
  data: Uint8Array;
  isDirectory: boolean;
}

function collectDirectoryEntries(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) {
      directories.add(`${parts.slice(0, index).join('/')}/`);
    }
  }
  return [...directories];
}

export function createZipArchive(entries: ZipEntry[], options?: { includeDirectories?: boolean }): Uint8Array {
  const files: PackedEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string') continue;
    const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (path.length === 0 || seen.has(path)) continue;
    let data: Uint8Array;
    if (typeof entry.data === 'string') data = encoder.encode(entry.data);
    else if (entry.data instanceof Uint8Array) data = entry.data;
    else continue;
    seen.add(path);
    files.push({ path, data, isDirectory: false });
  }

  // manifest.json ships as the first physical entry: it is the pack identity, and
  // importers stop reading the archive once they have located it.
  files.sort((a, b) => (a.path === 'manifest.json' ? -1 : b.path === 'manifest.json' ? 1 : 0));

  const packed: PackedEntry[] = [];
  if (options?.includeDirectories !== false) {
    for (const directory of collectDirectoryEntries(files.map((file) => file.path))) {
      packed.push({ path: directory, data: new Uint8Array(0), isDirectory: true });
    }
  }
  packed.push(...files);

  // A modpack-sized pack is assembled on a phone, so the archive is allocated ONCE and written
  // in place. The previous implementation kept one array of local-file parts, one array of central
  // directory parts and then copied both into a third buffer, so peak memory was roughly twice the
  // finished archive — which is what killed the tab when a very large conversion was exported.
  interface PreparedEntry {
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    isDirectory: boolean;
    offset: number;
  }
  const prepared: PreparedEntry[] = [];
  let offset = 0;

  for (const item of packed) {
    const data = item.data;
    const nameBytes = encoder.encode(item.path);
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index++) {
      crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    prepared.push({ nameBytes, crc, size: data.length, isDirectory: item.isDirectory, offset });
    offset += 30 + nameBytes.length + data.length;
  }

  const directoryOffset = offset;
  const directorySize = prepared.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0);
  const endOffset = directoryOffset + directorySize;
  const archive = new Uint8Array(endOffset + 22);
  const archiveView = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  // Local file headers + payload, straight into the single buffer.
  for (let index = 0; index < prepared.length; index++) {
    const entry = prepared[index];
    const cursor = entry.offset;
    archiveView.setUint32(cursor, 0x04034b50, true);
    archiveView.setUint16(cursor + 4, 20, true);
    archiveView.setUint16(cursor + 6, UTF8_NAME_FLAG, true);
    archiveView.setUint16(cursor + 8, 0, true);
    archiveView.setUint16(cursor + 10, DOS_TIME, true);
    archiveView.setUint16(cursor + 12, DOS_DATE, true);
    archiveView.setUint32(cursor + 14, entry.crc, true);
    archiveView.setUint32(cursor + 18, entry.size, true);
    archiveView.setUint32(cursor + 22, entry.size, true);
    archiveView.setUint16(cursor + 26, entry.nameBytes.length, true);
    archive.set(entry.nameBytes, cursor + 30);
    const payload = packed[index].data;
    if (payload.length > 0) archive.set(payload, cursor + 30 + entry.nameBytes.length);
  }

  // Central directory, written directly after the payloads.
  let cursor = directoryOffset;
  for (const entry of prepared) {
    archiveView.setUint32(cursor, 0x02014b50, true);
    archiveView.setUint16(cursor + 4, 20, true);
    archiveView.setUint16(cursor + 6, 20, true);
    archiveView.setUint16(cursor + 8, UTF8_NAME_FLAG, true);
    archiveView.setUint16(cursor + 10, 0, true);
    archiveView.setUint16(cursor + 12, DOS_TIME, true);
    archiveView.setUint16(cursor + 14, DOS_DATE, true);
    archiveView.setUint32(cursor + 16, entry.crc, true);
    archiveView.setUint32(cursor + 20, entry.size, true);
    archiveView.setUint32(cursor + 24, entry.size, true);
    archiveView.setUint16(cursor + 28, entry.nameBytes.length, true);
    archiveView.setUint32(cursor + 38, entry.isDirectory ? MSDOS_DIRECTORY_ATTRIBUTE : 0, true);
    archiveView.setUint32(cursor + 42, entry.offset, true);
    archive.set(entry.nameBytes, cursor + 46);
    cursor += 46 + entry.nameBytes.length;
  }

  archiveView.setUint32(endOffset, 0x06054b50, true);
  archiveView.setUint16(endOffset + 8, prepared.length, true);
  archiveView.setUint16(endOffset + 10, prepared.length, true);
  archiveView.setUint32(endOffset + 12, directorySize, true);
  archiveView.setUint32(endOffset + 16, directoryOffset, true);
  return archive;
}

export interface AsyncPackOptions {
  includeDirectories?: boolean;
  /** Bytes hashed between two main-thread yields. Defaults to 2 MB. */
  chunkBytes?: number;
  onProgress?: (hashedBytes: number, totalBytes: number) => void;
}

/**
 * Cooperative version of `createZipArchive`.
 *
 * Assembling a modpack-sized addon is one long pass: every file is CRC-hashed and then copied into
 * the final buffer. Run in a single go on a phone that pass stops the page painting for seconds at
 * a time, and on the biggest archives it ends in a crashed tab. This version hashes in slices and
 * hands the frame back between them, so the progress log keeps advancing while it works. The
 * archive it returns is byte-for-byte identical to the synchronous one — same order, same header
 * layout, same CRC — so nothing downstream can tell which writer produced it.
 */
export async function createZipArchiveAsync(
  entries: ZipEntry[],
  options?: AsyncPackOptions,
): Promise<Uint8Array> {
  const chunkBytes = Math.max(64 * 1024, options?.chunkBytes ?? 2 * 1024 * 1024);
  const files: PackedEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string') continue;
    const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (path.length === 0 || seen.has(path)) continue;
    let data: Uint8Array;
    if (typeof entry.data === 'string') data = encoder.encode(entry.data);
    else if (entry.data instanceof Uint8Array) data = entry.data;
    else continue;
    seen.add(path);
    files.push({ path, data, isDirectory: false });
  }

  files.sort((a, b) => (a.path === 'manifest.json' ? -1 : b.path === 'manifest.json' ? 1 : 0));

  const packed: PackedEntry[] = [];
  if (options?.includeDirectories !== false) {
    for (const directory of collectDirectoryEntries(files.map((file) => file.path))) {
      packed.push({ path: directory, data: new Uint8Array(0), isDirectory: true });
    }
  }
  packed.push(...files);

  interface AsyncPreparedEntry {
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    isDirectory: boolean;
    offset: number;
  }
  const prepared: AsyncPreparedEntry[] = [];
  const totalBytes = packed.reduce((sum, item) => sum + item.data.length, 0);
  let hashedBytes = 0;
  let offset = 0;

  for (const item of packed) {
    const data = item.data;
    const nameBytes = encoder.encode(item.path);
    let crc = 0xffffffff;
    if (data.length > 0) {
      for (let start = 0; start < data.length; start += chunkBytes) {
        const end = Math.min(start + chunkBytes, data.length);
        for (let index = start; index < end; index += 1) {
          crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
        }
        hashedBytes += end - start;
        options?.onProgress?.(hashedBytes, totalBytes);
        if (end < data.length) await yieldToUi();
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    prepared.push({ nameBytes, crc, size: data.length, isDirectory: item.isDirectory, offset });
    offset += 30 + nameBytes.length + data.length;
  }

  const directoryOffset = offset;
  const directorySize = prepared.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0);
  const endOffset = directoryOffset + directorySize;
  const archive = new Uint8Array(endOffset + 22);
  const archiveView = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  // Copy payloads in bounded slices. The allocation above is unavoidable for a single
  // ZIP buffer, but one giant TypedArray.set() per 100+ MB pack used to lock iOS WebKit
  // long enough for the Activity to stop accepting scroll and touch events.
  const copyChunkBytes = Math.max(256 * 1024, Math.min(chunkBytes, 1024 * 1024));
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    const cursor = entry.offset;
    archiveView.setUint32(cursor, 0x04034b50, true);
    archiveView.setUint16(cursor + 4, 20, true);
    archiveView.setUint16(cursor + 6, UTF8_NAME_FLAG, true);
    archiveView.setUint16(cursor + 8, 0, true);
    archiveView.setUint16(cursor + 10, DOS_TIME, true);
    archiveView.setUint16(cursor + 12, DOS_DATE, true);
    archiveView.setUint32(cursor + 14, entry.crc, true);
    archiveView.setUint32(cursor + 18, entry.size, true);
    archiveView.setUint32(cursor + 22, entry.size, true);
    archiveView.setUint16(cursor + 26, entry.nameBytes.length, true);
    archive.set(entry.nameBytes, cursor + 30);
    const payload = packed[index].data;
    for (let start = 0; start < payload.length; start += copyChunkBytes) {
      const end = Math.min(start + copyChunkBytes, payload.length);
      archive.set(payload.subarray(start, end), cursor + 30 + entry.nameBytes.length + start);
      await yieldToUi();
    }
    if (index > 0 && index % 200 === 0) await yieldToUi();
  }

  let cursor = directoryOffset;
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    archiveView.setUint32(cursor, 0x02014b50, true);
    archiveView.setUint16(cursor + 4, 20, true);
    archiveView.setUint16(cursor + 6, 20, true);
    archiveView.setUint16(cursor + 8, UTF8_NAME_FLAG, true);
    archiveView.setUint16(cursor + 10, 0, true);
    archiveView.setUint16(cursor + 12, DOS_TIME, true);
    archiveView.setUint16(cursor + 14, DOS_DATE, true);
    archiveView.setUint32(cursor + 16, entry.crc, true);
    archiveView.setUint32(cursor + 20, entry.size, true);
    archiveView.setUint32(cursor + 24, entry.size, true);
    archiveView.setUint16(cursor + 28, entry.nameBytes.length, true);
    archiveView.setUint32(cursor + 38, entry.isDirectory ? MSDOS_DIRECTORY_ATTRIBUTE : 0, true);
    archiveView.setUint32(cursor + 42, entry.offset, true);
    archive.set(entry.nameBytes, cursor + 46);
    cursor += 46 + entry.nameBytes.length;
    if (index > 0 && index % 500 === 0) await yieldToUi();
  }

  archiveView.setUint32(endOffset, 0x06054b50, true);
  archiveView.setUint16(endOffset + 8, prepared.length, true);
  archiveView.setUint16(endOffset + 10, prepared.length, true);
  archiveView.setUint32(endOffset + 12, directorySize, true);
  archiveView.setUint32(endOffset + 16, directoryOffset, true);
  return archive;
}

async function decompressDeflateRaw(
  compressed: Uint8Array,
  expectedLength = 0,
  maxEntryBytes = 128 * 1024 * 1024,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') return compressed;
  const decompress = async (format: 'deflate-raw' | 'deflate'): Promise<Uint8Array> => {
    const stream = new DecompressionStream(format);
    const writer = stream.writable.getWriter();
    await writer.write(compressed as unknown as BufferSource);
    await writer.close();
    const reader = stream.readable.getReader();
    const output = expectedLength > 0 ? new Uint8Array(expectedLength) : null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxEntryBytes || (output && total + value.byteLength > output.byteLength)) {
        await reader.cancel();
        throw new Error('Expanded ZIP entry exceeds the configured memory safety limit.');
      }
      if (output) output.set(value, total);
      else chunks.push(value);
      total += value.byteLength;
    }
    if (output) {
      if (total !== expectedLength) throw new Error('Expanded ZIP entry did not match its declared size.');
      return output;
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0;
    return combined;
  };
  try {
    return await decompress('deflate-raw');
  } catch {
    return await decompress('deflate');
  }
}

export interface ReadZipOptions {
  filter?: (path: string) => boolean;
  maxEntries?: number;
  /** Largest single entry that will be inflated; anything bigger is left unread. */
  maxEntryBytes?: number;
  /** Total inflated bytes allowed for the archive. Highest-evidence entries win. */
  maxTotalBytes?: number;
  /** Reject decompression bombs whose expanded size is disproportionate to their compressed bytes. */
  maxCompressionRatio?: number;
  /** Called once for every entry skipped because of a size budget. */
  onSkip?: (path: string, bytes: number, reason: 'entry-too-large' | 'budget-exhausted') => void;
}

/** Default ceiling for one inflated entry (a single texture or model never needs more). */
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

interface CentralDirectoryEntry {
  index: number;
  path: string;
  isDirectory: boolean;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

export async function readZipArchive(
  source: ArrayBuffer | Uint8Array,
  options?: ReadZipOptions,
): Promise<ExtractedZipEntry[]> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Not a valid ZIP or JAR file. End of Central Directory record not found.');
  }

  let cdOffset = view.getUint32(eocdOffset + 16, true);

  // Some mod JARs (or ZIP64 archives) report an invalid central directory offset.
  // Recover by scanning backwards for the start of the central directory chain and
  // validating that walking its entries lands exactly on the EOCD record.
  if (cdOffset === 0xffffffff || cdOffset + 46 > eocdOffset) {
    let recovered = -1;
    for (let i = eocdOffset - 46; i >= 0; i--) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      // Validate: walk entries forward from this candidate
      let probe = i;
      let valid = true;
      while (probe + 46 <= eocdOffset) {
        if (view.getUint32(probe, true) !== 0x02014b50) {
          valid = false;
          break;
        }
        const nLen = view.getUint16(probe + 28, true);
        const eLen = view.getUint16(probe + 30, true);
        const cLen = view.getUint16(probe + 32, true);
        probe += 46 + nLen + eLen + cLen;
        if (probe === eocdOffset) break;
      }
      if (valid && probe === eocdOffset) {
        recovered = i;
        break;
      }
    }
    if (recovered === -1) {
      throw new Error('Not a valid ZIP or JAR file. Could not locate the central directory.');
    }
    cdOffset = recovered;
  }

  // Pass 1 — read the central directory only. Nothing is inflated yet, so a modpack-sized
  // archive can be measured before any memory is committed to it.
  const descriptors: CentralDirectoryEntry[] = [];
  let currentOffset = cdOffset;
  // Do NOT trust the declared entry count — many writers report 0 or 0xFFFF.
  // Scan the central directory chain by signature instead, with a hard safety cap.
  const max = options?.maxEntries ?? 50000;

  for (let i = 0; i < max && currentOffset + 46 <= eocdOffset; i++) {
    if (i > 0 && i % 400 === 0) await yieldToUi();
    if (view.getUint32(currentOffset, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(currentOffset + 10, true);
    const compressedSize = view.getUint32(currentOffset + 20, true);
    const uncompressedSize = view.getUint32(currentOffset + 24, true);
    const fileNameLen = view.getUint16(currentOffset + 28, true);
    const extraLen = view.getUint16(currentOffset + 30, true);
    const commentLen = view.getUint16(currentOffset + 32, true);
    const localHeaderOffset = view.getUint32(currentOffset + 42, true);

    const nameBytes = bytes.subarray(currentOffset + 46, currentOffset + 46 + fileNameLen);
    const path = decoder.decode(nameBytes);
    const isDirectory = path.endsWith('/');

    currentOffset += 46 + fileNameLen + extraLen + commentLen;

    if (options?.filter && !options.filter(path)) {
      continue;
    }

    if (isDirectory) {
      descriptors.push({
        index: descriptors.length,
        path,
        isDirectory: true,
        compressionMethod,
        compressedSize: 0,
        uncompressedSize: 0,
        dataOffset: 0,
      });
      continue;
    }

    // Inspect local file header
    if (localHeaderOffset + 30 > bytes.length) continue;
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    if (dataOffset + compressedSize > bytes.length) continue;

    descriptors.push({
      index: descriptors.length,
      path,
      isDirectory: false,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataOffset,
    });
  }

  // Pass 2 — decide what actually fits. An archive that is inside the budget is inflated
  // exactly as before; only an oversized one is trimmed, and then by evidence weight so the
  // files a conversion reads (metadata, animations, models, blocks, classes, textures) are the
  // ones that survive. Sounds and oversized binaries are dropped instead of the pack content.
  const maxEntryBytes = options?.maxEntryBytes ?? MAX_ENTRY_BYTES;
  const maxTotalBytes = options?.maxTotalBytes ?? 768 * 1024 * 1024;
  const maxCompressionRatio = options?.maxCompressionRatio ?? 200;
  const files = descriptors.filter((descriptor) => !descriptor.isDirectory);
  const declaredSize = (descriptor: CentralDirectoryEntry) =>
    descriptor.uncompressedSize > 0 ? descriptor.uncompressedSize : descriptor.compressedSize;
  const keep = new Set<number>();
  const totalDeclared = files.reduce((sum, descriptor) => sum + declaredSize(descriptor), 0);
  const anyOversized = files.some((descriptor) => declaredSize(descriptor) > maxEntryBytes);

  if (totalDeclared <= maxTotalBytes && !anyOversized) {
    for (const descriptor of files) keep.add(descriptor.index);
  } else {
    let budgetUsed = 0;
    const ordered = [...files].sort(
      (left, right) =>
        archiveEntryPriority(right.path) - archiveEntryPriority(left.path) || left.index - right.index,
    );
    for (const descriptor of ordered) {
      const estimate = declaredSize(descriptor);
      const ratio = descriptor.compressedSize > 0 ? estimate / descriptor.compressedSize : (estimate > 0 ? Infinity : 1);
      if (estimate > maxEntryBytes || ratio > maxCompressionRatio) {
        options?.onSkip?.(descriptor.path, estimate, 'entry-too-large');
        continue;
      }
      if (budgetUsed + estimate > maxTotalBytes) {
        options?.onSkip?.(descriptor.path, estimate, 'budget-exhausted');
        continue;
      }
      keep.add(descriptor.index);
      budgetUsed += estimate;
    }
  }

  // Pass 3 — inflate the kept entries in their original archive order.
  const entries: ExtractedZipEntry[] = [];
  for (let descriptorIndex = 0; descriptorIndex < descriptors.length; descriptorIndex += 1) {
    const descriptor = descriptors[descriptorIndex];
    if (descriptorIndex > 0 && descriptorIndex % 24 === 0) await yieldToUi();
    if (descriptor.isDirectory) {
      entries.push({
        path: descriptor.path,
        data: new Uint8Array(0),
        isDirectory: true,
        uncompressedSize: 0,
      });
      continue;
    }
    if (!keep.has(descriptor.index)) continue;

    const rawData = bytes.subarray(descriptor.dataOffset, descriptor.dataOffset + descriptor.compressedSize);
    let decompressed: Uint8Array;

    if (descriptor.compressionMethod === 0) {
      // Stored ZIP entries already live inside the original archive buffer. Keep a
      // view instead of copying every payload into a second allocation; this matters
      // on iOS where a 150 MB JAR plus copied entries can exceed the WebView heap.
      decompressed = rawData.subarray(0, descriptor.uncompressedSize || rawData.length);
    } else if (descriptor.compressionMethod === 8) {
      decompressed = await decompressDeflateRaw(rawData, descriptor.uncompressedSize, maxEntryBytes);
    } else {
      decompressed = rawData;
    }

    entries.push({
      path: descriptor.path,
      data: decompressed,
      isDirectory: false,
      uncompressedSize: descriptor.uncompressedSize,
    });
  }

  return entries;
}