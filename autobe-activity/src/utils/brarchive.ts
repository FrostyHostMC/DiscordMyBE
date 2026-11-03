import type JSZip from 'jszip';

/** Expand supported Bedrock optimized archives before scanning or merging.
 * The archive path without its extension is the output directory, e.g.
 * __brarchive/cameras/presets.brarchive -> cameras/presets/.
 * Refuse unsupported data or conflicting loose files instead of making a
 * seemingly successful pack whose contents or references are incomplete.
 */
export async function expandBrarchiveFiles(zip: JSZip, diagnostics?: string[]): Promise<number> {
  const magic = [0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26];
  const entries = Object.entries(zip.files).filter(([, f]) => !f.dir);
  const packed = entries.filter(([path]) => /^__brarchive\//i.test(path));
  const unknown = packed.find(([path]) => !path.toLowerCase().endsWith('.brarchive'));
  if (unknown) throw new Error(`Unsupported file in __brarchive: ${unknown[0]}`);
  const known = new Map<string, string>();
  for (const [path] of entries) {
    const old = known.get(path.toLowerCase());
    if (old && old !== path) throw new Error(`Case-colliding pack paths: ${old} and ${path}`);
    known.set(path.toLowerCase(), path);
  }
  const safe = (path: string): boolean => Boolean(path) && !path.startsWith('/') &&
    !/^[a-z]:/i.test(path) && !/[\x00-\x1f\x7f]/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..');
  let expanded = 0;
  let expandedBytes = 0;
  for (const [archivePath, archive] of packed.sort(([a], [b]) => a.localeCompare(b))) {
    const dir = archivePath.replace(/^__brarchive\//i, '').replace(/\.brarchive$/i, '');
    if (!safe(dir) || /^__brarchive(?:\/|$)/i.test(dir)) throw new Error(`Unsafe archive path: ${archivePath}`);
    const bytes = await archive.async('uint8array');
    if (bytes.length < 16 || !magic.every((value, i) => bytes[i] === value)) {
      throw new Error(`Unsupported .brarchive format: ${archivePath}`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(8, true);
    const version = view.getUint32(12, true);
    const payloadBase = 16 + count * 256;
    if (version !== 1 || count > 60000 || payloadBase > bytes.length) {
      throw new Error(`Unsupported or invalid .brarchive table: ${archivePath}`);
    }
    for (let i = 0; i < count; i++) {
      const record = 16 + i * 256;
      const length = bytes[record];
      if (!length || length > 247) throw new Error(`Invalid filename in ${archivePath}, record ${i}`);
      let name: string;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(record + 1, record + 1 + length)).replace(/\\/g, '/'); }
      catch { throw new Error(`Invalid UTF-8 filename in ${archivePath}, record ${i}`); }
      if (!safe(name)) throw new Error(`Unsafe .brarchive filename: ${archivePath}: ${name}`);
      const start = payloadBase + view.getUint32(record + 248, true);
      const size = view.getUint32(record + 252, true);
      if (start + size > bytes.length) throw new Error(`Invalid payload bounds in ${archivePath}: ${name}`);
      const outputPath = `${dir}/${name}`;
      const old = known.get(outputPath.toLowerCase());
      if (old && old !== outputPath) throw new Error(`Case-colliding packed paths: ${old} and ${outputPath}`);
      const existing = old ? zip.file(old) : null;
      if (existing) {
        // Empty archive records may point to data already stored as a loose file.
        if (!size) continue;
        const previous = await existing.async('uint8array');
        if (previous.length !== size || previous.some((byte, index) => byte !== bytes[start + index])) {
          throw new Error(`Packed file conflicts with existing file: ${outputPath}`);
        }
        diagnostics?.push(`Identical packed entry already exists: ${outputPath}`);
        continue;
      }
      if (!size) throw new Error(`Missing loose file for zero-size archive entry: ${outputPath}`);
      expandedBytes += size;
      if (known.size >= 60000 || expandedBytes > 3 * 1024 ** 3) throw new Error(`Expanded archive limit exceeded: ${archivePath}`);
      zip.file(outputPath, bytes.slice(start, start + size));
      known.set(outputPath.toLowerCase(), outputPath);
      expanded++;
    }
    zip.remove(archivePath);
  }
  return expanded;
}
