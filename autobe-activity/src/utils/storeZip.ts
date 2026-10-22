// Minimal "store" (no compression) ZIP builder that works on Blobs without copying their data.
//
// Why: building the combined .mcaddon with JSZip needs the whole ~330 MB modpack in memory several
// times over, which is too much for a phone. The packs inside are already compressed (.mcpack files),
// so a ZIP that simply STOREs them is just: header + raw bytes + header + raw bytes + directory.
// Blobs are referenced, not duplicated, so memory stays flat; only a CRC-32 pass reads the data
// (in small chunks) to fill in each entry's checksum.

export interface StoreZipEntry {
  name: string;
  data: Blob | string;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

const CHUNK = 4 * 1024 * 1024;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function crc32OfBlob(blob: Blob, onBytes: (n: number) => void): Promise<number> {
  let crc = 0xffffffff;
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + CHUNK, blob.size)).arrayBuffer());
    crc = crc32Update(crc, bytes);
    onBytes(bytes.length);
    await tick(); // let the UI breathe / progress repaint
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function buildStoreZip(
  entries: StoreZipEntry[],
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(new Date());

  const prepared = entries.map((e) => {
    const blob = typeof e.data === 'string' ? new Blob([enc.encode(e.data)]) : e.data;
    return { name: enc.encode(e.name), blob };
  });
  const totalBytes = prepared.reduce((s, p) => s + p.blob.size, 0) || 1;
  let doneBytes = 0;

  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const p of prepared) {
    if (p.blob.size >= 0xffffffff) throw new Error('A file inside the modpack is larger than 4 GB.');
    const crc = await crc32OfBlob(p.blob, (n) => {
      doneBytes += n;
      onProgress?.(Math.min(99, Math.round((doneBytes / totalBytes) * 100)));
    });

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 file names
    local.setUint16(8, 0, true); // method 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, p.blob.size, true);
    local.setUint32(22, p.blob.size, true);
    local.setUint16(26, p.name.length, true);
    local.setUint16(28, 0, true);
    const localBytes = new Uint8Array(local.buffer);
    parts.push(localBytes, p.name, p.blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, p.blob.size, true);
    cd.setUint32(24, p.blob.size, true);
    cd.setUint16(28, p.name.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // comment
    cd.setUint16(34, 0, true); // disk
    cd.setUint16(36, 0, true); // internal attrs
    cd.setUint32(38, 0, true); // external attrs
    cd.setUint32(42, offset, true); // local header offset
    const cdBytes = new Uint8Array(46 + p.name.length);
    cdBytes.set(new Uint8Array(cd.buffer), 0);
    cdBytes.set(p.name, 46);
    central.push(cdBytes);

    offset += 30 + p.name.length + p.blob.size;
    if (offset >= 0xffffffff) throw new Error('The combined modpack is larger than 4 GB.');
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, prepared.length, true);
  end.setUint16(10, prepared.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  parts.push(...(central as unknown as BlobPart[]), new Uint8Array(end.buffer) as unknown as BlobPart);
  onProgress?.(100);
  return new Blob(parts, { type: 'application/zip' });
}
