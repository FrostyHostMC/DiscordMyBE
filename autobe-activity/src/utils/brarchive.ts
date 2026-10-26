import type JSZip from 'jszip';

/**
 * Expand Bedrock .brarchive containers used by some packaged addons.
 * Format: 16-byte header, followed by count 256-byte records. Each record
 * stores a length-prefixed UTF-8 filename, payload offset at +248, and size
 * at +252. Unknown formats are left untouched so diagnostics can report them.
 */
export async function expandBrarchiveFiles(zip: JSZip): Promise<number> {
  const magic = [0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26];
  let expandedCount = 0;
  const archives = Object.entries(zip.files).filter(([path, file]) =>
    !file.dir && path.toLowerCase().startsWith('__brarchive/') && path.toLowerCase().endsWith('.brarchive')
  );

  for (const [archivePath, archiveFile] of archives) {
    const bytes = await archiveFile.async('uint8array');
    if (bytes.length < 16 || !magic.every((value, index) => bytes[index] === value)) continue;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(8, true);
    if (count > 10000 || 16 + count * 256 > bytes.length) {
      throw new Error('Invalid .brarchive record table: ' + archivePath);
    }
    const payloadBase = 16 + count * 256;
    const archiveRelative = archivePath.replace(/^__brarchive\//i, '').replace(/\.brarchive$/i, '');
    // The archive filename is a container label, not an output directory.
    // Files belong beside the container in the corresponding Bedrock folder.
    // The item catalog is the exception: its payload is a root-level catalog.
    const outputDirectory = archiveRelative.toLowerCase() === 'item_catalog'
      ? ''
      : archiveRelative.includes('/') ? archiveRelative.slice(0, archiveRelative.lastIndexOf('/')) : '';
    const decoded: Array<{ name: string; data: Uint8Array }> = [];

    for (let index = 0; index < count; index++) {
      const recordOffset = 16 + index * 256;
      const nameLength = bytes[recordOffset];
      if (nameLength < 1 || nameLength > 247) {
        throw new Error('Invalid .brarchive filename length in ' + archivePath + ' record ' + index);
      }
      const name = new TextDecoder().decode(bytes.subarray(recordOffset + 1, recordOffset + 1 + nameLength)).replace(/\\/g, '/');
      if (!name || name.startsWith('/') || name.split('/').some(part => part === '..')) {
        throw new Error('Unsafe .brarchive filename in ' + archivePath + ': ' + name);
      }
      const payloadOffset = view.getUint32(recordOffset + 248, true);
      const payloadSize = view.getUint32(recordOffset + 252, true);
      const start = payloadBase + payloadOffset;
      const end = start + payloadSize;
      if (start < payloadBase || end > bytes.length || end < start) {
        throw new Error('Invalid .brarchive payload bounds in ' + archivePath + ': ' + name);
      }
      decoded.push({ name, data: bytes.slice(start, end) });
    }

    for (const entry of decoded) {
      const joined = [outputDirectory, entry.name].filter(Boolean).join('/');
      const segments = joined.split('/').filter(Boolean);
      let outputPath = segments.join('/');
      const slash = outputPath.lastIndexOf('/');
      const dot = outputPath.lastIndexOf('.');
      const stem = dot > slash ? outputPath.slice(0, dot) : outputPath;
      const extension = dot > slash ? outputPath.slice(dot) : '';
      let suffix = 2;
      while (zip.file(outputPath)) outputPath = stem + '.autobe-' + suffix++ + extension;
      zip.file(outputPath, entry.data);
      expandedCount++;
    }
    zip.remove(archivePath);
  }

  return expandedCount;
}
