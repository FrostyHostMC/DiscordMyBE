import type JSZip from 'jszip';

/**
 * Expand Bedrock .brarchive containers before conflict detection and merging.
 * The archive contains a 16-byte header and 256-byte file records.
 */
export async function expandBrarchiveFiles(zip: JSZip, diagnostics?: string[]): Promise<number> {
  const report = (message: string) => {
    if (diagnostics) diagnostics.push(message);
    else console.warn('[AutoBE] ' + message);
  };
  const magic = [0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26];
  let expandedCount = 0;
  const archives = Object.entries(zip.files).filter(([path, file]) =>
    !file.dir && path.toLowerCase().startsWith('__brarchive/') && path.toLowerCase().endsWith('.brarchive')
  );

  for (const [archivePath, archiveFile] of archives) {
    const bytes = await archiveFile.async('uint8array');
    if (bytes.length < 16 || !magic.every((value, index) => bytes[index] === value)) {
      throw new Error('Unsupported .brarchive format: ' + archivePath);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(8, true);
    if (count > 10000 || 16 + count * 256 > bytes.length) {
      throw new Error('Invalid .brarchive record table: ' + archivePath);
    }
    const payloadBase = 16 + count * 256;
    const archiveRelative = archivePath.replace(/^__brarchive\//i, '').replace(/\.brarchive$/i, '');
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
      if (!name || name.startsWith('/') || /^[a-z]:\//i.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
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

    const pathMap = new Map<string, string>();
    const destinations = new Map<string, string>();
    for (const entry of decoded) {
      const joined = [outputDirectory, entry.name].filter(Boolean).join('/');
      const outputPath = joined.split('/').filter(Boolean).join('/');
      if (!outputPath || outputPath.split('/').some(part => part === '..' || part === '.')) {
        throw new Error('Unsafe .brarchive output path in ' + archivePath + ': ' + outputPath);
      }
      let destination = outputPath;
      const existing = zip.file(destination);
      if (existing) {
        const previous = await existing.async('uint8array');
        const identical = previous.length === entry.data.length &&
          previous.every((value, index) => value === entry.data[index]);
        if (identical) {
          destinations.set(entry.name, destination);
          report('Duplicate identical archive entry skipped: ' + outputPath + ' (' + archivePath + ')');
          continue;
        }
        const slash = outputPath.lastIndexOf('/');
        const dot = outputPath.lastIndexOf('.');
        const stem = dot > slash ? outputPath.slice(0, dot) : outputPath;
        const extension = dot > slash ? outputPath.slice(dot) : '';
        let suffix = 2;
        do {
          destination = stem + '.autobe-' + suffix++ + extension;
        } while (zip.file(destination));
        pathMap.set(joined, destination);
        report('Conflicting archive path preserved as ' + destination + '; original path was ' + joined + ' from ' + archivePath + '.');
      }
      zip.file(destination, entry.data);
      destinations.set(entry.name, destination);
      expandedCount++;
    }

    // Repair exact path-valued JSON references within this archive only.
    // Cross-pack references are checked by the merged dependency validator;
    // a pack-wide rewrite here could redirect another add-on to the wrong asset.
    if (pathMap.size) {
      const replacements = [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length);
      for (const entry of decoded) {
        if (!/\.(?:json|material)$/i.test(entry.name)) continue;
        const destination = destinations.get(entry.name);
        if (!destination) continue;
        const file = zip.file(destination);
        if (!file) continue;
        const raw = await file.async('text');
        let rewritten = raw;
        try {
          const parsed = JSON.parse(raw);
          const visit = (value: any): any => {
            if (typeof value === 'string') {
              let result = value;
              for (const [oldPath, newPath] of replacements) {
                if (result === oldPath) result = newPath;
                const oldBare = oldPath.replace(/\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
                const newBare = newPath.replace(/\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
                if (oldBare !== oldPath && result === oldBare) result = newBare;
              }
              return result;
            }
            if (Array.isArray(value)) return value.map(visit);
            if (value && typeof value === 'object') {
              for (const key of Object.keys(value)) value[key] = visit(value[key]);
            }
            return value;
          };
          rewritten = JSON.stringify(visit(parsed), null, 2);
        } catch {
          // For JSONC, touch only quoted exact path strings, never arbitrary text.
          for (const [oldPath, newPath] of replacements) {
            rewritten = rewritten.split(JSON.stringify(oldPath)).join(JSON.stringify(newPath));
            const oldBare = oldPath.replace(/\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
            const newBare = newPath.replace(/\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\.json)$/i, '');
            if (oldBare !== oldPath) rewritten = rewritten.split(JSON.stringify(oldBare)).join(JSON.stringify(newBare));
          }
        }
        if (rewritten !== raw) zip.file(destination, rewritten);
      }
      report('Applied archive-local exact path reference repairs in ' + archivePath + '.');
    }
    zip.remove(archivePath);
  }
  return expandedCount;
}
