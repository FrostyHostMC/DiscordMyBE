import type JSZip from 'jszip';

const BRARCHIVE_MAGIC = [0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26] as const;
const HEADER_SIZE = 16;
const ENTRY_SIZE = 256;
const NAME_CAPACITY = 248;

export interface BrarchiveExpansionResult {
  extracted: number;
  warnings: string[];
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function safeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

/**
 * Expands the Bedrock Resource Archive containers found under __brarchive/.
 * These are source-side containers, not runtime Bedrock files; their contained
 * JSON/assets must be materialized into ordinary pack paths before collision
 * analysis and merging can see them. The original containers are retained as
 * inert source evidence; the extracted copies are what the merge pipeline uses.
 */
export async function expandBrarchiveFiles(zip: JSZip): Promise<BrarchiveExpansionResult> {
  let extracted = 0;
  const warnings: string[] = [];
  const candidates = Object.entries(zip.files).filter(([path, file]) =>
    !file.dir && path.toLowerCase().startsWith('__brarchive/') && path.toLowerCase().endsWith('.brarchive')
  );

  for (const [archivePath, file] of candidates) {
    let bytes: Uint8Array;
    try {
      bytes = await file.async('uint8array');
    } catch {
      warnings.push(`${archivePath}: could not read archive bytes`);
      continue;
    }

    const hasMagic = bytes.length >= HEADER_SIZE && BRARCHIVE_MAGIC.every((byte, index) => bytes[index] === byte);
    if (!hasMagic) {
      warnings.push(`${archivePath}: unknown archive signature; preserved without extraction`);
      continue;
    }

    const count = readU32(bytes, 8);
    if (count > 10000 || HEADER_SIZE + count * ENTRY_SIZE > bytes.length) {
      warnings.push(`${archivePath}: invalid entry count/header; preserved without extraction`);
      continue;
    }

    const entries: Array<{ name: string; size: number }> = [];
    let totalSize = 0;
    let valid = true;
    for (let index = 0; index < count; index++) {
      const offset = HEADER_SIZE + index * ENTRY_SIZE;
      const nameLength = bytes[offset];
      if (nameLength < 1 || nameLength > NAME_CAPACITY) {
        valid = false;
        break;
      }
      let name: string;
      try {
        name = decodeName(bytes.subarray(offset + 1, offset + 1 + nameLength));
      } catch {
        valid = false;
        break;
      }
      const safeName = safeRelativePath(name);
      const size = readU32(bytes, offset + 252);
      if (!safeName || safeName.includes('/')) {
        valid = false;
        break;
      }
      entries.push({ name: safeName, size });
      totalSize += size;
      if (!Number.isSafeInteger(totalSize) || totalSize > bytes.length) {
        valid = false;
        break;
      }
    }

    const dataStart = HEADER_SIZE + count * ENTRY_SIZE;
    if (!valid || dataStart + totalSize !== bytes.length) {
      warnings.push(`${archivePath}: invalid entry table or payload sizes; preserved without extraction`);
      continue;
    }

    const archiveRelative = archivePath.slice('__brarchive/'.length).replace(/\.brarchive$/i, '');
    // The catalog filename is a root-level Bedrock file even though its source
    // container is named item_catalog.brarchive.
    const targetDirectory = archiveRelative.toLowerCase() === 'item_catalog' ? '' : archiveRelative;
    let cursor = dataStart;
    const staged: Array<{ path: string; data: Uint8Array }> = [];
    for (const entry of entries) {
      const outputPath = safeRelativePath([targetDirectory, entry.name].filter(Boolean).join('/'));
      if (!outputPath) {
        valid = false;
        break;
      }
      staged.push({ path: outputPath, data: bytes.slice(cursor, cursor + entry.size) });
      cursor += entry.size;
    }
    if (!valid) {
      warnings.push(`${archivePath}: unsafe output path; preserved without extraction`);
      continue;
    }

    const existing = staged.find(entry => Boolean(zip.file(entry.path)));
    if (existing) {
      warnings.push(`${archivePath}: extracted path ${existing.path} already exists in this source pack; existing file preserved`);
      continue;
    }
    for (const entry of staged) {
      zip.file(entry.path, entry.data);
      extracted++;
    }
  }

  return { extracted, warnings };
}
