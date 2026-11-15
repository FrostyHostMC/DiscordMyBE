import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenRpf7 } from "../src/core/rpf7OpenBuilder.js";

test("builds an OPEN RPF7 archive with nested directory entries and stored files", () => {
  const result = buildOpenRpf7([
    { path: "content.xml", bytes: new TextEncoder().encode("<content/>") },
    { path: "common/data/handling.meta", bytes: new TextEncoder().encode("handling-data") }
  ]);
  const bytes = result.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x52504637);
  assert.equal(view.getUint32(4, true), result.report.entryCount);
  assert.equal(view.getUint32(12, true), 0x4e45504f);
  assert.equal(result.report.fileCount, 2);
  assert.equal(result.report.directoryCount, 3);
  const namesLength = view.getUint32(8, true);
  const entriesEnd = 16 + result.report.entryCount * 16;
  const namesStart = entriesEnd;
  const names = new TextDecoder().decode(bytes.subarray(namesStart, namesStart + namesLength));
  assert.ok(names.includes("handling.meta"));
  assert.equal(result.report.installable, false);
});

test("rejects path traversal, duplicate paths and RSC7 resources without page flags", () => {
  assert.throws(() => buildOpenRpf7([{ path: "../escape", bytes: new Uint8Array([1]) }]), /traversal/);
  assert.throws(() => buildOpenRpf7([
    { path: "same.meta", bytes: new Uint8Array([1]) },
    { path: "same.meta", bytes: new Uint8Array([2]) }
  ]), /Duplicate/);
  assert.throws(() => buildOpenRpf7([{ path: "model.yft", bytes: new TextEncoder().encode("RSC7") }]), /resource page flags/);
});

test("rejects file/directory collisions", () => {
  assert.throws(() => buildOpenRpf7([
    { path: "vehicles", bytes: new Uint8Array([1]) },
    { path: "vehicles/car.meta", bytes: new Uint8Array([2]) }
  ]), /both a file and a directory/);
});
