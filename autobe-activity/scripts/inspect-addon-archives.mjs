import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const inputs = [
  '../Fiery Combat.mcaddon',
  '../Relic player animations V2.1 2.mcaddon',
  '../AutoBE_Modpack_10-26-2026.mcaddon',
];

const ascii = (bytes) => Array.from(bytes, (b) => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

async function inspectArchive(bytes, label, depth = 0) {
  if (depth > 6) return;
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch (error) {
    console.log(`  NOT-ZIP ${label} bytes=${bytes.length} hex=${hex(bytes.subarray(0, 24))} ascii=${ascii(bytes.subarray(0, 24))}`);
    return;
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const br = files.filter((f) => /(^|\\/)__brarchive\\//i.test(f.name) || /\\.brarchive$/i.test(f.name));
  const copies = files.filter((f) => /\\(copy(?: \\d+)?\\)/i.test(f.name));
  console.log(`  ZIP ${label}: files=${files.length} brarchive=${br.length} copy-suffixed=${copies.length}`);
  for (const f of br.slice(0, 20)) {
    const b = await f.async('uint8array');
    const nested = b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [3,5,7].includes(b[2]) && [4,6,8].includes(b[3]);
    console.log(`    BR ${f.name} bytes=${b.length} hex=${hex(b.subarray(0, 24))} ascii=${ascii(b.subarray(0, 24))} zipMagic=${nested}`);
    if (nested) await inspectArchive(b, f.name, depth + 1);
  }
  const nestedPacks = files.filter((f) => /\\.(mcpack|mcaddon|zip)$/i.test(f.name));
  for (const f of nestedPacks.slice(0, 12)) {
    const b = await f.async('uint8array');
    await inspectArchive(b, f.name, depth + 1);
  }
}

for (const input of inputs) {
  try {
    const bytes = new Uint8Array(await fs.readFile(new URL(input, import.meta.url)));
    console.log(`INPUT ${path.basename(input)} bytes=${bytes.length}`);
    await inspectArchive(bytes, path.basename(input));
  } catch (error) {
    console.log(`SKIP ${input}: ${error.message}`);
  }
}
