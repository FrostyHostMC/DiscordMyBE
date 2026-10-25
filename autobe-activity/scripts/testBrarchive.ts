import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractBrarchives } from '../src/utils/brarchive.ts';

const MAGIC = Buffer.from('7d2725b1a0527026', 'hex');

function makeArchive(entries: Array<{ name: string; data: string }>): Uint8Array {
  const records = Buffer.alloc(entries.length * 256);
  const payloads: Buffer[] = [];
  entries.forEach((entry, i) => {
    const record = i * 256;
    const name = Buffer.from(entry.name, 'utf8');
    assert.ok(name.length > 0 && name.length < 251);
    records[record] = name.length;
    name.copy(records, record + 1);
    records.writeUInt32LE(Buffer.byteLength(entry.data), record + 252);
    payloads.push(Buffer.from(entry.data, 'utf8'));
  });
  const header = Buffer.alloc(16);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(1, 12);
  return new Uint8Array(Buffer.concat([header, records, ...payloads]));
}

async function main() {
  const zip = new JSZip();
  zip.file('__brarchive/animations/fiery.brarchive', makeArchive([
    { name: 'combat.animation.json', data: '{"animations":{"animation.fiery_combat.attack":{"loop":true}}}' },
    { name: 'hold.animation.json', data: '{"animations":{"animation.fiery_combat.hold":{"loop":"hold_on"}}}' },
  ]));
  zip.file('animations/existing.animation.json', '{"animations":{"animation.existing":{"loop":true}}}');
  const result = await extractBrarchives(zip);
  assert.equal(result.archivesFound, 1);
  assert.equal(result.filesExtracted, 2);
  assert.equal(result.invalidArchives.length, 0);
  assert.ok(zip.file('animations/fiery/combat.animation.json'));
  assert.ok(zip.file('animations/fiery/hold.animation.json'));
  assert.ok(zip.file('__brarchive/animations/fiery.brarchive'), 'original archive should remain intact');

  zip.file('__brarchive/animations/fiery.brarchive', makeArchive([
    { name: 'combat.animation.json', data: '{"animations":{"animation.should_not_replace":{}}}' },
  ]));
  const second = await extractBrarchives(zip);
  assert.equal(second.filesExtracted, 0);
  assert.deepEqual(second.collisions, ['animations/fiery/combat.animation.json']);
  const existing = JSON.parse(await (await zip.file('animations/fiery/combat.animation.json')!).async('text'));
  assert.ok(existing.animations['animation.fiery_combat.attack']);

  zip.file('__brarchive/bad.brarchive', new Uint8Array([1, 2, 3]));
  const invalid = await extractBrarchives(zip);
  assert.equal(invalid.invalidArchives.length, 1);
  console.log('brarchive extraction tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
