import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenRpf7 } from "../src/core/rpf7OpenBuilder.js";
import { extractOpenRpf7, inspectOpenRpf7 } from "../src/core/rpf7OpenInspector.js";

test("inspects a writer-produced nested OPEN archive", () => {
  const built = buildOpenRpf7([
    { path: "common/data/handling.meta", bytes: new TextEncoder().encode("<HandlingData/>") },
    { path: "content.xml", bytes: new Uint8Array([1, 2, 3]) }
  ]);
  const result = inspectOpenRpf7(built.bytes);
  assert.equal(result.encryption, "OPEN");
  assert.equal(result.fileCount, 2);
  assert.equal(result.directoryCount, 3);
  assert.ok(result.entries.some((entry) => entry.type === "file" && entry.name === "handling.meta" && entry.size === 15));
});

test("rejects truncated headers and tables", () => {
  assert.throws(() => inspectOpenRpf7(new Uint8Array(8)), /header is truncated/);
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  assert.throws(() => inspectOpenRpf7(built.bytes.subarray(0, 24)), /entry table is truncated|name table extends/);
});

test("rejects non-OPEN Orbis-style marker instead of guessing", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  new DataView(bytes.buffer).setUint32(12, 0x0ffeffff, true);
  assert.throws(() => inspectOpenRpf7(bytes), /not the supported OPEN variant/);
});

test("rejects payload offsets outside the archive", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  const view = new DataView(bytes.buffer);
  // First file is entry 1; overwrite its 24-bit block offset.
  bytes[16 + 1 * 16 + 5] = 0xff;
  bytes[16 + 1 * 16 + 6] = 0xff;
  bytes[16 + 1 * 16 + 7] = 0x7f;
  assert.throws(() => inspectOpenRpf7(bytes), /payload range is outside/);
});

test("rejects malformed UTF-8 names", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  const namesStart = 16 + 2 * 16;
  bytes[namesStart + 1] = 0xff;
  assert.throws(() => inspectOpenRpf7(bytes), /not valid UTF-8/);
});

test("rejects self-referential directory entries", () => {
  const built = buildOpenRpf7([{ path: "folder/file.bin", bytes: new Uint8Array([1]) }]);
  const bytes = built.bytes.slice();
  const view = new DataView(bytes.buffer);
  // Root now references the file; the child directory points to itself.
  view.setUint32(16 + 8, 2, true);
  view.setUint32(16 + 12, 1, true);
  view.setUint32(16 + 16 + 8, 1, true);
  view.setUint32(16 + 16 + 12, 1, true);
  assert.throws(() => inspectOpenRpf7(bytes), /parent cycle/);
});

test("extracts nested files with reconstructed paths and exact copied bytes", () => {
  const expected = [{ path: "common/data/handling.meta", bytes: new TextEncoder().encode("<HandlingData/>") }, { path: "content.xml", bytes: new Uint8Array([0, 1, 2, 255]) }];
  const built = buildOpenRpf7(expected);
  const extracted = extractOpenRpf7(built.bytes);
  assert.deepEqual(extracted.map((file) => file.path).sort(), expected.map((file) => file.path).sort());
  for (const source of expected) assert.deepEqual(extracted.find((file) => file.path === source.path).bytes, source.bytes);
  const original = built.bytes.slice();
  extracted[0].bytes[0] ^= 0xff;
  assert.deepEqual(built.bytes, original);
});

test("refuses extraction above configured file and byte limits before copying payloads", () => {
  const built = buildOpenRpf7([{ path: "one.bin", bytes: new Uint8Array([1, 2]) }, { path: "two.bin", bytes: new Uint8Array([3, 4]) }]);
  assert.throws(() => extractOpenRpf7(built.bytes, { maxFiles: 1 }), /file-count limit/);
  assert.throws(() => extractOpenRpf7(built.bytes, { maxBytes: 3 }), /expanded-byte limit/);
  assert.throws(() => extractOpenRpf7(built.bytes, { maxBytes: -1 }), /non-negative safe integers/);
});

test("rejects unsafe Windows extraction path segments", () => {
  for (const unsafeName of [":bad.bin", "CON", "trailing."]) {
    const built = buildOpenRpf7([{ path: "safe.bin", bytes: new Uint8Array([1]) }]);
    const bytes = built.bytes.slice();
    const namesStart = 16 + 2 * 16;
    const encoded = new TextEncoder().encode(unsafeName);
    bytes.fill(0, namesStart + 1, namesStart + 1 + 16);
    bytes.set(encoded, namesStart + 1);
    assert.throws(() => inspectOpenRpf7(bytes), /unsafe path segment/);
  }
});

test("enforces configured TOC entry limits", () => {
  const built = buildOpenRpf7([{ path: "a.bin", bytes: new Uint8Array([1]) }]);
  assert.throws(() => inspectOpenRpf7(built.bytes, { maxEntries: 1 }), /entry count exceeds the configured inspection limit/);
  assert.throws(() => inspectOpenRpf7(built.bytes, { maxEntries: 0 }), /maxEntries must be a positive safe integer/);
});

test("rejects reconstructed paths above the path-length safety limit", () => {
  const segments = Array.from({ length: 18 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(240));
  const built = buildOpenRpf7([{ path: segments.join("/") + "/file.bin", bytes: new Uint8Array([1]) }]);
  assert.throws(() => inspectOpenRpf7(built.bytes), /reconstructed entry path exceeds the configured safety limit/);
});
