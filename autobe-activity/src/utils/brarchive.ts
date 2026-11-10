import type JSZip from 'jszip';

/**
 * Expand Bedrock .brarchive containers used by some packaged addons.
 * Format: 16-byte header, followed by count 256-byte records. Each record
 * stores a length-prefixed UTF-8 filename, payload offset at +248, and size
 * at +252. Unknown or malformed formats are rejected so the merge cannot
 * silently omit packed definitions from conflict detection or output.
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

    const archivePathMap = new Map<string, string>();
    for (const entry of decoded) {
      const joined = [outputDirectory, entry.name].filter(Boolean).join('/');
      const segments = joined.split('/').filter(Boolean);
      let outputPath = segments.join('/');
      if (!outputPath || outputPath.split('/').some(part => part === '..' || part === '.')) {
        throw new Error('Unsafe .brarchive output path in ' + archivePath + ': ' + outputPath);
      }

      const existing = zip.file(outputPath);
      if (existing) {
        const previous = await existing.async('uint8array');
        const identical = previous.length === entry.data.length &&
          previous.every((value, index) => value === entry.data[index]);
        if (identical) {
          // Identical payloads need no duplicate path and no renamed references.
          report('Duplicate identical archive entry skipped: ' + outputPath + ' (' + archivePath + ')');
          continue;
        }

        // Never overwrite either payload. Keep the second payload available,
        // but make the unresolved collision explicit: asset references may
        // still need a semantic rewrite before this pack is runtime-safe.
        const slash = outputPath.lastIndexOf('/');
        const dot = outputPath.lastIndexOf('.');
        const stem = dot > slash ? outputPath.slice(0, dot) : outputPath;
        const extension = dot > slash ? outputPath.slice(dot) : '';
        let suffix = 2;
        do {
          outputPath = stem + '.autobe-' + suffix++ + extension;
        } while (zip.file(outputPath));
        archivePathMap.set(joined, outputPath);
        archivePathMap.set(entry.name, outputPath);
        report(
          'Conflicting archive path preserved as ' + outputPath +
          '; original path was ' + joined + ' from ' + archivePath +
          '. References inside this archive were rewritten when they used an explicit matching path; references elsewhere in the pack remain subject to dependency validation.'
        );
      }

      zip.file(outputPath, entry.data);
      expandedCount++;
    }

    // Rewrite only exact path-valued strings in companion files from this
    // archive. This avoids broad regex edits to scripts, comments, or unrelated
    // providers that may legitimately reference the original winning path.
    if (archivePathMap.size) {
      const replacements = [...archivePathMap.entries()].sort((a, b) => b[0].length - a[0].length);
      for (const entry of decoded) {
        if (!/\\.(?:json|material)$/i.test(entry.name)) continue;
        const joined = [outputDirectory, entry.name].filter(Boolean).join('/');
        const destination = archivePathMap.get(joined) || archivePathMap.get(entry.name) || joined;
        const existing = zip.file(destination);
        if (!existing) continue;
        const raw = await existing.async('text');
        let rewritten = raw;
        try {
          const parsed = JSON.parse(raw);
          const visit = (value: any): any => {
            if (typeof value === 'string') {
              let result = value;
              for (const [oldPath, newPath] of replacements) {
                if (result === oldPath) result = newPath;
                const oldWithoutExtension = oldPath.replace(/\\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\\.json)$/i, '');
                const newWithoutExtension = newPath.replace(/\\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\\.json)$/i, '');
                if (oldWithoutExtension !== oldPath && result === oldWithoutExtension) result = newWithoutExtension;
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
          // JSONC or other text: replace only quoted exact path tokens.
          for (const [oldPath, newPath] of replacements) {
            rewritten = rewritten.split(JSON.stringify(oldPath)).join(JSON.stringify(newPath));
            const oldWithoutExtension = oldPath.replace(/\\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\\.json)$/i, '');
            const newWithoutExtension = newPath.replace(/\\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\\.json)$/i, '');
            if (oldWithoutExtension !== oldPath) {
              rewritten = rewritten.split(JSON.stringify(oldWithoutExtension)).join(JSON.stringify(newWithoutExtension));
            }
          }
        }
        if (rewritten !== raw) zip.file(destination, rewritten);
      }
      report('Applied archive-local exact path reference repair for ' + archivePathMap.size / 2 + ' duplicate mapping(s) in ' + archivePath + '.');
    }
    zip.remove(archivePath);');
          const expression = new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}(?![A-Za-z0-9_./-])`, 'g');
          source = source.replace(expression, (_match, prefix) => prefix + newPath);
          const oldWithoutExtension = oldPath.replace(/\\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\\.json)$/i, '');
          const newWithoutExtension = newPath.replace(/\\.(?:png|tga|jpg|jpeg|webp|ogg|wav|mp3|json|geo\\.json)$/i, '');
          if (oldWithoutExtension !== oldPath) {
            const extensionless = oldWithoutExtension.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\      zip.file(outputPath, entry.data);
      expandedCount++;
    }
    zip.remove(archivePath);');
            const extensionlessExpression = new RegExp(`(^|[^A-Za-z0-9_./-])${extensionless}(?![A-Za-z0-9_./-])`, 'g');
            source = source.replace(extensionlessExpression, (_match, prefix) => prefix + newWithoutExtension);
          }
        }
        if (source !== before) zip.file(destination, source);
      }
      report('Rewrote ' + archivePathMap.size / 2 + ' explicit duplicate path reference mapping(s) inside ' + archivePath + '.');
    }
    zip.remove(archivePath);
  }

  return expandedCount;
}
