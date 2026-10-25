import type JSZip from 'jszip';

const BRARCHIVE_MAGIC = new Uint8Array([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26]);
const HEADER_SIZE = 16;
const ENTRY_SIZE = 256;
const ENTRY_SIZE_OFFSET = 252;
const MAX_ENTRIES = 10000;

export interface BrarchiveExtractionResult {
  archivesFound: number;
  filesExtracted: number;
  collisions: string[];
  invalidArchives: string[];
}

/**
 * Expand StoneByte/Bedrock .brarchive containers into their normal pack paths.
 *
 * The container is not a standard ZIP: it has an 8-byte magic, entry count and
 * version, then fixed 256-byte records (name length + name + uint32 file size),
 * followed by concatenated file payloads. The archive's own path determines
 * the restored directory: __brarchive/animations/fiery/combat.brarchive becomes
 * animations/fiery/combat/<entry-name>.
 *
 * Original .brarchive files are retained. Existing visible files are never
 * overwritten; collisions are returned for diagnostics instead.
 */
export async function extractBrarchives(zip: JSZip): Promise<BrarchiveExtractionResult> {
  const result: BrarchiveExtractionResult = {
    archivesFound: 0,
    filesExtracted: 0,
    collisions: [],
    invalidArchives: [],
  };
  const archiveFiles = Object.entries(zip.files).filter(([path, file]) =>
    !file.dir && path.toLowerCase().startsWith('__brarchive/') && path.toLowerCase().endsWith('.brarchive')
  );

  for (const [archivePath, file] of archiveFiles) {
    result.archivesFound++;
    try {
      const bytes = await file.async('uint8array');
      if (bytes.length < HEADER_SIZE || BRARCHIVE_MAGIC.some((byte, i) => bytes[i] !== byte)) {
        throw new Error('unrecognized header');
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint32(8, true);
      const version = view.getUint32(12, true);
      if (version !== 1 || count > MAX_ENTRIES) throw new Error('unsupported archive version or entry count');
      const tableEnd = HEADER_SIZE + count * ENTRY_SIZE;
      if (tableEnd > bytes.length) throw new Error('truncated entry table');

      const entries: Array<{ name: string; size: number }> = [];
      let totalSize = 0;
      for (let i = 0; i < count; i++) {
        const start = HEADER_SIZE + i * ENTRY_SIZE;
        const nameLength = bytes[start];
        if (nameLength < 1 || nameLength > ENTRY_SIZE_OFFSET - 1) throw new Error(`invalid filename length in entry ${i}`);
        const name = new TextDecoder().decode(bytes.subarray(start + 1, start + 1 + nameLength));
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
          throw new Error(`unsafe filename in entry ${i}`);
        }
        const size = view.getUint32(start + ENTRY_SIZE_OFFSET, true);
        totalSize += size;
        entries.push({ name, size });
      }
      if (tableEnd + totalSize !== bytes.length) throw new Error('payload sizes do not match archive length');

      let payloadOffset = tableEnd;
      const destinationBase = archivePath.slice('__brarchive/'.length, -'.brarchive'.length);
      if (!destinationBase || destinationBase.split('/').some(part => part === '.' || part === '..')) {
        throw new Error('unsafe archive destination');
      }

      for (const entry of entries) {
        const payload = bytes.slice(payloadOffset, payloadOffset + entry.size);
        payloadOffset += entry.size;
        const targetPath = `${destinationBase}/${entry.name}`;
        if (zip.file(targetPath)) {
          result.collisions.push(targetPath);
          continue;
        }
        zip.file(targetPath, payload);
        result.filesExtracted++;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      result.invalidArchives.push(`${archivePath}: ${detail}`);
    }
  }

  return result;
}
